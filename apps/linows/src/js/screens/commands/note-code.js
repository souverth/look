// Code blocks in /note's Preview: syntax highlighting and the Copy button.

import { highlightCode } from '../../ipc.js';

// Highlighted HTML per (language, source), so re-rendering the preview (a task
// tick, flipping back to it) repaints code at once instead of flashing plain.
const highlightCache = new Map();
const HIGHLIGHT_CACHE_MAX = 200;

export function highlightCodeBlocks(root) {
    for (const code of root.querySelectorAll('code[data-lang]')) {
        const lang = code.dataset.lang;
        if (!lang) continue;
        const source = code.textContent;
        const key = `${lang}\u0000${source}`;
        const hit = highlightCache.get(key);
        if (hit !== undefined) {
            code.innerHTML = hit;
            continue;
        }
        highlightCode(source, lang)
            .then((res) => {
                if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
                    highlightCache.delete(highlightCache.keys().next().value);
                }
                highlightCache.set(key, res.html);
                // The preview may have been re-rendered while this was in flight.
                if (code.isConnected) code.innerHTML = res.html;
            })
            .catch((err) => console.error('[note] highlight failed:', err));
    }
}

// Copies the block's plain text; the highlight spans add no characters, so the
// code element's text is exactly what was written in the note.
export async function copyCode(button) {
    const code = button.closest('.md-code')?.querySelector('code');
    if (!code) return;
    try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = 'Copied';
        button.classList.add('copied');
    } catch (err) {
        console.error('[note] copy failed:', err);
        button.textContent = 'Failed';
    }
    setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('copied');
    }, 1500);
}
