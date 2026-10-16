// The Playwright smoke: both fakes installed by init script in Chromium, a page that speaks and listens, and a test
// that sees an utterance end and an interim result. It needs a Chromium that playwright-core can launch; without one the
// tests are skipped with a note, unless VOICE_KIT_REQUIRE_CHROMIUM=1 says to fail instead.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clips, micInitScript } from '../src/mic.js';
import { speechInitScript } from '../src/speech.js';

const PAGE = 'https://app.test/';

// Some hosts keep Chromium's system libraries (libnspr4, libnss3) in a cache directory of their own; point the linker at it when it exists.
const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const env = existsSync(extraLibDir) ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : undefined;

describe('the fakes in Chromium, installed by init script', () => {
  let browser: Browser | undefined;
  let page: Page;

  beforeAll(async () => {
    try {
      browser = await chromium.launch({ channel: 'chromium', env: env as Record<string, string> | undefined });
    } catch (err) {
      if (process.env.VOICE_KIT_REQUIRE_CHROMIUM === '1') throw err;
      console.warn(`playwright smoke skipped: Chromium would not launch (npx playwright-core install chromium): ${String(err).split('\n')[0]}`);
    }
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  async function openPage(initScripts: string[]) {
    page = await (browser as Browser).newPage();
    for (const script of initScripts) await page.addInitScript(script);
    await page.route(PAGE, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>app</title>' }));
    await page.goto(PAGE);
  }

  // What runs in the page is a string: this package has no DOM types, and the page is what it is about.
  const inPage = <T>(code: string): Promise<T> => page.evaluate(code) as Promise<T>;

  it('sees an utterance end, with a start and a boundary for each word before it', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage([speechInitScript(), micInitScript()]);
    const events = await inPage<string[]>(`new Promise((resolve) => {
      const seen = [];
      const u = new SpeechSynthesisUtterance('Hello there world');
      u.onstart = () => seen.push('start');
      u.onboundary = (e) => seen.push('boundary:' + e.charIndex);
      u.onend = () => resolve([...seen, 'end']);
      speechSynthesis.speak(u);
    })`);
    expect(events).toEqual(['start', 'boundary:0', 'boundary:6', 'boundary:12', 'end']);
    expect(await inPage<string[]>('window.__bsvKitTesting.speech.spoken()')).toEqual(['Hello there world']);
    await page.close();
  }, 30_000);

  it('sees an interim result from the recogniser, then the final one', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage([speechInitScript(), micInitScript()]);
    const results = await inPage<string[]>(`new Promise((resolve) => {
      const r = new webkitSpeechRecognition();
      r.interimResults = true;
      const seen = [];
      r.onresult = (e) => {
        const result = e.results[e.results.length - 1];
        seen.push((result.isFinal ? 'final:' : 'interim:') + result[0].transcript);
      };
      r.onend = () => resolve(seen);
      r.start();
    })`);
    expect(results[0]).toBe('interim:Please');
    expect(results.length).toBeGreaterThan(2);
    expect(results[results.length - 1]).toBe(`final:${clips.english.transcript}`);
    await page.close();
  }, 30_000);

  it('with recorderType audio/wav, plays what it recorded in an <audio> element, as the default raw bytes cannot', async (ctx) => {
    if (!browser) return ctx.skip();
    const play = (type: string) => `(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const parts = [];
      recorder.ondataavailable = (e) => parts.push(e.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      recorder.stop();
      await stopped;
      const audio = new Audio(URL.createObjectURL(new Blob(parts, { type: ${JSON.stringify(type)} })));
      return new Promise((resolve) => {
        audio.onerror = () => resolve('error');
        audio.onloadedmetadata = () => resolve('ok:' + audio.duration.toFixed(1));
      });
    })()`;
    await openPage([micInitScript({ recorderType: 'audio/wav' })]);
    expect(await inPage<string>(play('audio/wav'))).toBe('ok:1.0');
    await page.close();
    await openPage([micInitScript()]);
    expect(await inPage<string>(play('audio/webm;codecs=opus'))).toBe('error');
    await page.close();
  }, 30_000);

  it('hands over a stream and a recording, and a denied permission rejects with NotAllowedError', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage([micInitScript({ clip: clips.greek })]);
    const recorded = await inPage<{ size: number; type: string }>(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const parts = [];
      recorder.ondataavailable = (e) => parts.push(e.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 500));
      recorder.stop();
      await stopped;
      return { size: parts.reduce((n, b) => n + b.size, 0), type: parts[0] && parts[0].type };
    })()`);
    expect(recorded.type).toBe('audio/webm;codecs=opus');
    expect(recorded.size).toBeGreaterThan(500 * 16 * 2 * 0.8);
    const denied = await inPage<string>(`(async () => {
      window.__bsvKitTesting.mic.options.denied = true;
      return navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted', (e) => e.name);
    })()`);
    expect(denied).toBe('NotAllowedError');
    await page.close();
  }, 30_000);
});
