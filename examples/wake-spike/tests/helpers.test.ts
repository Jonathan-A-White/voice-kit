// The small pure parts around the detector (mw-rdpwdp1.3): the 20 tries counts, the headless summary the page shows, and
// the rules scripts/measure.mjs judges a try by and writes its table with. Network-free; no browser, no audio tool.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { summarize } from '../src/results.js';
import type { Results } from '../src/results.js';
import { TRIES_KEY, describeTries, readTries, saveTries } from '../src/tries.js';
// @ts-expect-error a plain .mjs script with no declaration file
import { BAR, judgeTry, median, printTable, tableRows } from '../scripts/measure.mjs';

describe('the 20 tries counts', () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('start at nothing, survive a save, and ignore a broken store', () => {
    const s = store();
    expect(readTries(s)).toEqual({ wakes: 0, seconds: 0 });
    saveTries(s, { wakes: 3, seconds: 90 });
    expect(readTries(s)).toEqual({ wakes: 3, seconds: 90 });
    s.setItem(TRIES_KEY, '{not json');
    expect(readTries(s)).toEqual({ wakes: 0, seconds: 0 });
    expect(readTries(undefined)).toEqual({ wakes: 0, seconds: 0 });
  });

  it('say how many of 20 were missed', () => {
    expect(describeTries({ wakes: 17, seconds: 120 })).toBe('17 wakes in 2.00 min: if you said it 20 times, 3 were missed.');
    expect(describeTries({ wakes: 20, seconds: 60 })).toContain('all 20 tries heard');
  });
});

describe('the headless summary', () => {
  it('has one line per measure, with the target and whether it was met', () => {
    const results: Results = {
      date: '2026-11-11',
      commit: 'abcdef0123456789',
      table: [
        { measure: 'False wakes an hour', result: '0.50', target: 'at most 1', met: 'met' },
        { measure: 'Model size', result: '469,057 bytes', target: '-', met: '-' },
      ],
    };
    expect(summarize(results).split('\n')).toEqual([
      'Measured 2026-11-11 at abcdef012, headless:',
      'False wakes an hour: 0.50 (target at most 1: met)',
      'Model size: 469,057 bytes',
    ]);
    expect(summarize(undefined)).toContain('No headless numbers yet');
  });

  it('shows the committed results.json when there is one', () => {
    const file = fileURLToPath(new URL('../results.json', import.meta.url));
    const results = JSON.parse(readFileSync(file, 'utf8')) as Results;
    const text = summarize(results);
    for (const word of ['False wakes', 'Misses, clean', 'Model size', 'Compute in Chromium, CPU throttled 4x', 'Battery']) expect(text).toContain(word);
  });

  it("has the car's hands-free rows, narrowband and wideband, and the bar is met on those without the Bible loud (mw-rdpwdp1.12)", () => {
    const file = fileURLToPath(new URL('../results.json', import.meta.url));
    const results = JSON.parse(readFileSync(file, 'utf8')) as Results;
    const car = results.table.filter((r) => /hands-free|through the car/.test(r.measure));
    // 12 sets of 20 tries (6 conditions, narrowband and wideband) and the Bible's false wakes through the car, each link
    expect(car.filter((r) => r.measure.startsWith('Misses, narrowband hands-free')).length).toBe(6);
    expect(car.filter((r) => r.measure.startsWith('Misses, wideband hands-free')).length).toBe(6);
    expect(car.filter((r) => r.measure.startsWith('False wakes an hour, Bible through the car')).length).toBe(2);
    // the Bible leaking back louder than the voice is not yet within the bar: the README says which sets (do not hide them here)
    for (const r of car.filter((x) => !/Bible leaking at/.test(x.measure))) expect(r.met, r.measure).toBe('met');
    for (const r of car.filter((x) => /Bible leaking at/.test(x.measure))) expect(['met', 'not met']).toContain(r.met);
  });
});

describe('measure.mjs', () => {
  it('hears a try when a wake falls from the saying start to 1 s after the phrase end, and gives the delay from the end', () => {
    expect(judgeTry([{ time: 3.2 }], 2, 3)).toEqual({ heard: true, delay: expect.closeTo(0.2, 6) });
    expect(judgeTry([{ time: 4.0 }], 2, 3)).toEqual({ heard: true, delay: expect.closeTo(1, 6) });
    expect(judgeTry([{ time: 4.01 }], 2, 3)).toEqual({ heard: false });
    expect(judgeTry([{ time: 1.9 }], 2, 3)).toEqual({ heard: false });
    expect(judgeTry([], 2, 3)).toEqual({ heard: false });
  });

  it('takes the median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it("holds the Governor's bar: at most 1 false wake an hour, at most 2 misses in 20", () => {
    expect(BAR.falseWakesPerHour).toBe(1);
    expect(BAR.missesIn20).toBe(2);
    expect(BAR.label).toContain('mw-6ww.165');
    expect(JSON.stringify(BAR)).not.toMatch(/provisional/i);
  });

  it('writes the table with met and not met against the bar, and says battery was not measured', () => {
    const sets = [
      { key: 'clean', name: 'clean', tries: 20, misses: 2, delaysMs: [60] },
      { key: 'x', name: 'under noise', tries: 20, misses: 3, delaysMs: [90] },
    ];
    const compute = { msPerSecond: 5 };
    const rows = tableRows({
      bible: { minutes: 61, files: 10, falseWakes: 2, falseWakesPerHour: 1.97 },
      tries: { sets, heard: 2, delayMedianMs: 75, delayWorstMs: 90 },
      model: { bytes: 1000, gzipBytes: 500, files: [{ name: 'm.json' }] },
      compute: { node: compute, node48k: compute, chromium: { unthrottled: compute, throttled4x: compute } },
    }) as { measure: string; met: string }[];
    const met = (name: string) => rows.find((r) => r.measure === name)?.met;
    expect(met('False wakes an hour')).toBe('not met');
    expect(met('Misses, clean')).toBe('met');
    expect(met('Misses, under noise')).toBe('not met');
    expect(met('Bible audio played')).toBe('met');
    expect(rows.find((r) => r.measure === 'Battery')).toBeTruthy();
    const text = printTable(rows, true) as string;
    expect(text.split('\n')[1]).toBe('|---|---|---|---|');
  });
});
