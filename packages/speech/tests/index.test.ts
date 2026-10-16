import { describe, expect, it } from 'vitest';
import * as speech from '../src/index.js';

describe('@voice-kit/speech entry point', () => {
  it('exports the engine and nothing of React', () => {
    for (const name of ['speak', 'pause', 'resume', 'restart', 'stop', 'getSpeech', 'subscribe', 'isSpeaking', 'isPausedOn', 'whenDone', 'isSupported', 'sentencesOf', 'speechText', 'languageOf', 'readingLang']) {
      expect(typeof (speech as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(Object.keys(speech)).not.toContain('SpeakingBar');
  });
});
