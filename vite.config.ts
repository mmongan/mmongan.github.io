import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('@babylonjs')) {
              if (id.includes('@babylonjs/gui')) return 'babylon-gui';
              return 'babylon-core';
            }
            return 'vendor';
          }
        }
      }
    },
    // increase warning limit to avoid noisy warnings while we split
    chunkSizeWarningLimit: 2000
  }
});
