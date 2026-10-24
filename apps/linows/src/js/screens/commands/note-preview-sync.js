// Map a source line to its rendered position, independent of document height.
export function previewLineY(points, line) {
    if (!points.length) return null;
    const sorted = [...points].sort((a, b) => a.line - b.line);
    let before = sorted[0];
    if (line <= before.line) return before.y;
    for (const after of sorted.slice(1)) {
        if (after.line > line) {
            const ratio = (line - before.line) / (after.line - before.line);
            return before.y + (after.y - before.y) * ratio;
        }
        before = after;
    }
    return before.y;
}

export function alignmentGoal(previewY, editorY) {
    const delta = previewY - editorY;
    // A short rendered note may need space above it to match the editor.
    return { scrollTop: Math.max(0, delta), topSpace: Math.max(0, -delta) };
}

/** Align a source row in a rendered pane; return the applied top spacer. */
export function alignPreview(preview, anchor, topSpace = 0) {
    const base = preview.getBoundingClientRect().top;
    const points = new Map();
    for (const el of preview.querySelectorAll('[data-source-line]')) {
        if (!el.getClientRects().length) continue;
        const line = Number(el.dataset.sourceLine);
        const y = el.getBoundingClientRect().top - base + preview.scrollTop - topSpace;
        points.set(line, { line, y });
        if (el.dataset.sourceCodeLines !== undefined) {
            const height = parseFloat(getComputedStyle(el).lineHeight) || 20;
            for (let n = 1; n <= Number(el.dataset.sourceCodeLines); n++) {
                points.set(line + n, { line: line + n, y: y + n * height });
            }
        }
    }
    const y = previewLineY([...points.values()], anchor.line);
    if (y === null) {
        preview.style.removeProperty('--preview-align-top');
        preview.style.removeProperty('--preview-align-room');
        preview.scrollTop = 0;
        return 0;
    }
    const goal = alignmentGoal(y, anchor.top - base);
    preview.style.setProperty('--preview-align-top', `${goal.topSpace}px`);
    preview.style.setProperty('--preview-align-room', `${preview.clientHeight}px`);
    preview.scrollTop = goal.scrollTop;
    return goal.topSpace;
}
