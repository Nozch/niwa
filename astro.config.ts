import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import { defineConfig } from 'astro/config';
import niwaEditor from './src/integrations/editor';

const site = process.env.SITE_URL;

if (process.argv.includes('build') && !site) {
  throw new Error('SITE_URL is required for a production build.');
}

export default defineConfig({
  site: site ?? 'http://localhost:4321',
  output: 'static',
  integrations: [mdx(), svelte({ compilerOptions: { experimental: { async: true } } }), sitemap(), niwaEditor()],
  markdown: {
    shikiConfig: { theme: 'github-light' },
  },
  vite: {
    build: { target: 'es2022' },
  },
});
