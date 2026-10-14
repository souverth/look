// Colours for /note's tags. Lives apart from the screen so the card grid, the
// editor and the filter bar can all ask for the same swatch.

// Tag colours: the user can pick one per tag (stored, see tagPicks); a tag
// with no pick gets a fixed colour derived from its name, so it still looks
// the same on a card, in the editor and in the filter bar. The palette length
// must match TAG_PALETTE_SIZE in core/notes.
export const TAG_HUES = [212, 152, 28, 340, 268, 48, 184, 4, 96, 304];
export const tagPicks = new Map(); // tag -> palette index

function autoTagIndex(tag) {
    let h = 0;
    for (const ch of tag) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % TAG_HUES.length;
}

export const tagIndex = (tag) => tagPicks.get(tag) ?? autoTagIndex(tag);

export function swatchStyle(index) {
    const hue = TAG_HUES[index];
    return `--tag-bg:hsl(${hue} 68% 72%);--tag-fg:hsl(${hue} 45% 16%)`;
}

export const tagStyle = (tag) => swatchStyle(tagIndex(tag));
