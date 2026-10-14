// Snippets found with `s"`: build the context a snippet's placeholders ask for,
// then copy the expanded text or paste it into the app underneath.
//
// The text itself is expanded in core/snippets; this side owns what core cannot
// know: the local clock, the clipboard history, a fresh id.

import {
    snippetsExpand,
    getClipboardHistory,
    copyToClipboard,
    clipboardPasteBlocker,
    pasteIntoFocusedApp,
} from '../ipc.js';
import * as banner from './banner.js';

// A refused paste is a sentence to read, not a flash.
const BLOCKED_SECS = 3.0;
const COPIED_SECS = 1.1;

const pad2 = (n) => String(n).padStart(2, '0');

/** What `{date}`, `{time}`, `{weekday}`, `{clipboard}` and `{uuid}` become. */
export function contextFor(now, clipboardText, uuid) {
    return {
        date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
        time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
        weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
        clipboard: clipboardText,
        uuid,
    };
}

// The newest clip, read before the paste overwrites it. A labelled entry (a
// calculator answer) carries the value it pastes as `payload`.
async function latestClipboardText() {
    try {
        const entries = await getClipboardHistory('');
        const newest = entries?.[0];
        return newest ? newest.payload || newest.text || '' : '';
    } catch {
        return '';
    }
}

const newUuid = () =>
    globalThis.crypto?.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

/** The text `id` would paste right now. */
export async function expand(id) {
    const context = contextFor(new Date(), await latestClipboardText(), newUuid());
    return snippetsExpand(id, context);
}

/** Ctrl+C: the expanded text onto the clipboard, nothing more. */
export async function copy(id) {
    try {
        await copyToClipboard(await expand(id));
        banner.show('Snippet copied', 'success', COPIED_SECS);
    } catch (err) {
        banner.show(typeof err === 'string' ? err : 'Copy failed', 'error', 1.2);
    }
}

/**
 * Enter: copy, then out of the way and into the app underneath. Asked before
 * hiding, since a banner behind a closed window explains nothing; the copy
 * happens either way, so a refusal leaves the text ready for a hand Ctrl+V.
 */
export async function paste(id) {
    try {
        await copyToClipboard(await expand(id));
    } catch (err) {
        banner.show(typeof err === 'string' ? err : 'Copy failed', 'error', 1.2);
        return;
    }
    try {
        const blocker = await clipboardPasteBlocker();
        if (blocker) {
            banner.show(blocker, 'warning', BLOCKED_SECS);
            return;
        }
        await pasteIntoFocusedApp();
    } catch {
        banner.show(
            'Nothing typed the paste - the snippet is copied, press Ctrl+V',
            'warning',
            BLOCKED_SECS,
        );
    }
}
