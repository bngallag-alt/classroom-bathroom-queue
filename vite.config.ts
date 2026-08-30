import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const environment = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

// GitHub Actions supplies /<repository-name>/. Local builds remain relative.
const deploymentBase = environment?.BASE_PATH ?? './';

export default defineConfig({
  base: deploymentBase,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      scope: deploymentBase,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Classroom Bathroom Queue',
        short_name: 'Bathroom Queue',
        description: 'A private, offline classroom bathroom queue.',
        theme_color: '#17324d',
        background_color: '#f4f7fa',
        display: 'standalone',
        scope: deploymentBase,
        start_url: deploymentBase,
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
