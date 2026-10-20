import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@voice-kit/composer', () => {
  it('exports the Composer, its bar and the hooks and services it is made of', () => {
    for (const name of ['Composer', 'HoldToTalkBar', 'useHold', 'browserSpeech', 'transcribeRecording', 'startListening', 'VoiceRecorder', 'DEFAULT_LABELS', 'DEFAULT_COMPOSER_SETTINGS', 'resolveSettings']) {
      expect(pkg).toHaveProperty(name);
    }
    expect(pkg.Composer).toBeTypeOf('function');
    expect(pkg.useHold).toBeTypeOf('function');
  });

  it('runs nothing that needs a page when it is imported', () => {
    // this file runs in node: importing the package above touched no window, document or navigator
    expect(typeof window).toBe('undefined');
  });
});
