// Grid geometry for the Customize Super Actions editor: whether a tile fits,
// what it overlaps, where a new one can go. A "draft" is `{ columns, rows,
// tiles: [{ id, col, row, w, h }] }`, as the backend reports it. Pure, so the
// placement rules run under node.

/** `Hello-world_x` -> `Hello World X`: the title a custom tile gets with none. */
export function titleCase(id) {
    return id
        .split(/[-_]/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
}

export function overlaps(a, b) {
    return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

/** Whether `r` is a real rectangle wholly on the draft's grid. */
export function inside(r, draft) {
    return (
        r.col >= 0 &&
        r.row >= 0 &&
        r.w >= 1 &&
        r.h >= 1 &&
        r.col + r.w <= draft.columns &&
        r.row + r.h <= draft.rows
    );
}

/** Whether `rect` fits the grid and overlaps nothing but the tiles in `ignore`. */
export function fits(rect, draft, ignore = []) {
    if (!inside(rect, draft)) return false;
    return !draft.tiles.some((t) => !ignore.includes(t.id) && overlaps(rect, t));
}

/** The first free `w` x `h` spot, reading left to right then top to bottom. */
export function findSpot(draft, w, h) {
    for (let row = 0; row + h <= draft.rows; row++) {
        for (let col = 0; col + w <= draft.columns; col++) {
            if (fits({ col, row, w, h }, draft)) return { col, row };
        }
    }
    return null;
}
