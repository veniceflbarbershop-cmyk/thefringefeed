import sources from '../data/sources.json';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Item = { title: string; link: string; source: string; sourceSite: string; category: string; florida: boolean; date: string; excerpt: string; image: string | null };
export type Video = { id: string; title: string; channel: string; channelUrl: string; category: string; date: string; thumb: string };

const gen = (f: string) => join(process.cwd(), 'src/data/generated', f);
const load = <T>(f: string, fallback: T): T => (existsSync(gen(f)) ? JSON.parse(readFileSync(gen(f), 'utf8')) : fallback);

export const categories = sources.categories;
export const catName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug;
export const items: Item[] = load('items.json', []);
export const videos: Video[] = load('videos.json', []);
export const report: { generated: string; sources: { name: string; url: string; category: string; ok: boolean; count?: number; error?: string }[] } = load('report.json', { generated: '', sources: [] });
export const feedSources = sources.feeds;
export const ytSources = sources.youtube;

export const placeholder = (cat: string) => `/img/ph-${categories.some((c) => c.slug === cat) ? cat : 'fortean'}.svg`;

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export const longDate = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
