// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryStore, type TalkStore } from '../src/index.js';
import { TalkList } from '../src/TalkList.js';

afterEach(cleanup);

async function seeded(): Promise<{ store: TalkStore; ids: string[] }> {
  const store = createMemoryStore();
  const a = await store.create({ title: 'Romans 8', now: 1 });
  const b = await store.create({ title: 'Grace', now: 2 });
  const c = await store.create({ now: 3 });
  await store.append(a.id, [
    { role: 'user', text: 'What is adoption in this chapter?', at: 10 },
    { role: 'assistant', text: 'It is being made a child of God.', at: 11 },
  ]);
  await store.append(b.id, [{ role: 'user', text: 'Tell me about firstfruits', at: 20 }]);
  await store.append(c.id, [{ role: 'user', text: 'Hello there', at: 30 }]);
  return { store, ids: [a.id, b.id, c.id] };
}

describe('TalkList', () => {
  it('lists the talks, the one added to last first, with a line under each', async () => {
    const { store } = await seeded();
    render(<TalkList store={store} onOpen={() => {}} />);
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Hello there'),
      expect.stringContaining('Tell me about firstfruits'),
      expect.stringContaining('What is adoption in this chapter?'),
    ]);
    expect(screen.getByText('Romans 8')).toBeTruthy();
    expect(screen.getByText('Grace')).toBeTruthy();
  });

  it('opens a talk: onOpen gets its id', async () => {
    const { store, ids } = await seeded();
    const onOpen = vi.fn();
    render(<TalkList store={store} onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: /Romans 8/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(ids[0]);
  });

  it('searches titles and turns through searchTalks and shows the matching line', async () => {
    const { store, ids } = await seeded();
    const onOpen = vi.fn();
    render(<TalkList store={store} onOpen={onOpen} />);
    await screen.findAllByRole('listitem');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search conversations' }), { target: { value: 'child of god' } });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByRole('listitem').textContent).toContain('It is being made a child of God.');
    fireEvent.click(screen.getByRole('button', { name: /Romans 8/ }));
    expect(onOpen).toHaveBeenCalledWith(ids[0]);
  });

  it('says so when nothing has those words, and when there are no talks', async () => {
    const { store } = await seeded();
    const { unmount } = render(<TalkList store={store} onOpen={() => {}} />);
    await screen.findAllByRole('listitem');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zebra' } });
    expect(await screen.findByText(/No conversation has those words/)).toBeTruthy();
    unmount();
    render(<TalkList store={createMemoryStore()} onOpen={() => {}} />);
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();
  });

  it('reads the store again when refreshKey changes', async () => {
    const { store } = await seeded();
    const { rerender } = render(<TalkList store={store} onOpen={() => {}} refreshKey={1} />);
    await screen.findAllByRole('listitem');
    await store.create({ title: 'Brand new', now: 99 });
    rerender(<TalkList store={store} onOpen={() => {}} refreshKey={2} />);
    expect(await screen.findByText('Brand new')).toBeTruthy();
  });
});
