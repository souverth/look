// Undo and redo for the Customize Super Actions editor. It keeps the draft as
// JSON strings, so a step is a value rather than a reference into a draft that
// keeps changing.

export function createHistory(limit) {
    let undoStack = [];
    let redoStack = [];
    return {
        /** Call with the draft as it is BEFORE an edit. A new edit ends the redo trail. */
        record(json) {
            undoStack.push(json);
            if (undoStack.length > limit) undoStack.shift();
            redoStack = [];
        },
        /** The draft to go back to, or null when there is nothing to undo. */
        undo(currentJson) {
            if (!undoStack.length) return null;
            redoStack.push(currentJson);
            return undoStack.pop();
        },
        /** The draft to go forward to, or null when there is nothing to redo. */
        redo(currentJson) {
            if (!redoStack.length) return null;
            undoStack.push(currentJson);
            return redoStack.pop();
        },
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        clear() {
            undoStack = [];
            redoStack = [];
        },
    };
}
