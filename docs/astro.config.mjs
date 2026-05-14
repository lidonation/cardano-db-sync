import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://your-project.pages.dev',
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true }
  }),
  integrations: [mdx()],
});
