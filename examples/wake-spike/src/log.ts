// The spike's log: every Play, Listen, input opened, track ended or muted, and devicechange, with the time, kept in
// localStorage so it survives a reload and can be copied out as JSON. Everything fails to a value: a full or refused
// storage keeps the log in memory only.

export interface LogEntry {
  /** ISO time the event happened. */
  time: string;
  event: string;
  detail?: Record<string, unknown>;
}

export const LOG_KEY = 'wake-spike-log';

/** The part of Storage the log uses. */
export type LogStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Log {
  add(event: string, detail?: Record<string, unknown>): LogEntry;
  entries(): LogEntry[];
  clear(): void;
  /** The log as JSON text, for Copy results. */
  toJson(): string;
  /** Called after every change. */
  onChange(listener: () => void): void;
}

function read(storage: LogStorage | undefined): LogEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LOG_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    return [];
  }
}

export function createLog(storage: LogStorage | undefined, now: () => Date = () => new Date()): Log {
  let kept = read(storage);
  const listeners: (() => void)[] = [];
  const save = () => {
    try {
      storage?.setItem(LOG_KEY, JSON.stringify(kept));
    } catch {
      /* kept in memory only */
    }
    listeners.forEach((listener) => listener());
  };
  return {
    add(event, detail) {
      const entry: LogEntry = detail ? { time: now().toISOString(), event, detail } : { time: now().toISOString(), event };
      kept = [...kept, entry];
      save();
      return entry;
    },
    entries: () => kept,
    clear() {
      kept = [];
      try {
        storage?.removeItem(LOG_KEY);
      } catch {
        /* nothing to remove */
      }
      listeners.forEach((listener) => listener());
    },
    toJson: () => JSON.stringify(kept, null, 2),
    onChange: (listener) => void listeners.push(listener),
  };
}
