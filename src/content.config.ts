import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { createArticleSchema, stableIdSchema, visualSchema } from './content/schema';

const articles = defineCollection({
  loader: glob({
    base: './src/content/articles',
    pattern: '**/index.mdx',
    generateId: ({ data }) => stableIdSchema.parse(data.id),
  }),
  schema: createArticleSchema({
    visualReference: stableIdSchema.pipe(reference('visuals')),
    articleReference: stableIdSchema.pipe(reference('articles')),
  }),
});

const visuals = defineCollection({
  loader: glob({
    base: './src/content/articles',
    pattern: '**/visuals/*.json',
    generateId: ({ data }) => stableIdSchema.parse(data.id),
  }),
  schema: visualSchema,
});

export const collections = { articles, visuals };
