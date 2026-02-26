// @ts-check
import { defineConfig } from 'astro/config';
import { execSync } from 'node:child_process';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://kiryu.co',
  adapter: cloudflare(),

  integrations: [
    {
      name: 'pagefind',
      hooks: {
        'astro:build:done': () => {
          execSync("npx pagefind --site dist --glob '**/*.html'");
        },
      },
    },
  ],

  vite: {
    plugins: [tailwindcss()]
  }
});
