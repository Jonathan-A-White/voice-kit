import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'voice-kit/speech/react': fileURLToPath(new URL('./packages/speech/src/react.tsx', import.meta.url)),
      'voice-kit/speech': fileURLToPath(new URL('./packages/speech/src/index.ts', import.meta.url)),
      'voice-kit/testing/speech': fileURLToPath(new URL('./packages/testing/src/speech.ts', import.meta.url)),
      'voice-kit/testing/mic': fileURLToPath(new URL('./packages/testing/src/mic.ts', import.meta.url)),
      'voice-kit/talks': fileURLToPath(new URL('./packages/talks/src/index.ts', import.meta.url)),
      'voice-kit/composer': fileURLToPath(new URL('./packages/composer/src/index.ts', import.meta.url)),
    },
  },
  // the composer's and speech's .tsx: React's automatic JSX runtime, as their tsconfigs say (jsx: react-jsx)
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.{ts,tsx}', 'examples/*/tests/**/*.test.ts', 'scripts/*.test.mjs'],
  },
});
