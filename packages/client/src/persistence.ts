// @web-forth/client persistence constants (SPEC.md §T.25, §V.21). The editor buffer text
// is autosaved to localStorage under this key and restored at boot. Only the buffer text
// persists, never dictionary state (re-running reconstructs words, §I.persistence).

// localStorage key for the editor source (§I.persistence).
export const STORAGE_KEY = 'web-forth.source'

// Debounce window for autosave (§V.21). An edit schedules a save this many ms later; a
// newer edit within the window supersedes it (generation-token guard in update).
export const SAVE_DEBOUNCE_MS = 500
