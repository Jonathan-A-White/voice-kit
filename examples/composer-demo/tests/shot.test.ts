// The demo page in a phone-sized Chromium (390 x 844): a picture attached and nothing typed shows a Send arrow beside
// Hold to talk, Hold to talk keeps its height, its left edge and its bottom edge, and one tap sends the picture with no
// words (mw-jtzpw0.9). The page is built by Vite into a scratch folder and served to Chromium by route. The shot is
// written to COMPOSER_SHOT_DIR when that is set (examples/composer-demo/shots is where the committed one comes from).
// It needs a Chromium that playwright-core can launch; without one the tests are skipped with a note, unless
// VOICE_KIT_REQUIRE_CHROMIUM=1 says to fail instead.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://app.test';
const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// Some hosts keep Chromium's system libraries (libnspr4, libnss3) in a cache directory of their own; point the linker at it when it exists.
const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const env = existsSync(extraLibDir) ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : undefined;

describe('the composer demo page at 390 x 844', () => {
  let browser: Browser | undefined;
  let page: Page;
  let out: string;

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'composer-demo-'));
    await build({ root, logLevel: 'silent', configFile: join(root, 'vite.config.ts'), build: { outDir: join(out, 'site'), emptyOutDir: true } });
    try {
      browser = await chromium.launch({ channel: 'chromium', env: env as Record<string, string> | undefined });
    } catch (err) {
      if (process.env.VOICE_KIT_REQUIRE_CHROMIUM === '1') throw err;
      console.warn(`composer demo shot skipped: Chromium would not launch (npx playwright-core install chromium): ${String(err).split('\n')[0]}`);
    }
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
    rmSync(out, { recursive: true, force: true });
  });

  async function openDemo() {
    page = await (browser as Browser).newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = join(out, 'site', path === '/' ? 'index.html' : path);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.getByRole('button', { name: 'Hold to talk' }).waitFor();
  }

  /** A picture the page draws and hands to the attach picker, as a phone's picker would. */
  async function attachPicture() {
    await page.evaluate(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      const g = canvas.getContext('2d');
      const gradient = g.createLinearGradient(0, 0, 96, 96);
      gradient.addColorStop(0, '#f59e0b');
      gradient.addColorStop(1, '#0f766e');
      g.fillStyle = gradient;
      g.fillRect(0, 0, 96, 96);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'photo.png', { type: 'image/png' }));
      const picker = document.querySelector('input[type="file"][multiple]');
      picker.files = transfer.files;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await page.getByRole('img', { name: 'photo.png' }).waitFor();
  }

  const box = async (name: string) => (await page.getByRole('button', { name }).boundingBox()) as { x: number; y: number; width: number; height: number };

  it('shows the Send arrow beside Hold to talk once a picture is attached, and Hold to talk stays the big button where it was', async (ctx) => {
    if (!browser) return ctx.skip();
    await openDemo();
    expect(await page.getByRole('button', { name: 'Send' }).count()).toBe(0);
    const before = await box('Hold to talk');
    expect(before.height).toBeGreaterThanOrEqual(90);

    await attachPicture();
    const after = await box('Hold to talk');
    const send = await box('Send');

    // the bar: same height, same left edge, same bottom edge; only its width gives way to the arrow
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0);
    expect(after.width).toBeGreaterThan(before.width * 0.75);
    expect(after.width).toBeGreaterThan(send.width * 4);
    // the arrow: beside the bar on its right, centred on it, a thumb wide and smaller than the bar
    expect(send.x).toBeGreaterThanOrEqual(after.x + after.width);
    expect(send.x + send.width).toBeLessThanOrEqual(390);
    expect(Math.abs(send.y + send.height / 2 - (after.y + after.height / 2))).toBeLessThanOrEqual(1);
    expect(send.width).toBeGreaterThanOrEqual(44);
    expect(send.height).toBeGreaterThanOrEqual(44);
    expect(send.height).toBeLessThan(after.height);

    const dir = process.env.COMPOSER_SHOT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'attachment-390x844.png'), await page.screenshot());
    }
    await page.close();
  }, 60_000);

  it('sends the picture with no words in one tap, and the arrow goes', async (ctx) => {
    if (!browser) return ctx.skip();
    await openDemo();
    await attachPicture();
    await page.getByRole('button', { name: 'Send' }).tap();
    await page.getByText('Sent: no words, photo.png (').waitFor();
    expect(await page.getByRole('button', { name: 'Send' }).count()).toBe(0);
    expect(await page.getByRole('img', { name: 'photo.png' }).count()).toBe(0);
    await page.close();
  }, 60_000);
});
