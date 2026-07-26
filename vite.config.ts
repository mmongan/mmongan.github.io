import { defineConfig } from "vite";


/**
 * Vite configuration for Babylon.js WebXR AR project.
 *
 * HTTPS is required for WebXR — mkcert generates a trusted local certificate
 * automatically so you can test on device over your local network.
 */
export default defineConfig({
  plugins: [
    // Generates a locally-trusted TLS cert; essential for WebXR on-device testing
  ],
  server: {
    https: false,
    host: true, // expose to LAN so a phone/headset can reach the dev server
    port: 5173,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
  optimizeDeps: {
    // Babylon.js ships ESM; tell Vite not to pre-bundle it to avoid
    // "Unexpected token" issues with its internal dynamic imports.
    exclude: ["@babylonjs/core", "@babylonjs/loaders", "@babylonjs/materials"],
  },
});
