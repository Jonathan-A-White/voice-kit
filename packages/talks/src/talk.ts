// talk.ts (mw-79en7t.29) — the turn loop of a talk over a grind the app injects. Carved from Lampas's src/services/talk.ts
// (buildTalkRequest, fitHistory, askTalk) and src/talk/pictures.ts with the Bible and Greek parts left behind: the loop knows
// a message, the earlier turns and any pictures, hands them to `send(request, files)` (any grind: a model call, a mill, a
// fake) and keeps what he said and what came back, in order, with the times. It touches no DOM and no React, so the Composer's
// useTalk (or any other way of getting the words) drives it with `onWords: (text) => talks.ask(id, text)`.
import type { Picture, Role, Talk, TalkStore, Turn } from './store.js';

/** A picture ready to send: its bytes, type and the name it goes under. */
export type OutgoingPicture = Picture;

/** The most pictures one message carries. */
export const TALK_MAX_PICTURES = 4;
/** The kinds of picture a message may carry. */
export const TALK_PICTURE_MIMES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
/** How many earlier turns the grind is sent. */
export const MAX_HISTORY_TURNS = 10;
/** What he asks when he sends pictures and no words. */
export const PICTURE_ONLY_QUESTION = 'Read the picture and tell me about it.';

/** A long answer in the history is cut to this many characters when the request is too big. */
const CLIPPED_CHARS = 240;
const CLIP_MARK = '…';

/** Whether a file may be sent as a picture: its type is one of the allowed. */
export const isTalkPicture = (file: { type: string }): boolean => TALK_PICTURE_MIMES.includes(file.type);

/** The picture as a data URL to draw it by. A data URL has no life to manage (an object URL must be revoked, and a StrictMode remount revokes one still in use). */
export function dataUrlOf(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

/** One earlier turn as the request carries it: who and the words. Pictures never ride in the history. */
export interface HistoryEntry {
  role: Role;
  text: string;
}

/** What the default request holds. `pictures` is there only when files go with this message: how many. */
export interface TalkRequest {
  message: string;
  history: HistoryEntry[];
  pictures?: number;
}

/** What a request is built from. */
export interface RequestInput {
  talk: Talk;
  /** What he said now, trimmed (the picture-only question when he said nothing and sent pictures). */
  message: string;
  /** The last `maxHistory` turns of the talk, oldest first, before this message. */
  turns: Turn[];
  /** The files that go with this message, as `send` gets them: the resent pictures, then the new ones. */
  pictures: OutgoingPicture[];
}

/** Wrong input to `ask`: nothing was sent and nothing kept. */
export class TalkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TalkInputError';
  }
}

export interface AskOptions {
  /** Pictures sent with this message: at most `maxPictures`, of the allowed types. They are kept with his turn. */
  pictures?: OutgoingPicture[];
  /**
   * Indexes (in the talk's turns) of earlier turns whose kept pictures go again with this message. A kept picture is otherwise
   * never sent twice: the history is text only.
   */
  resend?: number[];
}

export interface Asked<Answer> {
  /** What the grind answered. */
  answer: Answer;
  /** The turn kept for what he said. */
  user: Turn;
  /** The turn kept for the answer. */
  reply: Turn;
  /** The talk as it stands now. */
  talk: Talk;
}

interface BaseOptions<Request, Answer> {
  store: TalkStore;
  /** The grind: gets the request and the files and answers. A throw is the ask's: nothing is kept. */
  send: (request: Request, files: OutgoingPicture[]) => Promise<Answer>;
  /** The text of an answer, kept as the assistant's turn. Understands a string, or an object with a string `text` or `answer`; otherwise give this. */
  answerText?: (answer: Answer) => string;
  /** How many earlier turns a request carries; MAX_HISTORY_TURNS unless given. */
  maxHistory?: number;
  /** The most pictures a message carries; TALK_MAX_PICTURES unless given. */
  maxPictures?: number;
  /** The types of picture allowed; TALK_PICTURE_MIMES unless given. */
  pictureMimes?: readonly string[];
  /** What is asked of pictures with no words; PICTURE_ONLY_QUESTION unless given. */
  pictureOnlyText?: string;
  /** The clock: Date.now unless given. */
  now?: () => number;
}

export interface TalksOptions<Answer> extends BaseOptions<TalkRequest, Answer> {
  buildRequest?: undefined;
  /** With the default request: the most bytes the request may weigh as JSON; the history is cut to fit (fitHistory). No limit unless given. */
  maxRequestBytes?: number;
}

export interface CustomTalksOptions<Request, Answer> extends BaseOptions<Request, Answer> {
  /** Makes the request for any grind from what the loop knows. */
  buildRequest: (input: RequestInput) => Request;
}

export interface Talks<Answer> {
  /** Starts a talk in the store. */
  start(init?: { title?: string }): Promise<Talk>;
  /**
   * Says `message` in the talk: builds the request from the earlier turns, sends it, and keeps his turn and the answer's.
   * Asks on one talk are taken one at a time in the order made. A failure of the grind or a wrong input keeps nothing.
   */
  ask(id: string, message: string, options?: AskOptions): Promise<Asked<Answer>>;
}

function defaultAnswerText(answer: unknown): string {
  if (typeof answer === 'string') return answer;
  if (answer && typeof answer === 'object') {
    const { text, answer: inner } = answer as { text?: unknown; answer?: unknown };
    if (typeof text === 'string') return text;
    if (typeof inner === 'string') return inner;
  }
  throw new TypeError('The grind answered something that is not text: give createTalks an answerText.');
}

const sizeOf = (request: unknown): number => new TextEncoder().encode(JSON.stringify(request)).length;

/**
 * Makes the default request fit `maxBytes`: while it is too big the oldest long answer in the history is cut short; when none is
 * left to cut the oldest turn is dropped. The message is never touched.
 */
export function fitHistory(request: TalkRequest, maxBytes: number): TalkRequest {
  let history = request.history.map((t) => ({ ...t }));
  const fitted = (): TalkRequest => ({ ...request, history });
  const tooBig = (): boolean => sizeOf(fitted()) > maxBytes;
  for (;;) {
    const long = history.findIndex((t) => t.role === 'assistant' && t.text.length > CLIPPED_CHARS);
    if (!tooBig() || long < 0) break;
    history[long] = { ...history[long], text: history[long].text.slice(0, CLIPPED_CHARS - CLIP_MARK.length).trimEnd() + CLIP_MARK };
  }
  while (history.length > 0 && tooBig()) history = history.slice(1);
  return fitted();
}

export function createTalks<Answer = string>(options: TalksOptions<Answer>): Talks<Answer>;
export function createTalks<Request, Answer = string>(options: CustomTalksOptions<Request, Answer>): Talks<Answer>;
export function createTalks(options: TalksOptions<unknown> | CustomTalksOptions<unknown, unknown>): Talks<unknown> {
  const {
    store,
    answerText = defaultAnswerText,
    maxHistory = MAX_HISTORY_TURNS,
    maxPictures = TALK_MAX_PICTURES,
    pictureMimes = TALK_PICTURE_MIMES,
    pictureOnlyText = PICTURE_ONLY_QUESTION,
    now = Date.now,
  } = options;
  // the overloads keep the request and the builder in step; inside, the request is whatever the builder made
  const send = options.send as (request: unknown, files: OutgoingPicture[]) => Promise<unknown>;
  const custom = options.buildRequest;
  const maxRequestBytes = 'maxRequestBytes' in options ? options.maxRequestBytes : undefined;
  // asks on one talk wait for the one before, so the turns are kept in the order they were asked
  const queues = new Map<string, Promise<unknown>>();

  function build(input: RequestInput): unknown {
    if (custom) return custom(input);
    const request: TalkRequest = {
      message: input.message,
      history: input.turns.map(({ role, text }) => ({ role, text })),
      ...(input.pictures.length > 0 ? { pictures: input.pictures.length } : {}),
    };
    return maxRequestBytes === undefined ? request : fitHistory(request, maxRequestBytes);
  }

  async function run(id: string, message: string, { pictures = [], resend = [] }: AskOptions): Promise<Asked<unknown>> {
    if (pictures.length > maxPictures) throw new TalkInputError(`${maxPictures} pictures at most; ${pictures.length} were given.`);
    for (const picture of pictures) {
      if (!pictureMimes.includes(picture.mime)) throw new TalkInputError(`${picture.name} is ${picture.mime}; only ${pictureMimes.join(', ')} can be sent.`);
    }
    const text = message.trim() || (pictures.length > 0 ? pictureOnlyText : '');
    if (!text) throw new TalkInputError('There is nothing to say: no words and no pictures.');
    const talk = await store.get(id);
    if (!talk) throw new TalkInputError(`There is no talk ${JSON.stringify(id)}.`);
    const again = resend.flatMap((index) => {
      const kept = talk.turns[index]?.pictures;
      if (!kept?.length) throw new TalkInputError(`Turn ${index} has no pictures to send again.`);
      return kept;
    });
    const files = [...again, ...pictures];
    if (files.length > maxPictures) throw new TalkInputError(`${maxPictures} pictures at most; ${files.length} would go.`);

    const at = now();
    const request = build({ talk, message: text, turns: maxHistory > 0 ? talk.turns.slice(-maxHistory) : [], pictures: files });
    const answer = await send(request, files);
    const user: Turn = { role: 'user', text, ...(pictures.length > 0 ? { pictures } : {}), at };
    const reply: Turn = { role: 'assistant', text: answerText(answer), at: now() };
    const kept = await store.append(id, [user, reply]);
    return { answer, user, reply, talk: kept };
  }

  return {
    start: (init = {}) => store.create({ title: init.title, now: now() }),
    ask(id, message, askOptions = {}) {
      const result = (queues.get(id) ?? Promise.resolve()).then(() => run(id, message, askOptions));
      const tail = result.catch(() => undefined);
      queues.set(id, tail);
      void tail.then(() => {
        if (queues.get(id) === tail) queues.delete(id);
      });
      return result;
    },
  };
}
