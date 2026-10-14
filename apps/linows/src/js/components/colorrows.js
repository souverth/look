// A list of colours to change, for the theme editors in Settings: each row has a
// swatch (the system colour picker), the colour as hex to type or paste, an opacity
// slider where the colour is meant to be see-through, and a button that puts it back
// to what the theme says. It keeps no colours of its own: `read(name)` says what a row
// shows, `onChange(name, colour)` hears each edit as it is made, `onReset(name)` a reset.

import { normalizeColor, parseColor, toHex, withAlpha } from '../theme-colors.js';
import { escapeHtml } from '../markdown.js';

/**
 * `catalog` is a list of `{ group, items: [{ name, label, alpha? }] }` (theme-colors.js).
 * Returns `{ refresh(overridden) }`: rereads every row, marking the names in `overridden`
 * (a Set) as changed from the theme.
 */
export function createColorRows({ container, catalog, read, onChange, onReset }) {
    container.classList.add('theme-colors');
    container.innerHTML = catalog
        .map(
            (g) =>
                `<div class="theme-colors-group"><div class="theme-colors-title">${escapeHtml(g.group)}</div>` +
                g.items
                    .map(
                        (item) =>
                            `<div class="theme-color-row" data-var="${item.name}"${item.alpha ? ' data-alpha="1"' : ''}>` +
                            `<span class="theme-color-label" title="${item.name}">${escapeHtml(item.label)}</span>` +
                            '<input type="color" class="theme-color-swatch" aria-label="Colour">' +
                            '<input type="text" class="theme-color-hex" spellcheck="false" autocomplete="off" maxlength="9" aria-label="Hex colour">' +
                            (item.alpha
                                ? '<input type="range" class="theme-color-alpha" min="0" max="100" step="1" title="Opacity" aria-label="Opacity">'
                                : '<span class="theme-color-alpha-gap"></span>') +
                            '<button type="button" class="theme-color-reset" title="Back to the theme\'s colour" aria-label="Reset">&#8634;</button>' +
                            '</div>',
                    )
                    .join('') +
                '</div>',
        )
        .join('');

    const rows = new Map([...container.querySelectorAll('.theme-color-row')].map((row) => [row.dataset.var, row]));

    // What a row shows for a colour: the swatch takes the opaque part, the slider the opacity.
    function paint(name, value) {
        const row = rows.get(name);
        const c = parseColor(value);
        if (!row || !c) return;
        row.querySelector('.theme-color-swatch').value = toHex({ ...c, a: 1 });
        const hex = row.querySelector('.theme-color-hex');
        // Not under the caret that is typing in it.
        if (document.activeElement !== hex) hex.value = toHex(c);
        const alpha = row.querySelector('.theme-color-alpha');
        if (alpha) alpha.value = String(Math.round(c.a * 100));
    }

    function refresh(overridden = new Set()) {
        for (const [name, row] of rows) {
            paint(name, read(name));
            row.classList.toggle('changed', overridden.has(name));
        }
    }

    container.addEventListener('input', (e) => {
        const row = e.target.closest('.theme-color-row');
        if (!row) return;
        const name = row.dataset.var;
        const current = parseColor(read(name)) ?? { r: 0, g: 0, b: 0, a: 1 };
        let next = null;
        if (e.target.classList.contains('theme-color-swatch')) {
            // The picker chooses the colour; the opacity the row already had stays.
            next = withAlpha(e.target.value, current.a);
        } else if (e.target.classList.contains('theme-color-alpha')) {
            next = withAlpha(toHex(current), Number(e.target.value) / 100);
        } else if (e.target.classList.contains('theme-color-hex')) {
            // Typing: act only on a whole colour, so half of one does nothing yet.
            next = normalizeColor(e.target.value);
        }
        if (!next) return;
        onChange(name, next);
        row.classList.add('changed');
        paint(name, next);
    });

    // Leaving the hex box with something that is not a colour puts the real one back.
    container.addEventListener('focusout', (e) => {
        if (!e.target.classList?.contains('theme-color-hex')) return;
        const row = e.target.closest('.theme-color-row');
        paint(row.dataset.var, read(row.dataset.var));
    });

    container.addEventListener('click', (e) => {
        const button = e.target.closest('.theme-color-reset');
        if (!button) return;
        const row = button.closest('.theme-color-row');
        onReset(row.dataset.var);
        row.classList.remove('changed');
        paint(row.dataset.var, read(row.dataset.var));
    });

    return { refresh };
}
