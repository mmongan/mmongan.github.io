import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  root: 'src',
  plugins: [{
    name: 'license-notices',
    generateBundle() {
      for (const fileName of ['LICENSE', 'NOTICE']) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8'),
        });
      }
    },
  }],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
