// The consumer smoke test (scripts/consumer-smoke.mjs): installs voice-kit from a fresh clone into a scratch
// directory, as an app does, and from there renders the composer and the SpeakingBar with the app's React, speaks
// through the honest speech fake, and runs the testing fakes in the app's vitest. It needs the network or a warm npm
// cache, because the install runs the build with devDependencies; set VOICE_KIT_SKIP_SMOKE=1 to leave it out offline.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./consumer-smoke.mjs', import.meta.url));

describe.skipIf(process.env.VOICE_KIT_SKIP_SMOKE === '1')('a consumer install of voice-kit', () => {
  it('installs from git, renders the composer and the SpeakingBar, speaks through the fake and runs the fakes in vitest', () => {
    let output = '';
    try {
      output = execFileSync('node', [script], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 540_000 });
    } catch (err) {
      const e = /** @type {{ stdout?: string, stderr?: string }} */ (err);
      throw new Error(`consumer smoke test failed:\n${e.stdout ?? ''}\n${e.stderr ?? ''}`);
    }
    expect(output).toContain('the exports map names the entry points');
    expect(output).toContain('voice-kit/composer renders');
    expect(output).toContain('voice-kit/speech and voice-kit/speech/react work');
    expect(output).toContain('voice-kit/talks keeps a talk');
    expect(output).toContain('voice-kit/testing/speech and voice-kit/testing/mic run in vitest');
    expect(output).toContain('consumer smoke test passed');
  }, 600_000);
});
