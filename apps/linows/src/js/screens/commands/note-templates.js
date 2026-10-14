// What a template becomes when it is used: its {{variables}} filled in and the place
// for the caret found. Pure, so it is tested under node; the files themselves are
// kept by the app (notes_templates_* in ipc.js).
//
//   {{title}}     the note's title, if it has one yet
//   {{date}}      2026-10-14
//   {{time}}      15:42
//   {{datetime}}  2026-10-14 15:42
//   {{weekday}}   Wednesday
//   {{cursor}}    where the caret lands (the end, when there is none)

export const VARIABLES = [
    ['{{title}}', 'The note title'],
    ['{{date}}', 'Today, 2026-10-14'],
    ['{{time}}', 'Now, 15:42'],
    ['{{datetime}}', 'Date and time'],
    ['{{weekday}}', 'Wednesday'],
    ['{{cursor}}', 'Where the caret goes'],
];

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * `{ text, caret }`: `body` with its variables filled in for `now`, and the offset
 * of the first {{cursor}} in that text. Unknown {{words}} are left as written, so a
 * template that talks about "{{this}}" still says it.
 */
export function expandTemplate(body, { title = '', now = new Date() } = {}) {
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const values = {
        title,
        date,
        time,
        datetime: `${date} ${time}`,
        weekday: WEEKDAYS[now.getDay()],
    };
    let caret = -1;
    let text = '';
    let last = 0;
    const token = /\{\{\s*([a-z]+)\s*\}\}/gi;
    for (let m = token.exec(body); m; m = token.exec(body)) {
        const name = m[1].toLowerCase();
        const known = name === 'cursor' || name in values;
        if (!known) continue;
        text += body.slice(last, m.index);
        if (name === 'cursor') {
            if (caret < 0) caret = text.length; // only the first one is the caret
        } else {
            text += values[name];
        }
        last = m.index + m[0].length;
    }
    text += body.slice(last);
    return { text, caret: caret < 0 ? text.length : caret };
}

/**
 * A one-line preview of a template: the first line with words of its own (not just a
 * {{variable}}), without its `#`; failing that, the first line with anything on it.
 */
export function firstLine(body) {
    const lines = String(body)
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').replace(/\{\{\s*cursor\s*\}\}/gi, '').trim())
        .filter(Boolean);
    const withWords = lines.find((l) => /[\p{L}\p{N}]/u.test(l.replace(/\{\{[^}]*\}\}/g, '')));
    return withWords || lines[0] || '';
}
