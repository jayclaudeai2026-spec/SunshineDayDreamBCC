import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the IA BCC webapp.
// - Dev server on port 5173 by default
// - React fast refresh
// - No path aliases (kept simple; relative imports throughout)
// - Build target: modern ES2022 (we're not supporting IE)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // bind to 0.0.0.0 so it's reachable from inside containers / LAN devices
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
