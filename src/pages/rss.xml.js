import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
export async function GET(context) {
  const posts = (await getCollection('originals', ({ data }) => !data.draft)).sort((a, b) => +b.data.date - +a.data.date);
  return rss({
    title: 'The Fringe Feed: Originals',
    description: 'Original investigations into UFOs, the paranormal, cryptids, ancient mysteries and fringe science.',
    site: context.site,
    items: posts.map((p) => ({ title: p.data.title, description: p.data.description, pubDate: p.data.date, link: `/originals/${p.id}/` })),
  });
}
