// The BUILT @voice-kit/wake (packages/wake/dist) in Chromium as plain modules, with no bundler (mw-rl10piw.1): a page that
// imports dist/index.js, a fake microphone fed the fixture saying, startWake with dist/models/hey-lampas.json. It needs a
// Chromium that playwright-core can launch; without one the tests are skipped with a note, unless VOICE_KIT_REQUIRE_CHROMIUM=1
// says to fail instead. Every request is answered by route on a made-up origin; anything else is refused and counted.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://app.test';
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const dist = join(repo, 'packages', 'wake', 'dist');
const FIXTURE = join(repo, 'examples', 'wake-spike', 'tests', 'fixtures', 'hey-lampas-espeak.wav');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

// Some hosts keep Chromium's system libraries (libnspr4, libnss3) in a cache directory of their own; point the linker at it when it exists.
const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const env = existsSync(extraLibDir) ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : undefined;

/** The saying with 0.5 s of silence ahead and 2 s behind, as a 16 kHz mono 16-bit WAV: what Chromium's fake microphone plays, in a loop. */
function fakeMicrophone(): Buffer {
  const saying = readFileSync(FIXTURE);
  const pcm = saying.subarray(saying.indexOf('data') + 8);
  const body = Buffer.concat([Buffer.alloc(16000), pcm, Buffer.alloc(64000)]);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + body.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24);
  head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(body.length, 40);
  return Buffer.concat([head, body]);
}

// No bundler: the page is one inline module that imports the built files by their own paths.
const PAGE = `<!doctype html><meta charset="utf-8"><title>wake</title>
<script type="module">
  import { startWake } from '/dist/index.js';
  window.__wakes = [];
  window.__running = undefined;
  window.__start = async (options) => {
    const result = await startWake({ modelUrl: '/dist/models/hey-lampas.json', onWake: (wake) => window.__wakes.push(wake), ...options });
    if (result.ok) window.__running = result;
    return result.ok ? { ok: true, tracks: result.stream.getAudioTracks().length } : result;
  };
  window.__stop = () => { window.__running.stop(); return window.__running.track.readyState; };
  window.__ready = true;
</script>`;

describe('the built @voice-kit/wake, as plain modules in Chromium', () => {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page;
  let strays: string[];
  let microphone: string;

  beforeAll(async () => {
    // The gate builds after it tests, so the package builds itself here: the worker's text, tsc, the models.
    execFileSync('npm', ['run', 'build', '--workspace', 'packages/wake', '--silent'], { cwd: repo, stdio: 'pipe' });
    microphone = join(tmpdir(), `wake-built-mic-${process.pid}.wav`);
    writeFileSync(microphone, fakeMicrophone());
    try {
      browser = await chromium.launch({
        channel: 'chromium',
        env: env as Record<string, string> | undefined,
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`],
      });
    } catch (err) {
      if (process.env.VOICE_KIT_REQUIRE_CHROMIUM === '1') throw err;
      console.warn(`built wake test skipped: Chromium would not launch (npx playwright-core install chromium): ${String(err).split('\n')[0]}`);
    }
  }, 180_000);
  afterAll(async () => {
    await browser?.close();
    rmSync(microphone, { force: true });
  });

  async function openPage(): Promise<void> {
    strays = [];
    context = await (browser as Browser).newContext();
    await context.route('**/*', (route) => {
      strays.push(route.request().url());
      return route.abort();
    });
    await context.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: PAGE });
      const file = join(dist, path.replace(/^\/dist\//, ''));
      if (!path.startsWith('/dist/') || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    });
    page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  }

  it('hears the saying within 10 s, with one worker while it listens and none after stop()', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage();
    expect(page.workers()).toHaveLength(0);
    const started = await page.evaluate(() => (window as unknown as { __start(o?: object): Promise<unknown> }).__start());
    expect(started).toEqual({ ok: true, tracks: 1 });
    expect(page.workers()).toHaveLength(1);
    await page.waitForFunction(() => (window as unknown as { __wakes: unknown[] }).__wakes.length >= 1, undefined, { timeout: 10_000 });
    const wake = await page.evaluate(() => (window as unknown as { __wakes: { score: number }[] }).__wakes[0]);
    expect(wake.score).toBeGreaterThan(0.5);
    expect(page.workers()).toHaveLength(1);
    expect(await page.evaluate(() => (window as unknown as { __stop(): string }).__stop())).toBe('ended');
    await expect.poll(() => page.workers().length, { timeout: 5000 }).toBe(0);
    expect(strays).toEqual([]);
    await context?.close();
  }, 60_000);

  it('fails as a value, not a throw, when the page offers no microphone', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage();
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
    });
    const result = await page.evaluate(() => (window as unknown as { __start(): Promise<{ ok: boolean; kind?: string }> }).__start());
    expect(result).toMatchObject({ ok: false, kind: 'permission-denied' });
    expect(page.workers()).toHaveLength(0);
    await context?.close();
  }, 60_000);
});
