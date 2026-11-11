// The wake spike page in Chromium with its fake media devices (mw-rdpwdp1.2). The page is built by Vite into a scratch
// folder and served to Chromium by route on a made-up origin; the openbible.com address the page plays is answered by
// route with a few seconds of silence built here, and any other request is refused and counted, so none reaches the
// network. It needs a Chromium that playwright-core can launch; without one the tests are skipped with a note, unless
// VOICE_KIT_REQUIRE_CHROMIUM=1 says to fail instead.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://app.test';
const JOHN_1 = 'https://openbible.com/audio/msb/MSB_43_Jhn_001_D.mp3';
const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const FIXTURE = join(root, 'tests', 'fixtures', 'hey-lampas-espeak.wav');
const MODEL = join(root, 'public', 'models', 'hey-lampas.json');

// Some hosts keep Chromium's system libraries (libnspr4, libnss3) in a cache directory of their own; point the linker at it when it exists.
const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const env = existsSync(extraLibDir) ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : undefined;

/** `seconds` of 8 kHz, 8-bit, mono silence as a WAV file. */
function silence(seconds: number): Buffer {
  const data = 8000 * seconds;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24);
  head.writeUInt32LE(8000, 28);
  head.writeUInt16LE(1, 32);
  head.writeUInt16LE(8, 34);
  head.write('data', 36);
  head.writeUInt32LE(data, 40);
  return Buffer.concat([head, Buffer.alloc(data, 128)]);
}

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

// The page is built once into a scratch folder; both groups of tests serve it by route.
let out: string;
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'wake-spike-'));
  await build({ root, logLevel: 'silent', configFile: join(root, 'vite.config.ts'), build: { outDir: join(out, 'site'), emptyOutDir: true } });
}, 120_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

/** Launches Chromium with these flags; undefined (with a note) when it will not launch, unless VOICE_KIT_REQUIRE_CHROMIUM=1. */
async function launch(args: string[]): Promise<Browser | undefined> {
  try {
    return await chromium.launch({ channel: 'chromium', env: env as Record<string, string> | undefined, args });
  } catch (err) {
    if (process.env.VOICE_KIT_REQUIRE_CHROMIUM === '1') throw err;
    console.warn(`wake spike page tests skipped: Chromium would not launch (npx playwright-core install chromium): ${String(err).split('\n')[0]}`);
    return undefined;
  }
}

describe('the wake spike page', () => {
  let browser: Browser | undefined;
  let context: BrowserContext;
  let page: Page;
  let strays: string[];
  let johnRequests: number;

  beforeAll(async () => {
    browser = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  async function openPage(): Promise<void> {
    page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.getByRole('button', { name: 'Listen', exact: true }).waitFor();
  }

  async function newContext(): Promise<void> {
    strays = [];
    johnRequests = 0;
    context = await (browser as Browser).newContext({ viewport: { width: 390, height: 844 } });
    // Registered first, so tried last: whatever the routes below do not answer is refused and counted.
    await context.route('**/*', (route) => {
      strays.push(route.request().url());
      return route.abort();
    });
    await context.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = join(out, 'site', path === '/' ? 'index.html' : path);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    });
    await context.route(JOHN_1, (route) => {
      johnRequests += 1;
      return route.fulfill({ contentType: 'audio/wav', body: silence(5) });
    });
    // Every track the page opens is kept, so a test can ask whether Stop listening ended it.
    await context.addInitScript(() => {
      const w = window as unknown as { __tracks: MediaStreamTrack[] };
      w.__tracks = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        w.__tracks.push(...stream.getAudioTracks());
        return stream;
      };
    });
  }

  /** Waits until the button with this id can be tapped. */
  const enabled = (id: string) => page.waitForFunction((each) => !(document.getElementById(each) as HTMLButtonElement).disabled, id);

  const log = async () => JSON.parse((await page.evaluate(() => localStorage.getItem('wake-spike-log'))) ?? '[]') as { event: string; detail?: Record<string, unknown> }[];
  const events = async () => (await log()).map((entry) => entry.event);

  /** The highest value the level meter shows over `ms` milliseconds. */
  async function loudest(ms: number): Promise<number> {
    return page.evaluate(
      (span) =>
        new Promise<number>((resolve) => {
          const meter = document.querySelector('meter') as HTMLMeterElement;
          let top = 0;
          const timer = setInterval(() => (top = Math.max(top, meter.value)), 20);
          setTimeout(() => {
            clearInterval(timer);
            resolve(top);
          }, span);
        }),
      ms,
    );
  }

  it('lists Default and the fake input, opens each with a track label and a level meter that moves, and stops', async (ctx) => {
    if (!browser) return ctx.skip();
    await newContext();
    await openPage();
    await page.getByRole('button', { name: 'Show input names' }).click();
    const options = page.getByLabel('Input', { exact: true }).locator('option');
    await options.nth(1).waitFor({ state: 'attached' });
    const labels = await options.allTextContents();
    expect(labels[0]).toBe('Default');
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.slice(1).some((label) => /fake/i.test(label))).toBe(true);

    // Each listed input in turn: Default, then every other one.
    for (let i = 0; i < labels.length; i++) {
      await page.getByLabel('Input', { exact: true }).selectOption({ index: i });
      expect(await page.getByRole('button', { name: 'Stop listening' }).isDisabled()).toBe(true);
      await page.getByRole('button', { name: 'Listen', exact: true }).click();
      await enabled('stop');
      await page.getByTestId('track-label').filter({ hasText: /fake/i }).waitFor();
      expect(await page.getByTestId('track-settings').textContent()).toContain('sampleRate');
      expect(await loudest(3000)).toBeGreaterThan(0.05);

      await page.getByRole('button', { name: 'Stop listening' }).click();
      await enabled('listen');
      const states = await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((track) => track.readyState));
      expect(states.at(-1)).toBe('ended');
      expect(await page.locator('meter').evaluate((m) => (m as HTMLMeterElement).value)).toBe(0);
    }

    // the log holds the opens and the stops, with the input each opened
    const entries = await log();
    const names = entries.map((entry) => entry.event);
    expect(names.filter((name) => name === 'listen')).toHaveLength(labels.length);
    expect(names.filter((name) => name === 'input-opened')).toHaveLength(labels.length);
    expect(names.filter((name) => name === 'stop')).toHaveLength(labels.length);
    expect(entries.find((entry) => entry.event === 'input-opened')?.detail).toMatchObject({ label: expect.stringMatching(/fake/i) });
    expect(strays).toEqual([]);
    await context.close();
  }, 90_000);

  it('Play streams John 1 from an audio element that has no crossorigin attribute, and the log keeps it across a reload', async (ctx) => {
    if (!browser) return ctx.skip();
    await newContext();
    await openPage();
    expect(await page.locator('audio').count()).toBe(1);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => !(document.querySelector('audio') as HTMLAudioElement).paused);
    expect(await page.locator('audio').getAttribute('src')).toBe(JOHN_1);
    expect(await page.locator('audio').getAttribute('crossorigin')).toBeNull();
    expect(johnRequests).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('audio') as HTMLAudioElement).paused);

    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await enabled('stop');
    await page.getByRole('button', { name: 'Stop listening' }).click();
    const before = await events();
    expect(before).toEqual(expect.arrayContaining(['play', 'pause', 'listen', 'input-opened', 'stop']));
    expect(before.indexOf('play')).toBeLessThan(before.indexOf('listen'));

    await page.reload();
    await page.getByRole('button', { name: 'Listen', exact: true }).waitFor();
    expect(await events()).toEqual(before);
    const shown = (await page.getByTestId('log').textContent()) ?? '';
    for (const name of ['play', 'listen', 'input-opened', 'stop']) expect(shown).toContain(name);
    expect(strays).toEqual([]);
    await context.close();
  }, 60_000);

  it('Copy results puts the log on the clipboard as JSON', async (ctx) => {
    if (!browser) return ctx.skip();
    await newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    await openPage();
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await enabled('stop');
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await page.getByRole('button', { name: 'Copy results' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('Copied'));
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as { event: string }[];
    expect(copied.map((entry) => entry.event)).toEqual(await events());
    expect(copied.length).toBeGreaterThan(2);
    await context.close();
  }, 60_000);
});

describe('the wake spike page with the saying as the microphone', () => {
  let browser: Browser | undefined;
  let context: BrowserContext;
  let page: Page;
  let strays: string[];
  let microphone: string;

  beforeAll(async () => {
    microphone = join(tmpdir(), `wake-spike-mic-${process.pid}.wav`);
    writeFileSync(microphone, fakeMicrophone());
    browser = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`]);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
    rmSync(microphone, { force: true });
  });

  async function openPage(): Promise<void> {
    strays = [];
    context = await (browser as Browser).newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', (route) => {
      strays.push(route.request().url());
      return route.abort();
    });
    await context.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = join(out, 'site', path === '/' ? 'index.html' : path);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    });
    page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.getByRole('button', { name: 'Listen', exact: true }).waitFor();
  }

  const log = async () => JSON.parse((await page.evaluate(() => localStorage.getItem('wake-spike-log'))) ?? '[]') as { event: string; detail?: Record<string, unknown> }[];

  it('shows "Heard Hey Lampas" within 5 s of Listen, counts the wake, and logs it', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage();
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await page.getByTestId('heard').filter({ hasText: 'Heard Hey Lampas' }).waitFor({ timeout: 5000 });
    expect(await page.getByTestId('heard').textContent()).toMatch(/Heard Hey Lampas at \d\d:\d\d:\d\d \(\d+\.\d s of listening, score [01]\.\d+\)/);
    expect(Number(await page.getByTestId('tries-wakes').textContent())).toBeGreaterThanOrEqual(1);

    // the page shows what the model cost: its bytes fetched and the compute per second of audio
    const modelBytes = readFileSync(MODEL).length;
    await page.getByTestId('model-bytes').filter({ hasText: modelBytes.toLocaleString('en-GB') }).waitFor();
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="compute"]')?.textContent) > 0);
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="tries-minutes"]')?.textContent) > 0);

    // the headless numbers (results.json, bundled when the page was built) are on the page
    expect(await page.getByTestId('headless').textContent()).toMatch(/Measured \d{4}-\d\d-\d\d[\s\S]*False wakes an hour/);

    // the next saying (the file loops) is another wake; Stop listening ends the count
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="tries-wakes"]')?.textContent) >= 2, undefined, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Stop listening' }).click();
    const wakes = (await log()).filter((entry) => entry.event === 'wake');
    expect(wakes.length).toBeGreaterThanOrEqual(2);
    expect(wakes[0].detail).toMatchObject({ score: expect.any(Number), at: expect.any(Number) });
    expect(strays).toEqual([]);
    await context.close();
  }, 60_000);
});
