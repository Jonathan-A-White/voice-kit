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

/**
 * Keeps every text a [data-testid] element of the page is given, in `window.__texts[testid]`, so a test can ask whether
 * the page ever showed a line, not only whether it shows it at the moment it looks. The page replaces the "Heard Hey
 * Lampas" line with "Listening for" as soon as the wake restarts, and the hands-free entry line with the next entry's, and
 * how long a line stays depends on how fast the recogniser fails on the host: where Chromium's speech recogniser ends at
 * once (cloud2: error 'no-microphone', 12 ms) a line is on screen for about 40 ms, which a poll for it misses.
 */
async function keepTexts(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __texts: Record<string, string[]> };
    w.__texts = {};
    const note = (node: Node | null, text: string | null) => {
      const id = (node instanceof Element ? node : node?.parentElement)?.closest('[data-testid]')?.getAttribute('data-testid');
      if (id && text) (w.__texts[id] ??= []).push(text);
    };
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') note(record.target, record.target.textContent);
        else record.addedNodes.forEach((added) => note(record.target, added.textContent));
      }
    }).observe(document, { childList: true, characterData: true, subtree: true });
  });
}

/**
 * How long a test waits for something the page does on its own (a wake heard, a line shown, a count reaching a number).
 * Chromium's speech recogniser, the wake worker and the audio all slow down on a host at load 16 of 16 cores, and a wait of
 * 5 or 10 s then fails one test at a time (mw-rl10piw.23); so every such wait has this long, and a wait that passes does not
 * wait for it.
 */
const PATIENCE = 45_000;

/**
 * Opens a page in this context. VOICE_KIT_CPU_THROTTLE=<n> (n of 2 or more) makes Chromium run the page n times slower,
 * which is what a loaded host does to it, so the waits below can be tried on a calm host:
 * VOICE_KIT_CPU_THROTTLE=40 npx vitest run examples/wake-spike/tests/page.test.ts
 */
async function newPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(PATIENCE);
  const rate = Number(process.env.VOICE_KIT_CPU_THROTTLE);
  if (rate >= 2) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
  return page;
}

/** Waits until the element with this test id has been given a text matching `pattern` (at any time since the page opened); returns that text. */
async function textSeen(page: Page, testId: string, pattern: RegExp, timeout = PATIENCE): Promise<string> {
  const handle = await page.waitForFunction(
    ({ id, source, flags }) => (window as unknown as { __texts: Record<string, string[]> }).__texts[id]?.find((text) => new RegExp(source, flags).test(text)),
    { id: testId, source: pattern.source, flags: pattern.flags },
    { timeout },
  );
  return (await handle.jsonValue()) as string;
}

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
    page = await newPage(context);
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
      // a 3 s look at the meter, again until it has shown a level: a slow host samples it too seldom to catch the fake input's beep in one look
      await expect.poll(() => loudest(3000), { timeout: PATIENCE }).toBeGreaterThan(0.05);

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

  it('has a Hands-free check panel with both ways and the pause lengths, and the ways are fixed while it listens', async (ctx) => {
    if (!browser) return ctx.skip();
    await newContext();
    await openPage();
    await page.getByRole('heading', { name: 'Hands-free check' }).waitFor();
    expect(await page.getByLabel('handover', { exact: true }).isChecked()).toBe(true);
    expect(await page.getByLabel('share', { exact: true }).isChecked()).toBe(false);
    expect(await page.getByLabel('Pause length', { exact: true }).locator('option').allTextContents()).toEqual(['1.5 s', '3 s']);
    await page.getByLabel('share', { exact: true }).check();
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await enabled('stop');
    expect(await page.getByLabel('handover', { exact: true }).isDisabled()).toBe(true);
    expect(await page.getByLabel('share', { exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await enabled('listen');
    expect(await page.getByLabel('share', { exact: true }).isEnabled()).toBe(true);
    expect(strays).toEqual([]);
    await context.close();
  }, 60_000);

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
    await keepTexts(context);
    page = await newPage(context);
    await page.goto(`${ORIGIN}/`);
    await page.getByRole('button', { name: 'Listen', exact: true }).waitFor();
  }

  const log = async () => JSON.parse((await page.evaluate(() => localStorage.getItem('wake-spike-log'))) ?? '[]') as { event: string; detail?: Record<string, unknown> }[];

  it('keeps "Heard Hey Lampas" on the page after the wake restarts (mw-81n0bco)', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage();
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await textSeen(page, 'heard', /^Heard Hey Lampas/);
    // the wake restarts at once where the recogniser fails at once (cloud2); the line must still be there a second later,
    // not replaced by "Listening for", which the Governor would see for about 40 ms
    await page.waitForTimeout(1000);
    expect(await page.getByTestId('heard').textContent()).toMatch(/^Heard Hey Lampas/);
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await context.close();
  }, 180_000);

  it('shows "Heard Hey Lampas" after Listen, counts the wake, and logs it', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage();
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    // the line is looked for among the texts the page gave it, since the restarted wake replaces it within milliseconds where the recogniser fails at once
    expect(await textSeen(page, 'heard', /^Heard Hey Lampas/)).toMatch(/^Heard Hey Lampas at \d\d:\d\d:\d\d \(\d+\.\d s of listening, score [01]\.\d+\)$/);
    expect(Number(await page.getByTestId('tries-wakes').textContent())).toBeGreaterThanOrEqual(1);

    // the page shows what the model cost: its bytes fetched and the compute per second of audio
    const modelBytes = readFileSync(MODEL).length;
    await page.getByTestId('model-bytes').filter({ hasText: modelBytes.toLocaleString('en-GB') }).waitFor();
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="compute"]')?.textContent) > 0);
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="tries-minutes"]')?.textContent) > 0);

    // the headless numbers (results.json, bundled when the page was built) are on the page
    expect(await page.getByTestId('headless').textContent()).toMatch(/Measured \d{4}-\d\d-\d\d[\s\S]*False wakes an hour/);

    // the next saying (the file loops) is another wake; Stop listening ends the count
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="tries-wakes"]')?.textContent) >= 2, undefined, { timeout: PATIENCE });
    await page.getByRole('button', { name: 'Stop listening' }).click();
    const wakes = (await log()).filter((entry) => entry.event === 'wake');
    expect(wakes.length).toBeGreaterThanOrEqual(2);
    expect(wakes[0].detail).toMatchObject({ score: expect.any(Number), at: expect.any(Number) });
    expect(strays).toEqual([]);
    await context.close();
  }, 180_000);
});

describe.each(['handover', 'share'] as const)('the Hands-free check on the wake spike page, way %s (mw-rl10piw.4)', (way) => {
  let browser: Browser | undefined;
  let context: BrowserContext;
  let page: Page;
  let strays: string[];
  let microphone: string;

  beforeAll(async () => {
    microphone = join(tmpdir(), `wake-spike-hf-${way}-${process.pid}.wav`);
    writeFileSync(microphone, fakeMicrophone());
    browser = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`]);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
    rmSync(microphone, { force: true });
  });

  const log = async () => JSON.parse((await page.evaluate(() => localStorage.getItem('wake-spike-log'))) ?? '[]') as { event: string; detail?: Record<string, unknown> }[];

  it('a wake from the fixture saying runs the session; with no speech service the entry names the error and the page goes on listening', async (ctx) => {
    if (!browser) return ctx.skip();
    strays = [];
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
    await keepTexts(context);
    page = await newPage(context);
    await page.goto(`${ORIGIN}/`);
    await page.getByLabel(way, { exact: true }).check();
    await page.getByRole('button', { name: 'Listen', exact: true }).click();

    // the first wake runs the session; headless Chromium has no speech service, so the recogniser ends in an error and the entry says which
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('wake-spike-log') ?? '[]') as { event: string }[]).some((entry) => entry.event === 'hands-free-check'), undefined, { timeout: PATIENCE });
    const first = (await log()).find((entry) => entry.event === 'hands-free-check');
    expect(first?.detail).toMatchObject({ way, trackEnded: false, wakeAgain: expect.stringMatching(/^(not yet|yes)$/) });
    // No speech service answers here: composer treats a recogniser that hears nothing as a pause (a transient error it restarts
    // through), so the entry holds no words, no error kind, and the session's own reason for closing; a fatal error would
    // carry its kind in `error`. Either way the entry says why it ended, and the page goes on.
    const outcome = first?.detail as { words: string | null; error: string | null; closed: string };
    expect(outcome.words !== null || outcome.error !== null || outcome.closed.length > 0).toBe(true);

    // no stuck state: the wake is heard again (the saying loops) and the page is still listening
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('wake-spike-log') ?? '[]') as { event: string; detail?: { wakeAgain?: string } }[]).some((entry) => entry.event === 'hands-free-check' && entry.detail?.wakeAgain === 'yes'), undefined, { timeout: PATIENCE });
    await textSeen(page, 'hf-last', /wake heard again: yes/);
    expect(await page.getByRole('button', { name: 'Stop listening' }).isEnabled()).toBe(true);
    await page.getByTestId('hf-state').filter({ hasText: /Waiting|Listening|Starting/ }).waitFor();

    // Stop listening leaves no microphone open
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await page.getByRole('button', { name: 'Listen', exact: true }).waitFor();
    await page.getByTestId('hf-state').filter({ hasText: /^Off/ }).waitFor();
    expect(await page.getByTestId('hf-state').textContent()).toMatch(/^Off/);
    expect(strays).toEqual([]);
    await context.close();
  }, 180_000);
});

describe('Record my tries on the wake spike page (mw-rdpwdp1.11)', () => {
  let browser: Browser | undefined;
  let context: BrowserContext;
  let page: Page;
  let strays: string[];
  let microphone: string;

  beforeAll(async () => {
    microphone = join(tmpdir(), `wake-spike-rec-${process.pid}.wav`);
    writeFileSync(microphone, fakeMicrophone());
    browser = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`]);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
    rmSync(microphone, { force: true });
  });

  /** Opens the page; `sharing` stubs navigator.share/canShare so a test can see what the share sheet would be given. */
  async function openPage(sharing: boolean): Promise<void> {
    strays = [];
    context = await (browser as Browser).newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
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
    await context.addInitScript((stub) => {
      const w = window as unknown as { __shared: { name: string; type: string; bytes: number[] }[][] };
      w.__shared = [];
      const nav = navigator as unknown as Record<string, unknown>;
      if (stub) {
        nav.canShare = (data: { files?: File[] }) => Boolean(data.files?.length);
        nav.share = async (data: { files?: File[] }) => {
          const kept = await Promise.all((data.files ?? []).map(async (file) => ({ name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] })));
          w.__shared.push(kept);
        };
      } else {
        nav.canShare = undefined;
        nav.share = undefined;
      }
    }, sharing);
    await keepTexts(context);
    page = await newPage(context);
    await page.goto(`${ORIGIN}/`);
    await page.getByRole('button', { name: 'Listen', exact: true }).waitFor();
  }

  const shared = () => page.evaluate(() => (window as unknown as { __shared: unknown[][] }).__shared.length);

  /** Records until the saying has been heard `wakes` times, then stops listening. */
  async function recordTries(wakes: number): Promise<void> {
    await page.getByLabel('Record my tries').check();
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid="tries-wakes"]')?.textContent) >= n, wakes, { timeout: PATIENCE });
    await page.getByRole('button', { name: 'Stop listening' }).click();
  }

  const wavOf = (bytes: number[]) => {
    const wav = Buffer.from(bytes);
    return { wav, rate: wav.readUInt32LE(24), channels: wav.readUInt16LE(22), bits: wav.readUInt16LE(34), samples: wav.readUInt32LE(40) / 2 };
  };

  it('is off by default, and Send recording waits for a recording', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage(true);
    expect(await page.getByLabel('Record my tries').isChecked()).toBe(false);
    expect(await page.getByRole('button', { name: 'Send recording' }).isDisabled()).toBe(true);
    // listening without the toggle keeps nothing
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await textSeen(page, 'heard', /^Heard Hey Lampas/, 10_000);
    await page.getByRole('button', { name: 'Stop listening' }).click();
    expect(await page.getByRole('button', { name: 'Send recording' }).isDisabled()).toBe(true);
    await context.close();
  }, 60_000);

  it('keeps the input audio and the wake times while listening, and shares one WAV and the try log only when Send recording is tapped', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage(true);
    await recordTries(2);
    await page.getByRole('button', { name: 'Send recording' }).waitFor();
    expect(await page.getByRole('button', { name: 'Send recording' }).isEnabled()).toBe(true);
    // nothing has left the phone yet
    expect(await shared()).toBe(0);
    expect(strays).toEqual([]);

    await page.getByRole('button', { name: 'Send recording' }).click();
    await page.getByTestId('record-status').filter({ hasText: /shared/i }).waitFor();
    expect(await shared()).toBe(1);
    const [files] = await page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; bytes: number[] }[][] }).__shared);
    const wavFile = files.find((file) => file.name.endsWith('.wav'));
    const logFile = files.find((file) => file.name.endsWith('.json'));
    expect(files).toHaveLength(2);
    expect(wavFile?.type).toBe('audio/wav');

    const { wav, rate, channels, bits, samples } = wavOf(wavFile?.bytes ?? []);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect([channels, bits]).toEqual([1, 16]);
    expect(rate).toBeGreaterThanOrEqual(8000);
    // the saying plays twice in the loop: the file holds more than 3 s of what the page received
    expect(samples / rate).toBeGreaterThan(3);
    // and it is the saying, not silence: some samples are loud
    let top = 0;
    for (let i = 44; i + 1 < wav.length; i += 2) top = Math.max(top, Math.abs(wav.readInt16LE(i)));
    expect(top).toBeGreaterThan(1000);

    const tryLog = JSON.parse(Buffer.from(logFile?.bytes ?? []).toString()) as { inputRate: number; wakes: number; tries: { kind: string; at: number }[] };
    expect(tryLog.inputRate).toBe(rate);
    expect(tryLog.wakes).toBeGreaterThanOrEqual(2);
    const wakes = tryLog.tries.filter((each) => each.kind === 'wake');
    expect(wakes.length).toBe(tryLog.wakes);
    expect(wakes[0].at).toBeGreaterThan(0);
    expect(wakes[0].at).toBeLessThan(samples / rate);
    expect((await events()).includes('recording-sent')).toBe(true);
    expect(strays).toEqual([]);
    await context.close();
  }, 180_000);

  it('Mark a miss keeps a miss time in the try log', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage(true);
    await page.getByLabel('Record my tries').check();
    expect(await page.getByRole('button', { name: 'Mark a miss' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await page.getByTestId('heard').filter({ hasText: 'Listening for' }).waitFor({ timeout: PATIENCE });
    await page.getByRole('button', { name: 'Mark a miss' }).click();
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await page.getByRole('button', { name: 'Send recording' }).click();
    await page.getByTestId('record-status').filter({ hasText: /shared/i }).waitFor();
    const [files] = await page.evaluate(() => (window as unknown as { __shared: { name: string; bytes: number[] }[][] }).__shared);
    const tryLog = JSON.parse(Buffer.from(files.find((file) => file.name.endsWith('.json'))?.bytes ?? []).toString()) as { misses: number; tries: { kind: string; at: number }[] };
    expect(tryLog.misses).toBe(1);
    expect(tryLog.tries.find((each) => each.kind === 'miss')?.at).toBeGreaterThan(0);
    await context.close();
  }, 180_000);

  it('downloads the WAV and the try log when the browser cannot share files, and says so', async (ctx) => {
    if (!browser) return ctx.skip();
    await openPage(false);
    await recordTries(1);
    const downloads: string[] = [];
    const wavAndJson = () => downloads.some((name) => name.endsWith('.wav')) && downloads.some((name) => name.endsWith('.json'));
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await page.getByRole('button', { name: 'Send recording' }).click();
    await page.getByTestId('record-status').filter({ hasText: /download/i }).waitFor();
    // both files arrive as downloads of their own, a little after the status line says so
    await expect.poll(wavAndJson, { timeout: PATIENCE }).toBe(true);
    expect(downloads.some((name) => name.endsWith('.wav'))).toBe(true);
    expect(downloads.some((name) => name.endsWith('.json'))).toBe(true);
    expect(await shared()).toBe(0);
    expect(strays).toEqual([]);
    await context.close();
  }, 180_000);

  const events = async () => (JSON.parse((await page.evaluate(() => localStorage.getItem('wake-spike-log'))) ?? '[]') as { event: string }[]).map((entry) => entry.event);
});
