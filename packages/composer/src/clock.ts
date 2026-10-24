// clock.ts: a monotonic read for measuring a duration (mw-k4sekr.2). Date.now steps when the host's clock is corrected
// (a network time sync, a timezone fix), and a length taken from two reads of it then comes out negative or far too long;
// performance.now cannot step. Date.now stays for a stamp that names a moment.

/** Milliseconds on a clock that only goes forward; only the difference of two reads means anything. */
export function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
