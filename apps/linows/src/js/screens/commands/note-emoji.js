// `:name` emoji completion in /note: where a name starts, what matches it, and
// `:name:` turning into the emoji as soon as the closing colon is typed. Pure, so
// the rules are tested under node; note.js only draws the list and applies the pick.

import { EMOJI } from './note-emoji-data.js';

const BY_NAME = new Map(EMOJI);

// Names people reach for first, so `:s` offers `smile` before `sa`... .
const POPULAR = ['smile', '+1', '-1', 'heart', 'tada', 'fire', 'rocket', 'eyes', 'thinking', 'joy', 'pray', 'clap', 'sparkles', 'white_check_mark', 'x', 'warning', 'bug', 'memo', 'bulb', 'star', 'zap', '100'];
const RANK = new Map(POPULAR.map((name, i) => [name, i]));

/**
 * A `:` and at least two name characters ending at the caret: `{ from, query }`
 * (`from` is where the colon is), or null. The colon must start a word, so `12:30`
 * and `https://` never open the list.
 */
export function emojiContext(text, caret) {
    const before = text.slice(Math.max(0, caret - 40), caret);
    const m = before.match(/(^|[\s(>])(:[a-z0-9_+-]{2,})$/i);
    if (!m) return null;
    return { from: caret - m[2].length, query: m[2].slice(1).toLowerCase() };
}

/** Matches for `query`: an exact name, then names starting with it, then names containing it. */
export function filterEmoji(query, limit = 40) {
    const exact = [];
    const starts = [];
    const has = [];
    for (const [name, char] of EMOJI) {
        if (name === query) exact.push({ name, char });
        else if (name.startsWith(query)) starts.push({ name, char });
        else if (name.includes(query)) has.push({ name, char });
    }
    // Within a group: popular names first, then shorter, then alphabetical.
    const order = (a, b) =>
        (RANK.get(a.name) ?? 99) - (RANK.get(b.name) ?? 99) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name);
    return [...exact, ...starts.sort(order), ...has.sort(order)].slice(0, limit);
}

/** The emoji for a finished `:name:`, or null when there is no such name. */
export function emojiFor(name) {
    return BY_NAME.get(name.toLowerCase()) ?? null;
}
