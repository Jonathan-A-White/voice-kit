import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The page imports the wake word the way an app does ('voice-kit/wake'); here it resolves to the package's source, so the page runs the code that is published.
const src = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// base './' so the build works from any folder, GitHub Pages' project address included.
export default defineConfig({
  base: './',
  resolve: {
    alias: [{ find: 'voice-kit/wake', replacement: src('../../packages/wake/src/index.ts') }],
  },
});
