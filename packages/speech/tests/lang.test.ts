// preferredVoice: the voice for a language, and an app's own ranking among the voices that match it.
import { describe, expect, it } from 'vitest';
import { preferredVoice } from '../src/index.js';
import { voiceOf } from './support/honest-speech.js';

const voice = (name: string, lang: string, localService: boolean): SpeechSynthesisVoice =>
  ({ voiceURI: name, name, lang, localService, default: false }) as SpeechSynthesisVoice;

describe('preferredVoice', () => {
  it('without a rank takes the first voice of exactly the tag, else the first of the same language, else none', () => {
    const voices = [voiceOf('en-GB'), voiceOf('en-US'), voiceOf('en-US')] as SpeechSynthesisVoice[];
    expect(preferredVoice(voices, 'en-US')).toBe(voices[1]);
    expect(preferredVoice(voices, 'en-AU')).toBe(voices[0]);
    expect(preferredVoice(voices, 'el-GR')).toBeUndefined();
  });

  describe('with a rank', () => {
    const voices = [
      voice('Robot', 'en-US', false),
      voice('Samantha', 'en-US', true),
      voice('Google US English', 'en-US', false),
      voice('Google UK English', 'en-GB', false),
    ];
    const quality = (v: SpeechSynthesisVoice): number => (v.name.startsWith('Google') ? 2 : 0) + (v.localService ? 1 : 0);

    it('takes the best-ranked voice of the language match over the first one', () => {
      expect(preferredVoice(voices, 'en-US')).toBe(voices[0]);
      expect(preferredVoice(voices, 'en-US', { rank: quality })).toBe(voices[2]);
    });

    it('hands the rank each voice and the language asked for', () => {
      const seen: Array<[string, string]> = [];
      preferredVoice(voices, 'en-US', {
        rank: (v, lang) => {
          seen.push([v.name, lang]);
          return 0;
        },
      });
      expect(seen).toEqual(voices.slice(0, 3).map((v) => [v.name, 'en-US']));
    });

    it('keeps the first of equally ranked voices, so a flat rank is no rank', () => {
      expect(preferredVoice(voices, 'en-US', { rank: () => 1 })).toBe(voices[0]);
    });

    it('ranks only the voices that match: a better voice of another language never wins', () => {
      const greek = [voice('Plain Greek', 'el-GR', true), voice('Google US English', 'en-US', false)];
      expect(preferredVoice(greek, 'el-GR', { rank: quality })).toBe(greek[0]);
    });

    it('ranks the same-language voices when none matches the tag exactly', () => {
      expect(preferredVoice(voices, 'en-AU', { rank: quality })).toBe(voices[2]);
    });

    it('returns none when no voice matches, rank or not', () => {
      expect(preferredVoice(voices, 'he-IL', { rank: quality })).toBeUndefined();
    });
  });
});
