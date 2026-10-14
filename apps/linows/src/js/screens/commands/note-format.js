// Text and date helpers for /note: what a card shows, how a date reads, new ids.
// No DOM in here, so they run under node.

export const PREVIEW_CHARS = 400;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = (n) => String(n).padStart(2, '0');

export function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatDate(unixS, now = new Date()) {
    const d = new Date(unixS * 1000);
    const sameDay = d.toDateString() === now.toDateString();
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (sameDay) return `Today ${time}`;
    const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
    return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

export function firstLine(body) {
    return plainPreview(body.split('\n').find((l) => l.trim()) || '').slice(0, 80);
}

export function dropFirstLine(body) {
    const lines = body.split('\n');
    const i = lines.findIndex((l) => l.trim());
    return i < 0 ? '' : lines.slice(i + 1).join('\n');
}

// Card text: Markdown markers stripped so the clamp shows words, not syntax.
export function plainPreview(body) {
    return body
        .slice(0, PREVIEW_CHARS * 2)
        .replace(/```[\w+-]*/g, '')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/(\*\*|__|~~|`|\*|_)/g, '')
        .replace(/\s*\n\s*/g, ' ')
        .trim()
        .slice(0, PREVIEW_CHARS);
}

export function newId() {
    return globalThis.crypto?.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
