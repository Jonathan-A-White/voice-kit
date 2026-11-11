// scripts/fetch-bible-audio.mjs with a made-up fetch: its manners, with no network (mw-rdpwdp1.3).
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs script with no declaration file
import { CHAPTERS, GAP_MS, RETRY_WAITS_MS, USER_AGENT, chapterFile, fetchBible } from '../scripts/fetch-bible-audio.mjs';

interface Call {
  url: string;
  userAgent: string | undefined;
  at: number;
}

describe('fetch-bible-audio', () => {
  let dir: string;
  let clock: number;
  let calls: Call[];
  let sleeps: number[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wake-bible-'));
    clock = 0;
    calls = [];
    sleeps = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const sleep = (ms: number) => {
    sleeps.push(ms);
    clock += ms;
    return Promise.resolve();
  };
  /** A fetch that answers each call from `answers` in turn (a status, or 'network' for a thrown error). */
  const fetcher = (answers: (number | 'network')[]) => {
    let open = 0;
    return async (url: string, init: { headers: Record<string, string> }) => {
      expect(++open).toBe(1); // one request at a time
      calls.push({ url, userAgent: init.headers['User-Agent'], at: clock });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      await Promise.resolve();
      open--;
      if (answer === 'network') throw new TypeError('fetch failed');
      return { ok: answer < 400, status: answer, arrayBuffer: () => Promise.resolve(new TextEncoder().encode('mp3 bytes').buffer) };
    };
  };
  const options = (answers: (number | 'network')[], minutes = 25) => ({ dir, minutes, fetchFn: fetcher(answers), sleep, seconds: () => Promise.resolve(600), say: () => undefined });

  it('fetches chapters in order until enough minutes are cached, 2 s apart, with a generic User-Agent', async () => {
    const result = await fetchBible(options([200]));
    expect(result.files).toHaveLength(3); // 3 x 10 min >= 25 min
    expect(calls.map((c) => c.url.slice(-13))).toEqual(['Jhn_001_D.mp3', 'Jhn_002_D.mp3', 'Jhn_003_D.mp3']);
    expect(calls.every((c) => c.userAgent === USER_AGENT)).toBe(true);
    expect(USER_AGENT).toBe('voice-kit-wake-spike/1');
    expect(sleeps).toEqual([GAP_MS, GAP_MS]); // no wait before the first
    expect(GAP_MS).toBe(2000);
    expect(readdirSync(dir).sort()).toEqual([1, 2, 3].map((c) => chapterFile(c)));
  });

  it('never fetches a file it already has', async () => {
    writeFileSync(join(dir, chapterFile(1)), 'cached');
    const result = await fetchBible(options([200]));
    expect(result.fetched).toBe(2);
    expect(calls.map((c) => c.url.slice(-13))).toEqual(['Jhn_002_D.mp3', 'Jhn_003_D.mp3']);
    const again = await fetchBible(options([200]));
    expect(again.fetched).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it('retries a network failure twice with a growing wait, then gives up, leaving no partial file', async () => {
    await expect(fetchBible(options(['network']))).rejects.toThrow('fetch failed');
    expect(calls).toHaveLength(3); // the first try and two retries
    expect(sleeps).toEqual(RETRY_WAITS_MS);
    expect(RETRY_WAITS_MS[1]).toBeGreaterThan(RETRY_WAITS_MS[0]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('goes on after one network failure', async () => {
    const result = await fetchBible(options(['network', 200]));
    expect(result.files.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(1);
  });

  it('stops at the first 4xx or 5xx without a retry', async () => {
    for (const status of [404, 429, 500, 503]) {
      calls = [];
      await expect(fetchBible(options([status]))).rejects.toThrow(`HTTP ${status}`);
      expect(calls).toHaveLength(1);
    }
    expect(existsSync(join(dir, chapterFile(1)))).toBe(false);
  });

  it('says so when John has too little audio', async () => {
    await expect(fetchBible({ ...options([200], 1000) })).rejects.toThrow(/only .* min of John exist/);
    expect(calls).toHaveLength(CHAPTERS);
  });
});
