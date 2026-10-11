import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

type VercelJson = { headers: { source: string; headers: { key: string; value: string }[] }[] };

// vercel.json is the single source of truth for security headers; `vite preview`
// (used by the Playwright privacy test) serves the same ones.
const vercel = JSON.parse(
  readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'),
) as VercelJson;

export const securityHeaders: Record<string, string> = Object.fromEntries(
  vercel.headers[0]!.headers.map((h) => [h.key, h.value]),
);

export default defineConfig({
  plugins: [react(), tailwind()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['mupdf'] },
  preview: { headers: securityHeaders },
});
