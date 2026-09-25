import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Vendor code changes far less often than app code; separate chunks keep it
// cached across deploys on slow venue networks.
const vendorChunk = (id: string) => {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('firebase')) return 'firebase';
  if (id.includes('react-router')) return 'router';
  if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
  return undefined;
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '0.0.0.0', port: 5173 },
  build: { rollupOptions: { output: { manualChunks: vendorChunk } } },
  test: { environment: 'node' },
});
