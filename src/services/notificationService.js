import { getTrackingStatus } from '../utils/tracking';

export const DEFAULT_DAILY_REMINDER_TIME = '20:00';
const PROMPT_REMINDER_MS = 48 * 60 * 60 * 1000;
const NOTIFICATION_DEDUPE_KEY_PREFIX = 'receipt-manager-notification-dedupe:';
const MAX_DEDUPE_DAYS = 14;

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    enabled: false,
    paymentDueAlertsEnabled: true,
    dailyExpenseReminderEnabled: false,
    dailyExpenseReminderTime: DEFAULT_DAILY_REMINDER_TIME,
    configuredAt: null,
    lastSetupPromptAt: null,
});

function isValidIsoDate(value) {
    if (!value || typeof value !== 'string') {
        return false;
    }

    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
}

function normalizeTime(value) {
    if (typeof value !== 'string') {
        return DEFAULT_DAILY_REMINDER_TIME;
    }

    const normalized = value.trim();
    const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
        return DEFAULT_DAILY_REMINDER_TIME;
    }

    return `${match[1]}:${match[2]}`;
}

function parseSettingsJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function toLocalDayStart(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    parsed.setHours(0, 0, 0, 0);
    return parsed;
}

function parseReminderDays(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
}

function getStorage() {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function normalizeNotificationPreferences(rawPreferences) {
    const parsed = parseSettingsJson(rawPreferences);
    return {
        enabled: Boolean(parsed?.enabled),
        paymentDueAlertsEnabled:
            parsed?.paymentDueAlertsEnabled === undefined
                ? DEFAULT_NOTIFICATION_PREFERENCES.paymentDueAlertsEnabled
                : Boolean(parsed.paymentDueAlertsEnabled),
        dailyExpenseReminderEnabled:
            parsed?.dailyExpenseReminderEnabled === undefined
                ? DEFAULT_NOTIFICATION_PREFERENCES.dailyExpenseReminderEnabled
                : Boolean(parsed.dailyExpenseReminderEnabled),
        dailyExpenseReminderTime: normalizeTime(parsed?.dailyExpenseReminderTime),
        configuredAt: isValidIsoDate(parsed?.configuredAt) ? parsed.configuredAt : null,
        lastSetupPromptAt: isValidIsoDate(parsed?.lastSetupPromptAt) ? parsed.lastSetupPromptAt : null,
    };
}

export function shouldShowNotificationSetupPrompt(rawPreferences, now = new Date()) {
    const preferences = normalizeNotificationPreferences(rawPreferences);
    if (preferences.configuredAt) {
        return false;
    }

    if (!preferences.lastSetupPromptAt) {
        return true;
    }

    const lastPromptAt = new Date(preferences.lastSetupPromptAt);
    return now.getTime() - lastPromptAt.getTime() >= PROMPT_REMINDER_MS;
}

export function getNotificationPermissionStatus() {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
        return 'unsupported';
    }

    return Notification.permission;
}

export function isNotificationSupported() {
    return getNotificationPermissionStatus() !== 'unsupported';
}

export async function requestNotificationPermission() {
    if (!isNotificationSupported()) {
        return 'unsupported';
    }

    try {
        return await Notification.requestPermission();
    } catch {
        return Notification.permission || 'default';
    }
}

export function sendBrowserNotification({ title, body, tag }) {
    if (getNotificationPermissionStatus() !== 'granted') {
        return false;
    }

    try {
        new Notification(title, {
            body,
            tag,
        });
        return true;
    } catch {
        return false;
    }
}

export function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function loadNotificationDedupe(userId) {
    const storage = getStorage();
    if (!storage || !userId) {
        return { sent: {} };
    }

    const key = `${NOTIFICATION_DEDUPE_KEY_PREFIX}${userId}`;
    try {
        const raw = storage.getItem(key);
        if (!raw) {
            return { sent: {} };
        }
        const parsed = JSON.parse(raw);
        return {
            sent: parsed?.sent && typeof parsed.sent === 'object' ? parsed.sent : {},
        };
    } catch {
        return { sent: {} };
    }
}

function saveNotificationDedupe(userId, state) {
    const storage = getStorage();
    if (!storage || !userId) return;

    const key = `${NOTIFICATION_DEDUPE_KEY_PREFIX}${userId}`;
    try {
        storage.setItem(key, JSON.stringify(state));
    } catch {
        // Ignore storage quota / private-mode errors.
    }
}

function pruneDedupeMap(sentMap, currentDayKey) {
    const currentDay = toLocalDayStart(currentDayKey);
    if (!currentDay) return sentMap;

    const nextMap = {};
    Object.entries(sentMap || {}).forEach(([entryKey, timestamp]) => {
        const dayKey = entryKey.split('|')[0];
        const dayDate = toLocalDayStart(dayKey);
        if (!dayDate) return;

        const diffDays = Math.floor((currentDay.getTime() - dayDate.getTime()) / (24 * 60 * 60 * 1000));
        if (diffDays <= MAX_DEDUPE_DAYS) {
            nextMap[entryKey] = timestamp;
        }
    });

    return nextMap;
}

export function hasNotificationBeenSent(userId, notificationKey, dayKey = getLocalDateKey()) {
    const state = loadNotificationDedupe(userId);
    return Boolean(state.sent?.[`${dayKey}|${notificationKey}`]);
}

export function markNotificationSent(userId, notificationKey, dayKey = getLocalDateKey(), sentAt = new Date().toISOString()) {
    const state = loadNotificationDedupe(userId);
    const nextSent = pruneDedupeMap(state.sent, dayKey);
    nextSent[`${dayKey}|${notificationKey}`] = sentAt;
    saveNotificationDedupe(userId, { sent: nextSent });
}

function getDaysUntil(targetDateValue, nowDate = new Date()) {
    const targetDate = toLocalDayStart(targetDateValue);
    if (!targetDate) return null;

    const today = new Date(nowDate);
    today.setHours(0, 0, 0, 0);
    const diffMs = targetDate.getTime() - today.getTime();
    return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

export function collectPaymentNotificationEvents(receipts = [], nowDate = new Date()) {
    const events = [];

    receipts.forEach((receipt) => {
        if (!receipt) return;

        if (receipt.recurringData?.isActive) {
            const dueDateValue = receipt.recurringData.nextDueDate || receipt.date;
            const daysUntilDue = getDaysUntil(dueDateValue, nowDate);
            if (daysUntilDue === null) return;

            const reminderDays = parseReminderDays(receipt.recurringData?.reminderDays);
            const baseKey = `recurring:${receipt.id || receipt.supabaseId}`;
            if (daysUntilDue === reminderDays) {
                events.push({
                    kind: 'due',
                    notificationKey: `${baseKey}:due`,
                    merchant: receipt.merchant || '',
                    daysUntilDue,
                });
            } else if (daysUntilDue < 0) {
                events.push({
                    kind: 'overdue',
                    notificationKey: `${baseKey}:overdue`,
                    merchant: receipt.merchant || '',
                    overdueDays: Math.abs(daysUntilDue),
                });
            }
            return;
        }

        const trackingStatus = getTrackingStatus(receipt);
        if (trackingStatus !== 'open') {
            return;
        }

        const daysUntilDue = getDaysUntil(receipt.date, nowDate);
        if (daysUntilDue === null) return;

        const baseKey = `tracked:${receipt.id || receipt.supabaseId}`;
        if (daysUntilDue === 0) {
            events.push({
                kind: 'due',
                notificationKey: `${baseKey}:due`,
                merchant: receipt.merchant || '',
                daysUntilDue: 0,
            });
        } else if (daysUntilDue < 0) {
            events.push({
                kind: 'overdue',
                notificationKey: `${baseKey}:overdue`,
                merchant: receipt.merchant || '',
                overdueDays: Math.abs(daysUntilDue),
            });
        }
    });

    return events;
}

export function shouldTriggerDailyExpenseReminder(rawPreferences, nowDate = new Date()) {
    const preferences = normalizeNotificationPreferences(rawPreferences);
    if (!preferences.enabled || !preferences.dailyExpenseReminderEnabled) {
        return false;
    }

    const [hoursString, minutesString] = preferences.dailyExpenseReminderTime.split(':');
    const reminderMinutes = (Number.parseInt(hoursString, 10) * 60) + Number.parseInt(minutesString, 10);
    const nowMinutes = (nowDate.getHours() * 60) + nowDate.getMinutes();
    return nowMinutes >= reminderMinutes;
}
