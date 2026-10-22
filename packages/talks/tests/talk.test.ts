import { describe, expect, it, vi } from 'vitest';
import {
  PICTURE_ONLY_QUESTION,
  TALK_MAX_PICTURES,
  TalkInputError,
  createMemoryStore,
  createTalks,
  dataUrlOf,
  fitHistory,
  isTalkPicture,
  type OutgoingPicture,
  type TalkRequest,
} from '../src/index.js';

const picture = (n: number): OutgoingPicture => ({ bytes: new Uint8Array([n, n + 1, n + 2]), mime: 'image/jpeg', name: `picture-${n}.jpg` });

/** A clock that moves 1000 ms each time it is read, so every turn has its own time. */
function clock(start = 1_000_000) {
  let t = start - 1000;
  return () => (t += 1000);
}

/** A fake grind: answers "answer to <message>" and records what it was sent. */
function setup(options: { maxHistory?: number } = {}) {
  const store = createMemoryStore({ newId: (() => { let n = 0; return () => `talk-${++n}`; })() });
  const sent: { request: TalkRequest; files: OutgoingPicture[] }[] = [];
  const send = vi.fn(async (request: TalkRequest, files: OutgoingPicture[]) => {
    sent.push({ request, files });
    return `answer to ${request.message}`;
  });
  const talks = createTalks({ store, send, now: clock(), ...options });
  return { store, sent, send, talks };
}

describe('a talk of turns', () => {
  it('keeps a 30-turn talk in order with roles and times', async () => {
    const { talks, store } = setup();
    const talk = await talks.start({ title: 'Grace' });
    for (let i = 1; i <= 15; i++) await talks.ask(talk.id, `question ${i}`);
    const kept = (await store.get(talk.id))!;
    expect(kept.title).toBe('Grace');
    expect(kept.turns).toHaveLength(30);
    kept.turns.forEach((turn, i) => {
      const n = Math.floor(i / 2) + 1;
      expect(turn.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
      expect(turn.text).toBe(i % 2 === 0 ? `question ${n}` : `answer to question ${n}`);
    });
    const times = kept.turns.map((t) => t.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(30);
  });

  it('sends the earlier turns as the history, oldest first, the last maxHistory of them', async () => {
    const { talks, sent } = setup({ maxHistory: 4 });
    const talk = await talks.start();
    for (let i = 1; i <= 5; i++) await talks.ask(talk.id, `q${i}`);
    expect(sent[0].request.history).toEqual([]);
    expect(sent[1].request.history).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'answer to q1' },
    ]);
    expect(sent[4].request.message).toBe('q5');
    expect(sent[4].request.history.map((h) => h.text)).toEqual(['q3', 'answer to q3', 'q4', 'answer to q4']);
  });

  it('returns the answer and the two turns it kept', async () => {
    const { talks } = setup();
    const talk = await talks.start();
    const done = await talks.ask(talk.id, 'hello');
    expect(done.answer).toBe('answer to hello');
    expect(done.user).toMatchObject({ role: 'user', text: 'hello' });
    expect(done.reply).toMatchObject({ role: 'assistant', text: 'answer to hello' });
    expect(done.reply.at).toBeGreaterThan(done.user.at);
  });

  it('keeps nothing when the grind fails, and the talk goes on after it', async () => {
    const { store, talks } = setup();
    const talk = await talks.start();
    const failing = createTalks({ store, send: async () => { throw new Error('no answer'); } });
    await expect(failing.ask(talk.id, 'lost')).rejects.toThrow('no answer');
    expect((await store.get(talk.id))!.turns).toEqual([]);
    await talks.ask(talk.id, 'again');
    expect((await store.get(talk.id))!.turns.map((t) => t.text)).toEqual(['again', 'answer to again']);
  });

  it('turns asked at once are kept in the order they were asked', async () => {
    const { talks, store } = setup();
    const talk = await talks.start();
    await Promise.all(['a', 'b', 'c'].map((q) => talks.ask(talk.id, q)));
    expect((await store.get(talk.id))!.turns.map((t) => t.text)).toEqual(['a', 'answer to a', 'b', 'answer to b', 'c', 'answer to c']);
  });

  it('refuses a blank message with no pictures, and a talk that is not there', async () => {
    const { talks, send } = setup();
    const talk = await talks.start();
    await expect(talks.ask(talk.id, '   ')).rejects.toBeInstanceOf(TalkInputError);
    await expect(talks.ask('nope', 'hello')).rejects.toBeInstanceOf(TalkInputError);
    expect(send).not.toHaveBeenCalled();
  });

  it('takes a request builder and an answer reader for any grind', async () => {
    const store = createMemoryStore();
    const seen: unknown[] = [];
    const talks = createTalks({
      store,
      send: async (request: { q: string; past: string[]; pictures: number }, files) => {
        seen.push({ request, files: files.length });
        return { reply: { text: `re: ${request.q}` } };
      },
      buildRequest: ({ message, turns, pictures }) => ({ q: message, past: turns.map((t) => t.text), pictures: pictures.length }),
      answerText: (answer) => answer.reply.text,
    });
    const talk = await talks.start();
    await talks.ask(talk.id, 'one');
    const second = await talks.ask(talk.id, 'two');
    expect(second.answer).toEqual({ reply: { text: 're: two' } });
    expect(seen[1]).toEqual({ request: { q: 'two', past: ['one', 're: one'], pictures: 0 }, files: 0 });
    expect((await store.get(talk.id))!.turns.map((t) => t.text)).toEqual(['one', 're: one', 'two', 're: two']);
  });
});

describe('a picture turn', () => {
  it('is kept with its pictures and sent once, with the files and the count the request says', async () => {
    const { talks, store, sent } = setup();
    const talk = await talks.start();
    await talks.ask(talk.id, 'what does this say?', { pictures: [picture(1), picture(4)] });
    await talks.ask(talk.id, 'and now?');
    await talks.ask(talk.id, 'and after that?');

    // the first message carried both pictures, and its request said so
    expect(sent[0].files.map((f) => f.name)).toEqual(['picture-1.jpg', 'picture-4.jpg']);
    expect(sent[0].request.pictures).toBe(2);
    // the later messages did not carry them again
    expect(sent[1].files).toEqual([]);
    expect(sent[1].request.pictures).toBeUndefined();
    expect(sent[2].files).toEqual([]);
    // the history is text only
    expect(JSON.stringify(sent[2].request.history)).not.toContain('picture');
    // and the turn still has them
    const turns = (await store.get(talk.id))!.turns;
    expect(turns[0].pictures?.map((p) => p.name)).toEqual(['picture-1.jpg', 'picture-4.jpg']);
    expect(Array.from(turns[0].pictures![0].bytes)).toEqual([1, 2, 3]);
    expect(turns[1].pictures).toBeUndefined();
  });

  it('is never re-sent unless the ask names it', async () => {
    const { talks, sent } = setup();
    const talk = await talks.start();
    await talks.ask(talk.id, 'look at this', { pictures: [picture(1)] });
    for (let i = 0; i < 4; i++) await talks.ask(talk.id, `more ${i}`);
    expect(sent.slice(1).every((s) => s.files.length === 0 && s.request.pictures === undefined)).toBe(true);
    expect(sent.flatMap((s) => s.files)).toHaveLength(1);
  });

  it('is re-sent when the ask names its turn, before the new pictures, and the count follows the files', async () => {
    const { talks, sent } = setup();
    const talk = await talks.start();
    await talks.ask(talk.id, 'look at this', { pictures: [picture(1)] });
    await talks.ask(talk.id, 'in the first picture, what is at the top?', { resend: [0], pictures: [picture(7)] });
    expect(sent[1].files.map((f) => f.name)).toEqual(['picture-1.jpg', 'picture-7.jpg']);
    expect(sent[1].request.pictures).toBe(2);
    await expect(talks.ask(talk.id, 'turn 1 has none', { resend: [1] })).rejects.toBeInstanceOf(TalkInputError);
  });

  it('asks the picture-only question when there are pictures and no words', async () => {
    const { talks, sent } = setup();
    const talk = await talks.start();
    const done = await talks.ask(talk.id, '', { pictures: [picture(1)] });
    expect(sent[0].request.message).toBe(PICTURE_ONLY_QUESTION);
    expect(done.user.text).toBe(PICTURE_ONLY_QUESTION);
  });

  it('refuses too many pictures and a file that is not a picture, sending nothing', async () => {
    const { talks, send, store } = setup();
    const talk = await talks.start();
    const many = Array.from({ length: TALK_MAX_PICTURES + 1 }, (_, i) => picture(i));
    await expect(talks.ask(talk.id, 'too many', { pictures: many })).rejects.toBeInstanceOf(TalkInputError);
    await expect(talks.ask(talk.id, 'a pdf', { pictures: [{ ...picture(1), mime: 'application/pdf' }] })).rejects.toBeInstanceOf(TalkInputError);
    expect(send).not.toHaveBeenCalled();
    expect((await store.get(talk.id))!.turns).toEqual([]);
  });

  it('knows a picture by its type and draws one by a data URL', () => {
    expect(isTalkPicture({ type: 'image/png' })).toBe(true);
    expect(isTalkPicture({ type: 'image/gif' })).toBe(false);
    expect(dataUrlOf(new Uint8Array([104, 105]), 'image/png')).toBe('data:image/png;base64,aGk=');
  });
});

describe('maxRequestBytes', () => {
  it('cuts the history of the default request to fit, and keeps the whole talk', async () => {
    const store = createMemoryStore();
    const sent: TalkRequest[] = [];
    const talks = createTalks({ store, maxRequestBytes: 400, send: async (request: TalkRequest) => (sent.push(request), 'y'.repeat(300)) });
    const talk = await talks.start();
    for (let i = 0; i < 6; i++) await talks.ask(talk.id, `question ${i}`);
    expect(sent[5].history.length).toBeLessThan(10);
    expect(new TextEncoder().encode(JSON.stringify(sent[5])).length).toBeLessThanOrEqual(400);
    expect((await store.get(talk.id))!.turns).toHaveLength(12);
  });
});

describe('fitHistory', () => {
  const request = (history: { role: 'user' | 'assistant'; text: string }[]): TalkRequest => ({ message: 'now', history });

  it('leaves a request that fits alone', () => {
    const r = request([{ role: 'user', text: 'hi' }]);
    expect(fitHistory(r, 10_000)).toEqual(r);
  });

  it('cuts the oldest long answer short, then drops the oldest turns, never the message', () => {
    const long = 'x'.repeat(2000);
    const r = request([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: long },
      { role: 'user', text: 'second' },
      { role: 'assistant', text: long },
    ]);
    const size = (x: TalkRequest) => new TextEncoder().encode(JSON.stringify(x)).length;
    const clipped = fitHistory(r, 1000);
    expect(size(clipped)).toBeLessThanOrEqual(1000);
    expect(clipped.history.length).toBeGreaterThan(0);
    expect(clipped.history[0].text).toBe('first');
    expect(clipped.history[1].text.endsWith('…')).toBe(true);
    const tight = fitHistory(r, 120);
    expect(tight.message).toBe('now');
    expect(tight.history.length).toBeLessThan(4);
  });
});
