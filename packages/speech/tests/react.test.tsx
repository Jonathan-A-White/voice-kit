// @vitest-environment jsdom
// The React entry: SpeakingBar shows Pause while speaking, Resume while paused, and Restart and Stop; useSpeaking(key)
// tells whether that key is the one speaking, and leaving the screen that used it pauses what it started.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSpeech, isSpeaking, pause, speak, stop } from '../src/index.js';
import { SpeakingBar, useSpeaking, useSpeech, DEFAULT_LABELS } from '../src/react.js';
import { installHonestSpeech, type HonestSpeech } from './support/honest-speech.js';

let synth: HonestSpeech;

beforeEach(() => {
  synth = installHonestSpeech();
});

afterEach(() => {
  cleanup();
  act(() => stop());
  synth.uninstall();
});

const THREE = 'First thing. Second thing. Third thing.';

describe('SpeakingBar', () => {
  it('shows nothing while nothing speaks', () => {
    const { container } = render(<SpeakingBar />);
    expect(container.firstChild).toBeNull();
  });

  it('shows Pause, Restart and Stop while speaking', () => {
    render(<SpeakingBar />);
    act(() => speak(THREE, { key: 'a' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Speaking' }).getAttribute('data-testid')).toBe('speaking-bar');
  });

  it('shows Resume instead of Pause while paused, and Resume carries on from the kept sentence', () => {
    render(<SpeakingBar />);
    act(() => speak(THREE, { key: 'a' }));
    act(() => synth.advance(0));
    act(() => synth.finish());
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(getSpeech().status).toBe('paused');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(getSpeech().status).toBe('playing');
    expect(synth.waiting()).toEqual(['Second thing.', 'Third thing.']);
  });

  it('Restart goes back to the first sentence, and Stop clears the speech and the bar', () => {
    const { container } = render(<SpeakingBar />);
    act(() => speak(THREE, { key: 'a' }));
    act(() => synth.advance(0));
    act(() => synth.finish());
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(getSpeech()).toMatchObject({ status: 'playing', index: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(getSpeech().status).toBe('idle');
    expect(container.firstChild).toBeNull();
  });

  it('is hidden for the speech started under the key it is told to except', () => {
    const { container } = render(<SpeakingBar except="own-bar" />);
    act(() => speak(THREE, { key: 'own-bar' }));
    expect(container.firstChild).toBeNull();
    act(() => speak(THREE, { key: 'other' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('says its words through labels, and takes a class', () => {
    render(<SpeakingBar className="mine" labels={{ pause: 'Pausa', stop: 'Basta', region: 'Parlando' }} />);
    act(() => speak(THREE, { key: 'a' }));
    expect(screen.getByRole('button', { name: 'Pausa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Basta' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Parlando' }).className).toContain('mine');
    expect(DEFAULT_LABELS).toMatchObject({ pause: 'Pause', resume: 'Resume', restart: 'Restart', stop: 'Stop', region: 'Speaking' });
  });

  it('styles itself only through bk-speech classes', () => {
    render(<SpeakingBar />);
    act(() => speak(THREE, { key: 'a' }));
    const region = screen.getByRole('region', { name: 'Speaking' });
    expect(region.className).toContain('bk-speech');
    for (const button of region.querySelectorAll('button')) expect(button.className).toContain('bk-speech__button');
  });
});

describe('useSpeaking', () => {
  function Speaker({ id }: { id: string }) {
    const speaking = useSpeaking(id);
    return <p data-testid={`state-${id}`}>{speaking ? 'speaking' : 'quiet'}</p>;
  }

  it('tells whether that key is the one speaking', () => {
    render(
      <>
        <Speaker id="a" />
        <Speaker id="b" />
      </>,
    );
    expect(screen.getByTestId('state-a').textContent).toBe('quiet');
    act(() => speak(THREE, { key: 'a' }));
    expect(screen.getByTestId('state-a').textContent).toBe('speaking');
    expect(screen.getByTestId('state-b').textContent).toBe('quiet');
    act(() => speak('Another.', { key: 'b' }));
    expect(screen.getByTestId('state-a').textContent).toBe('quiet');
    expect(screen.getByTestId('state-b').textContent).toBe('speaking');
  });

  it('still counts a paused speech as its own, and goes quiet when the speech ends', () => {
    render(<Speaker id="a" />);
    act(() => speak('One.', { key: 'a' }));
    act(() => pause());
    expect(screen.getByTestId('state-a').textContent).toBe('speaking');
    act(() => stop());
    expect(screen.getByTestId('state-a').textContent).toBe('quiet');
  });

  it('pauses the speech it started when its screen is left, and leaves another speaker\'s alone', () => {
    const { unmount } = render(<Speaker id="a" />);
    act(() => speak(THREE, { key: 'a' }));
    unmount();
    expect(getSpeech()).toMatchObject({ status: 'paused', key: 'a' });
    expect(isSpeaking('a')).toBe(true);

    act(() => speak(THREE, { key: 'b' }));
    const other = render(<Speaker id="a" />);
    other.unmount();
    expect(getSpeech()).toMatchObject({ status: 'playing', key: 'b' });
  });
});

describe('useSpeech', () => {
  it('follows what is speaking now', () => {
    function Status() {
      const speech = useSpeech();
      return <p data-testid="status">{`${speech.status} ${speech.index}/${speech.count}`}</p>;
    }
    render(<Status />);
    expect(screen.getByTestId('status').textContent).toBe('idle 0/0');
    act(() => speak(THREE, { key: 'a' }));
    expect(screen.getByTestId('status').textContent).toBe('playing 0/3');
    act(() => synth.advance(0));
    act(() => synth.finish());
    expect(screen.getByTestId('status').textContent).toBe('playing 1/3');
  });
});
