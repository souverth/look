// Pure formatting for the Super Actions widgets, kept apart from the modules that
// read live data so it can be tested without a window or a backend.

const WARN_PERCENT = 60;
const DANGER_PERCENT = 85;

/** 'warn' / 'danger' once a quota is getting tight, else null. */
export const toneOf = (percent) =>
    percent >= DANGER_PERCENT ? 'danger' : percent >= WARN_PERCENT ? 'warn' : null;

/** "5-hour limit" -> "5h", "Weekly limit" -> "Week": the short name a bar wears. */
export const windowName = (label = '') =>
    /5-?\s?hour/i.test(label)
        ? '5h'
        : /week/i.test(label)
          ? /opus|sonnet/i.test(label)
              ? label.match(/opus|sonnet/i)[0].replace(/^./, (c) => c.toUpperCase())
              : 'Week'
          : /daily|day/i.test(label)
            ? 'Day'
            : label.replace(/\s*limit.*/i, '') || 'Quota';

/** 12345 -> "12K", 1234567 -> "1.2M". */
export const tokens = (n) =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

/** A note's headline: its title, else its first line, else "Untitled". */
export const noteTitle = (n) =>
    n.title?.trim() || n.body?.split('\n').find((l) => l.trim())?.trim().slice(0, 60) || 'Untitled';
