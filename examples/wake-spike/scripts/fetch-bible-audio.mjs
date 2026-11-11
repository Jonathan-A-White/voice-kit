// Fetches John in the recorded voice (the publisher's public downloads, the same openbible.com files the page plays)
// into the scratch cache, until at least 60 minutes are cached. Run it once before `npm run measure`:
//
//   node examples/wake-spike/scripts/fetch-bible-audio.mjs [--minutes 60] [--dir DIR]
//
// Polite by construction: one request at a time, 2 s between files, a generic User-Agent (no name, no email), a file
// already cached is never fetched again, a network failure is retried twice with a growing wait, and any 4xx or 5xx stops
// the run. The audio stays in ~/.cache/voice-kit-wake-spike/bible, outside the repo; nothing in it is committed.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const USER_AGENT = 'voice-kit-wake-spike/1';
export const GAP_MS = 2000;
export const RETRY_WAITS_MS = [5000, 20000];
export const CHAPTERS = 21; // John
export const DEFAULT_DIR = join(process.env.WAKE_SPIKE_ROOT ?? join(homedir(), '.cache', 'voice-kit-wake-spike'), 'bible');

/** The publisher's file for a chapter of John in the recorded voice. */
export const chapterUrl = (chapter) => `https://openbible.com/audio/msb/MSB_43_Jhn_${String(chapter).padStart(3, '0')}_D.mp3`;
export const chapterFile = (chapter) => `MSB_43_Jhn_${String(chapter).padStart(3, '0')}_D.mp3`;

/** Seconds of audio in a file, by ffprobe. */
export function probeSeconds(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]);
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => {
      const seconds = Number.parseFloat(out);
      if (code === 0 && seconds > 0) resolve(seconds);
      else reject(new Error(`ffprobe ${path} exited ${code}: ${err.trim().slice(0, 300)}`));
    });
  });
}

/** One download: the whole body, or a thrown error. An HTTP 4xx or 5xx is marked `stop` so no retry follows. */
async function download(fetchFn, url) {
  const response = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    const error = new Error(`${url}: HTTP ${response.status}`);
    error.stop = true;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Makes sure at least `minutes` of John are cached in `dir`, fetching the chapters in order and skipping any already
 * there. Returns { minutes, files, fetched }. Throws on a 4xx or 5xx, or when the network failed three times running.
 * `fetchFn`, `sleep`, `seconds` and `say` are injectable for the test.
 */
export async function fetchBible({
  dir = DEFAULT_DIR,
  minutes = 60,
  fetchFn = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  seconds = probeSeconds,
  say = (line) => console.log(line),
} = {}) {
  mkdirSync(dir, { recursive: true });
  let total = 0;
  let fetched = 0;
  const files = [];
  let needGap = false; // 2 s after a request, before the next
  for (let chapter = 1; chapter <= CHAPTERS && total < minutes * 60; chapter++) {
    const path = join(dir, chapterFile(chapter));
    if (!existsSync(path)) {
      if (needGap) await sleep(GAP_MS);
      let body;
      for (let attempt = 0; ; attempt++) {
        try {
          body = await download(fetchFn, chapterUrl(chapter));
          break;
        } catch (err) {
          if (err.stop || attempt >= RETRY_WAITS_MS.length) throw err;
          say(`fetch: John ${chapter} failed (${err.message}); trying again in ${RETRY_WAITS_MS[attempt] / 1000} s`);
          await sleep(RETRY_WAITS_MS[attempt]);
        }
      }
      needGap = true;
      writeFileSync(path + '.part', body);
      renameSync(path + '.part', path); // a file is whole or not there
      fetched++;
      say(`fetch: John ${chapter}: ${(body.length / 1e6).toFixed(1)} MB`);
    }
    total += await seconds(path);
    files.push(path);
  }
  const cachedMinutes = total / 60;
  say(`fetch: ${files.length} chapters cached, ${cachedMinutes.toFixed(1)} min (${fetched} fetched now)`);
  if (cachedMinutes < minutes) throw new Error(`only ${cachedMinutes.toFixed(1)} min of John exist; ${minutes} were asked for`);
  return { minutes: cachedMinutes, files, fetched };
}

/** Chapters of John already cached in `dir`, as file paths in order. */
export function cachedFiles(dir = DEFAULT_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^MSB_43_Jhn_\d{3}_D\.mp3$/.test(name))
    .sort()
    .map((name) => join(dir, name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  fetchBible({ dir: option('--dir', DEFAULT_DIR), minutes: Number(option('--minutes', 60)) }).then(
    () => process.exit(0),
    (err) => {
      console.error(`fetch: stopped: ${err.message}`);
      process.exit(1);
    },
  );
}
