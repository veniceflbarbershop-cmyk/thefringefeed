// Fetches every source in src/data/sources.json and writes normalized,
// deduplicated items to src/data/generated/. Broken feeds are logged and
// skipped so one dead source never breaks the build.
import Parser from 'rss-parser';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('src/data/generated/', ROOT);
const sources = JSON.parse(await readFile(new URL('src/data/sources.json', ROOT), 'utf8'));

const MAX_AGE_DAYS = 30;
const PER_SOURCE = 20;
const MAX_ITEMS = 600;
const EXCERPT_WORDS = 32;
const TIMEOUT_MS = 20000;
const UA = 'Mozilla/5.0 (compatible; TheFringeFeedBot/1.0; +https://thefringefeed.com/about/)';

const parser = new Parser({
  timeout: TIMEOUT_MS,
  headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:group', 'mediaGroup'],
      ['source', 'gnSource'],
      ['yt:videoId', 'videoId'],
    ],
  },
});

const decode = (s = '') =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
   .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
   .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”').replace(/&#8230;/g, '…').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

const stripHtml = (html = '') => decode(String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Short excerpt only: headline, source and a teaser, then link out.
const excerpt = (text) => {
  const words = stripHtml(text).replace(/The post .* appeared first on .*$/i, '').split(' ').filter(Boolean);
  if (!words.length) return '';
  return words.length > EXCERPT_WORDS ? words.slice(0, EXCERPT_WORDS).join(' ') + '…' : words.join(' ');
};

const pickImage = (item) => {
  const mc = item.mediaContent;
  if (Array.isArray(mc)) for (const m of mc) if (m?.$?.url && (!m.$.medium || m.$.medium === 'image')) return m.$.url;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
  if (item.mediaGroup?.['media:thumbnail']?.[0]?.$?.url) return item.mediaGroup['media:thumbnail'][0].$.url;
  if (item.enclosure?.url && /image/.test(item.enclosure.type || 'image')) return item.enclosure.url;
  const html = item['content:encoded'] || item.content || '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
};

const normUrl = (u) => {
  try {
    const x = new URL(u);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((p) => x.searchParams.delete(p));
    x.hash = '';
    return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).toLowerCase();
  } catch { return u; }
};
const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w.length > 3).slice(0, 8).join(' ');

const withTimeout = async (url, opts = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } }); }
  finally { clearTimeout(t); }
};

const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
const report = [];

async function fetchFeed(src) {
  const started = Date.now();
  try {
    const res = await withTimeout(src.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder('latin1').decode(buf.slice(0, 200));
    const cs = (res.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1] || head.match(/encoding=['"]([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
    let xml;
    try { xml = new TextDecoder(cs).decode(buf); } catch { xml = new TextDecoder('utf-8').decode(buf); }
    xml = xml.replace(/^\s*<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>');
    const feed = await parser.parseString(xml);
    let items = (feed.items || []).map((it) => {
      let title = decode(stripHtml(it.title || '')).trim();
      let sourceName = src.name;
      let sourceSite = src.site;
      if (src.aggregator) {
        const gn = it.gnSource;
        const pub = typeof gn === 'object' ? gn?._ : gn;
        if (pub) { sourceName = pub; sourceSite = gn?.$?.url || src.site; title = title.replace(new RegExp(`\\s+-\\s+${pub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ''); }
      }
      const date = new Date(it.isoDate || it.pubDate || Date.now());
      return {
        title,
        link: it.link,
        source: sourceName,
        sourceSite,
        category: src.category,
        florida: !!src.florida || /\bflorida\b/i.test(title),
        date: isNaN(date) ? new Date().toISOString() : date.toISOString(),
        excerpt: src.aggregator ? '' : excerpt(it.contentSnippet || it.summary || it.content || it['content:encoded'] || ''),
        image: src.aggregator ? null : pickImage(it),
      };
    }).filter((i) => i.title && i.link && new Date(i.date).getTime() >= cutoff);
    if (src.keywords?.length) {
      const re = new RegExp(src.keywords.join('|'), 'i');
      items = items.filter((i) => re.test(i.title + ' ' + i.excerpt));
    }
    items = items.slice(0, PER_SOURCE);
    report.push({ name: src.name, url: src.url, category: src.category, ok: true, count: items.length, ms: Date.now() - started });
    return items;
  } catch (e) {
    report.push({ name: src.name, url: src.url, category: src.category, ok: false, error: String(e.message || e), ms: Date.now() - started });
    return [];
  }
}

// YouTube: resolve @handle to channel id once, cache it, then read the public channel feed.
const ytCachePath = new URL('src/data/yt-cache.json', ROOT);
const ytCache = existsSync(ytCachePath) ? JSON.parse(await readFile(ytCachePath, 'utf8')) : {};

async function resolveChannel(handle) {
  if (ytCache[handle]) return ytCache[handle];
  const res = await withTimeout(`https://www.youtube.com/@${handle}`, { headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' } });
  if (!res.ok) throw new Error(`handle lookup HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error('channel id not found');
  ytCache[handle] = m[1];
  return m[1];
}

async function fetchYouTube(ch) {
  const started = Date.now();
  try {
    const id = ch.channelId || (await resolveChannel(ch.handle));
    const res = await withTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feed = await parser.parseString(await res.text());
    const vids = (feed.items || []).slice(0, 6).map((it) => {
      const vid = it.videoId || (it.id || '').replace('yt:video:', '');
      return {
        id: vid,
        title: decode(it.title || ''),
        channel: ch.name,
        channelUrl: `https://www.youtube.com/@${ch.handle}`,
        category: ch.category,
        date: new Date(it.isoDate || it.pubDate || Date.now()).toISOString(),
        thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      };
    }).filter((v) => v.id && !/#shorts/i.test(v.title));
    report.push({ name: ch.name + ' (YouTube)', url: `https://www.youtube.com/@${ch.handle}`, category: ch.category, ok: true, count: vids.length, ms: Date.now() - started });
    return vids;
  } catch (e) {
    report.push({ name: ch.name + ' (YouTube)', url: `https://www.youtube.com/@${ch.handle}`, category: ch.category, ok: false, error: String(e.message || e), ms: Date.now() - started });
    return [];
  }
}

async function pool(list, fn, size = 8) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < list.length) { const idx = i++; out[idx] = await fn(list[idx]); } }));
  return out;
}

const [articleLists, videoLists] = await Promise.all([pool(sources.feeds, fetchFeed), pool(sources.youtube, fetchYouTube, 4)]);

// Deduplicate across sources by URL and by near-identical headline; newest first.
const seenUrl = new Set();
const seenTitle = new Set();
const items = articleLists.flat().sort((a, b) => b.date.localeCompare(a.date)).filter((i) => {
  const u = normUrl(i.link); const t = titleKey(i.title);
  if (seenUrl.has(u) || (t && seenTitle.has(t))) return false;
  seenUrl.add(u); if (t) seenTitle.add(t); return true;
}).slice(0, MAX_ITEMS);

const videos = videoLists.flat().sort((a, b) => b.date.localeCompare(a.date));

await mkdir(OUT, { recursive: true });
await writeFile(new URL('items.json', OUT), JSON.stringify(items));
await writeFile(new URL('videos.json', OUT), JSON.stringify(videos));
await writeFile(new URL('report.json', OUT), JSON.stringify({ generated: new Date().toISOString(), sources: report }, null, 2));
await writeFile(ytCachePath, JSON.stringify(ytCache, null, 2));

const bad = report.filter((r) => !r.ok);
console.log(`Feeds: ${report.length - bad.length}/${report.length} ok, ${items.length} articles, ${videos.length} videos.`);
for (const b of bad) console.log(`  FAILED  ${b.name}: ${b.error}`);
