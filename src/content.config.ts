import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const originals = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/originals' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    category: z.enum(['ufo', 'paranormal', 'cryptids', 'fortean', 'ancient', 'science']),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    author: z.string().default('The Fringe Feed'),
    florida: z.boolean().default(false),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { originals };
