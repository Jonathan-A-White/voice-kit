import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clips } from '../src/mic.js';

const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'clips');

describe('the committed clips', () => {
  for (const [key, clip] of Object.entries(clips)) {
    it(`${key}: src/clips.ts holds exactly clips/${key}.wav (run scripts/make-clips.mjs after changing one)`, () => {
      expect(clip.wavBase64).toBe(readFileSync(join(dir, `${key}.wav`)).toString('base64'));
    });

    it(`${key}: is a 16 kHz mono 16-bit PCM WAV of a few seconds`, () => {
      const wav = readFileSync(join(dir, `${key}.wav`));
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
      expect(view.getUint16(20, true)).toBe(1); // PCM
      expect(view.getUint16(22, true)).toBe(1); // mono
      expect(view.getUint32(24, true)).toBe(16000);
      expect(view.getUint16(34, true)).toBe(16);
      const seconds = (wav.length - 44) / 32000;
      expect(seconds).toBeGreaterThan(1);
      expect(seconds).toBeLessThan(4);
    });
  }
});
