// @vitest-environment jsdom
// The React entry: useHandsFree follows the session's state, HandsFreeMark draws it by data-state with the app's accessible name,
// useThreeFingerTap listens on the document until it unmounts (driven by the testing entry's threeFingerTap).
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { threeFingerTap } from 'voice-kit/testing/handsfree';
import { HandsFreeMark, useHandsFree, useThreeFingerTap, type HandsFreeSource } from '../src/react.js';
import type { HandsFreeState } from '../src/session.js';

afterEach(cleanup);

function fakeSession(first: HandsFreeState = { name: 'off' }) {
  let current = first;
  const listeners = new Set<(s: HandsFreeState) => void>();
  const session: HandsFreeSource = {
    state: () => current,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
  };
  return {
    session,
    set(next: HandsFreeState) {
      current = next;
      for (const l of [...listeners]) l(next);
    },
    get listeners() {
      return listeners.size;
    },
  };
}

const ALL: HandsFreeState[] = [
  { name: 'off' },
  { name: 'starting' },
  { name: 'waiting' },
  { name: 'listening' },
  { name: 'working' },
  { name: 'follow-up' },
  { name: 'needs-touch' },
  { name: 'failed', kind: 'permission-denied', message: 'The microphone was not allowed.' },
];

describe('useHandsFree', () => {
  it('re-renders on each state and stops following when it unmounts', () => {
    const fake = fakeSession();
    const renders: string[] = [];
    function Probe() {
      const state = useHandsFree(fake.session);
      renders.push(state.name);
      return <p data-testid="name">{state.name}</p>;
    }
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('off');
    for (const state of ALL.slice(1)) {
      act(() => fake.set(state));
      expect(screen.getByTestId('name').textContent).toBe(state.name);
    }
    expect(new Set(renders)).toEqual(new Set(ALL.map((s) => s.name)));
    expect(fake.listeners).toBe(1);
    unmount();
    expect(fake.listeners).toBe(0);
  });
});

describe('HandsFreeMark', () => {
  it('carries data-state for each state and the accessible name it was given', () => {
    for (const state of ALL) {
      const { unmount } = render(<HandsFreeMark state={state} label="Hands-free mic" />);
      const mark = screen.getByRole('img', { name: 'Hands-free mic' });
      expect(mark.getAttribute('data-state')).toBe(state.name);
      expect(mark.className).toContain('bk-handsfree');
      unmount();
    }
  });

  it('takes a state name too, and is a button when given a click', () => {
    const onClick = vi.fn();
    render(<HandsFreeMark state="needs-touch" label="Touch to start" onClick={onClick} className="mine" />);
    const button = screen.getByRole('button', { name: 'Touch to start' });
    expect(button.getAttribute('data-state')).toBe('needs-touch');
    expect(button.className).toBe('bk-handsfree mine');
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has no text of its own: the name is the app\'s', () => {
    const { container } = render(<HandsFreeMark state="listening" label="Escuchando" />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('useThreeFingerTap', () => {
  it('calls its latest handler on a three-finger tap and stops on unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    function Page({ onTap }: { onTap: () => void }) {
      useThreeFingerTap(onTap);
      return <p>page</p>;
    }
    const { rerender, unmount } = render(<Page onTap={first} />);
    threeFingerTap(document.body);
    expect(first).toHaveBeenCalledTimes(1);
    rerender(<Page onTap={second} />);
    threeFingerTap(document.body);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    threeFingerTap(document.body);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('leaves alone what skip names', () => {
    const onTap = vi.fn();
    function Page() {
      useThreeFingerTap(onTap, { skip: (t) => t instanceof Element && t.id === 'map' });
      return <div id="map">map</div>;
    }
    render(<Page />);
    threeFingerTap(document.getElementById('map')!);
    expect(onTap).not.toHaveBeenCalled();
    threeFingerTap(document.body);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
