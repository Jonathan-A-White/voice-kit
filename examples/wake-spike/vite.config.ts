import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The page imports the wake word the way an app does ('voice-kit/wake', 'voice-kit/handsfree', 'voice-kit/composer'); here it resolves to the package's source, so the page runs the code that is published.
const src = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// base './' so the build works from any folder, GitHub Pages' project address included.
export default defineConfig({
  base: './',
  resolve: {
    alias: [
      { find: 'voice-kit/wake', replacement: src('../../packages/wake/src/index.ts') },
      { find: 'voice-kit/handsfree', replacement: src('../../packages/handsfree/src/index.ts') },
      // The page needs only composer's listen (startListening), not its React components: the listen file stands for the entry.
      { find: 'voice-kit/composer', replacement: src('../../packages/composer/src/listen.ts') },
    ],
  },
});
