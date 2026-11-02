// Colours for /note's tags. Lives apart from the screen so the card grid, the
// editor and the filter bar can all ask for the same swatch.

// Tag colours: the user can pick one per tag (stored, see tagPicks); a tag
// with no pick gets a fixed colour derived from its name, so it still looks
// the same on a card, in the editor and in the filter bar. The palette length
// must match TAG_PALETTE_SIZE in core/notes.
//
// The first ten are the colours a tag gets by itself; the rest are only for
// picking, so adding them did not recolour any tag already on screen. Each entry
// has a hue (TAG_HUES) and a saturation (TAG_SAT, 68 where it is not listed).
export const TAG_HUES = [
    212, 152, 28, 340, 268, 48, 184, 4, 96, 304,
    // Brighter and deeper variants, then the muted and neutral ones.
    200, 236, 120, 172, 16, 60, 322, 290, 0, 220, 30, 160, 250, 350, 76, 140,
];
const TAG_SAT = { 10: 80, 11: 60, 12: 52, 13: 56, 14: 82, 15: 74, 16: 70, 17: 46, 18: 0, 19: 14, 20: 42, 21: 30, 22: 36, 23: 40, 24: 60, 25: 36 };
/** How many of the palette a tag may be given by name. */
const AUTO_COLOURS = 10;
export const tagPicks = new Map(); // tag -> palette index

function autoTagIndex(tag) {
    let h = 0;
    for (const ch of tag) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % AUTO_COLOURS;
}

export const tagIndex = (tag) => tagPicks.get(tag) ?? autoTagIndex(tag);

export function swatchStyle(index) {
    const hue = TAG_HUES[index];
    const sat = TAG_SAT[index] ?? 68;
    return `--tag-bg:hsl(${hue} ${sat}% 72%);--tag-fg:hsl(${hue} ${Math.min(45, sat)}% 16%)`;
}

export const tagStyle = (tag) => swatchStyle(tagIndex(tag));