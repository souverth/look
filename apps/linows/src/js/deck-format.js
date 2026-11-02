// What the notes deck says about a note. Pure, so it runs under node.

/** The note's title, else the first line with anything on it, else a placeholder. */
export function noteLabel(note) {
    const title = String(note?.title ?? '').trim();
    if (title) return title;
    for (const line of String(note?.body ?? '').split('\n')) {
        // A Markdown marker is not part of what the line says.
        const text = line.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s+|\d+\.\s+)/, '').trim();
        if (text) return text;
    }
    return 'Untitled';
}

/** "now", "5m", "3h", "2d", "6w": how long ago, in the fewest characters. */
export function ageLabel(thenUnixS, nowUnixS) {
    const seconds = Math.max(0, nowUnixS - thenUnixS);
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

/** Newest first; a note that was never saved has no time and goes last. */
export const newestFirst = (a, b) => (b.updated_at_unix_s ?? 0) - (a.updated_at_unix_s ?? 0);
