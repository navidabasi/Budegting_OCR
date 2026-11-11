// Per-device chat preferences (localStorage; the history itself lives in the account):
//   keep history  - default on; off = new chats are session-only and nothing new is written
//   open chat     - which conversation is open, remembered across restarts (per user)
import { useCallback, useSyncExternalStore } from 'react';

const KEEP_KEY = 'wmw.chatKeepHistory';
const openKey = (userId) => `wmw.chatOpen:${userId || 'anon'}`;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
};

const read = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const write = (key, value) => {
    try {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        /* per-device convenience only */
    }
    emit();
};

export const getKeepChatHistory = () => read(KEEP_KEY) !== 'off';
export const setKeepChatHistory = (on) => write(KEEP_KEY, on ? 'on' : 'off');
export const getOpenConversationId = (userId) => read(openKey(userId)) || null;
export const setOpenConversationId = (userId, id) => write(openKey(userId), id || null);

export function useKeepChatHistory() {
    const keep = useSyncExternalStore(subscribe, getKeepChatHistory, () => true);
    return [keep, setKeepChatHistory];
}

/** [openConversationId | null, setOpenConversationId(id | null)] */
export function useOpenConversation(userId) {
    const id = useSyncExternalStore(subscribe, () => getOpenConversationId(userId), () => null);
    const set = useCallback((next) => setOpenConversationId(userId, next), [userId]);
    return [id, set];
}
