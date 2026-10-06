import { defineConfig } from 'vite';

export default defineConfig({
  // './' para que la versión armada (dist/) ande en la vista previa y en cualquier hosting.
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173 },
});
