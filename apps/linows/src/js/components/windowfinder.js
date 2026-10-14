// Windows found with `w"`: raise the one picked. The id is `hwnd:<handle>`, which
// the backend's running-apps path already knows how to focus and then hide Look
// for, so a row raises exactly its own window and not some window of its app.

import { activateRunningApp } from '../ipc.js';
import * as banner from './banner.js';

const GONE_SECS = 1.6;

/** True when the window was raised; false (with a banner) when it had closed. */
export async function switchTo(id) {
    try {
        // No process id: an `hwnd:` id names the window outright.
        if (await activateRunningApp(0, id, null)) return true;
    } catch (err) {
        console.error('[windowfinder] activate failed:', err);
    }
    banner.show('That window is gone', 'info', GONE_SECS);
    return false;
}
