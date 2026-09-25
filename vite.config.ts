import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';

// The short commit the bundle was built from, shown in the page footer so
// anyone can tell whether their browser is running the latest deploy. A
// trailing + means the build included uncommitted changes.
const commit = (() => {
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no').toString().trim();
    return dirty ? `${hash}+` : hash;
  } catch {
    return 'unknown';
  }
})();

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
  define: { __APP_COMMIT__: JSON.stringify(commit) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '0.0.0.0', port: 5173 },
  build: { rollupOptions: { output: { manualChunks: vendorChunk } } },
  test: { environment: 'node' },
});
