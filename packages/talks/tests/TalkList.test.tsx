// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryStore, type TalkReader, type TalkStore } from '../src/index.js';
import { TalkList, type TalkListRow } from '../src/TalkList.js';

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

  it('draws the app\'s own row through renderRow; its open calls onOpen with that talk\'s id once', async () => {
    const { store, ids } = await seeded();
    const onOpen = vi.fn();
    render(
      <TalkList
        store={store}
        onOpen={onOpen}
        renderRow={(row, open) => (
          <button type="button" data-mine={row.id} onClick={open}>
            {row.summary.turnCount} / {row.line}
          </button>
        )}
      />,
    );
    await screen.findAllByRole('listitem');
    const mine = document.querySelectorAll('[data-mine]');
    expect(mine).toHaveLength(3);
    expect(document.querySelector('.bk-talklist__row')).toBeNull();
    fireEvent.click(document.querySelector(`[data-mine="${ids[0]}"]`)!);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(ids[0]);
    expect(document.querySelector(`[data-mine="${ids[0]}"]`)!.textContent).toBe('2 / What is adoption in this chapter?');
  });

  it('hides the talks filter refuses, and says the list is empty when every one is hidden', async () => {
    const { store } = await seeded();
    const { unmount } = render(<TalkList store={store} onOpen={() => {}} filter={(row) => row.title !== 'Grace'} />);
    await screen.findAllByRole('listitem');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('Grace')).toBeNull();
    unmount();
    render(<TalkList store={store} onOpen={() => {}} filter={() => false} />);
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('draws the app\'s note through renderNote, with the kit\'s text, for empty and noMatches', async () => {
    const { store } = await seeded();
    const renderNote = vi.fn((kind: string, text: string) => (
      <div data-note={kind}>{text}</div>
    ));
    const { unmount } = render(<TalkList store={createMemoryStore()} onOpen={() => {}} renderNote={renderNote} />);
    const empty = await waitFor(() => {
      const el = document.querySelector('[data-note="empty"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(empty.textContent).toMatch(/No conversations yet/);
    expect(document.querySelector('p.bk-talklist__note')).toBeNull();
    unmount();
    render(<TalkList store={store} onOpen={() => {}} renderNote={renderNote} />);
    await screen.findAllByRole('listitem');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zebra' } });
    const none = await waitFor(() => {
      const el = document.querySelector('[data-note="noMatches"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(none.textContent).toMatch(/No conversation has those words/);
  });

  it('draws the app\'s note for a store that could not be read', async () => {
    const broken: TalkReader = { list: () => Promise.reject(new Error('no')), get: async () => undefined };
    render(<TalkList store={broken} onOpen={() => {}} renderNote={(kind, text) => <div data-note={kind}>{text}</div>} />);
    const el = await waitFor(() => {
      const found = document.querySelector('[data-note="failed"]');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(el.textContent).toBe('The conversations could not be read.');
  });

  it('passes search options to searchTalks: the custom snippet is the row\'s line and row.hit is the hit', async () => {
    const { store, ids } = await seeded();
    const seen: TalkListRow<Record<string, unknown>>[] = [];
    render(
      <TalkList
        store={store}
        onOpen={() => {}}
        search={{ snippet: (text) => `«${text.length}»` }}
        renderRow={(row, open) => {
          seen.push(row);
          return (
            <button type="button" data-mine={row.id} onClick={open}>
              {row.line}
            </button>
          );
        }}
      />,
    );
    await screen.findAllByRole('listitem');
    // not searching: no hit, the line is the first text
    expect(seen.every((r) => r.hit === undefined)).toBe(true);
    seen.length = 0;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'child of god' } });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    const row = seen[seen.length - 1];
    expect(row.id).toBe(ids[0]);
    expect(row.line).toBe('«32»');
    expect(row.hit?.id).toBe(ids[0]);
    expect(row.hit?.matches.find((m) => m.in === 'turn')?.snippet).toBe('«32»');
    expect(row.summary.id).toBe(ids[0]);
    expect(row.summary.turnCount).toBe(2);
  });

  it('adds classNames beside the bk-talklist classes, and wraps the search field', async () => {
    const { store } = await seeded();
    const { container } = render(
      <TalkList
        store={store}
        onOpen={() => {}}
        classNames={{ root: 'r', searchWrap: 'w', search: 's', list: 'l', item: 'i', row: 'o', note: 'n' }}
      />,
    );
    await screen.findAllByRole('listitem');
    const root = container.firstElementChild!;
    expect(root.className).toBe('bk-talklist r');
    const wrap = root.querySelector('.bk-talklist__searchwrap')!;
    expect(wrap.className).toBe('bk-talklist__searchwrap w');
    expect(wrap.querySelector('input')!.className).toBe('bk-talklist__search s');
    expect(root.querySelector('ul')!.className).toBe('bk-talklist__list l');
    expect(root.querySelector('li')!.className).toBe('bk-talklist__item i');
    expect(root.querySelector('li > button')!.className).toBe('bk-talklist__row o');
    fireEvent.change(wrap.querySelector('input')!, { target: { value: 'zebra' } });
    await waitFor(() => expect(root.querySelector('p')!.className).toBe('bk-talklist__note n'));
  });

  it('renders a reader that has only list and get', async () => {
    const { store, ids } = await seeded();
    const reader: TalkReader = { list: (o) => store.list(o), get: (id) => store.get(id) };
    render(<TalkList store={reader} onOpen={() => {}} />);
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'firstfruits' } });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(ids).toHaveLength(3);
  });
});
