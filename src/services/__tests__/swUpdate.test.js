// The installed app must pick up every deploy: check for a new version when the app is opened or brought back from the
// background (a home-screen app resumes instead of reloading), and reload into it without throwing away what the user is typing.
import { describe, expect, it, vi } from 'vitest';
import { startUpdates } from '../swUpdate';

class FakeWorkbox {
    constructor() {
        this.handlers = {};
        this.update = vi.fn(async () => {});
        this.register = vi.fn(async () => ({}));
    }
    addEventListener(type, fn) {
        (this.handlers[type] ||= []).push(fn);
    }
    emit(type, event = {}) {
        (this.handlers[type] || []).forEach((fn) => fn(event));
    }
}

function setup({ hidden = false, focused = null, now = 0 } = {}) {
    const wb = new FakeWorkbox();
    const docListeners = {};
    const winListeners = {};
    const doc = {
        hidden,
        activeElement: focused,
        addEventListener: (t, fn) => (docListeners[t] ||= []).push(fn),
    };
    const win = {
        location: { reload: vi.fn() },
        addEventListener: (t, fn) => (winListeners[t] ||= []).push(fn),
        setInterval: vi.fn(),
        sessionStorage: { getItem: () => null, setItem: () => {} },
    };
    const clock = { t: now };
    const handle = startUpdates({ workbox: wb, doc, win, now: () => clock.t });
    const fire = (where, type, e = {}) => (where === 'doc' ? docListeners : winListeners)[type]?.forEach((fn) => fn(e));
    return { wb, doc, win, fire, clock, handle };
}

describe('service worker updates', () => {
    it('registers the worker and checks for a new version every 30 minutes', () => {
        const { wb, win } = setup();
        expect(wb.register).toHaveBeenCalledWith({ immediate: true });
        expect(win.setInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);
    });

    it('checks for a new version when the home-screen app comes back to the front, at most once every 10 seconds', () => {
        const { wb, doc, fire, clock } = setup({ now: 0 });
        clock.t = 120_000;
        doc.hidden = false;
        fire('doc', 'visibilitychange');
        expect(wb.update).toHaveBeenCalledTimes(1);
        clock.t = 125_000;
        fire('doc', 'visibilitychange');
        expect(wb.update).toHaveBeenCalledTimes(1);
        clock.t = 140_000;
        fire('win', 'online');
        expect(wb.update).toHaveBeenCalledTimes(2);
    });

    it('a new version that takes control reloads the app (the bug: it never did)', () => {
        const { wb, win } = setup();
        wb.emit('controlling', { isUpdate: true });
        expect(win.location.reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload while the user is typing: waits until the app is hidden or the field is left', () => {
        const input = { tagName: 'INPUT' };
        const { wb, win, doc, fire } = setup({ focused: input });
        wb.emit('controlling', { isUpdate: true });
        expect(win.location.reload).not.toHaveBeenCalled();
        doc.activeElement = null;
        fire('doc', 'focusout');
        expect(win.location.reload).toHaveBeenCalledTimes(1);
    });

    it('a reload waiting for the field reloads when the app goes to the background', () => {
        const { wb, win, doc, fire } = setup({ focused: { tagName: 'TEXTAREA' } });
        wb.emit('controlling', { isUpdate: true });
        doc.hidden = true;
        fire('doc', 'visibilitychange');
        expect(win.location.reload).toHaveBeenCalledTimes(1);
    });

    it('the first install does not reload', () => {
        const { wb, win } = setup();
        wb.emit('controlling', { isUpdate: false });
        expect(win.location.reload).not.toHaveBeenCalled();
    });

    it('a code chunk that no longer exists after a deploy reloads once, not in a loop', () => {
        const store = {};
        const { win, fire } = setup();
        win.sessionStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) };
        const e = { preventDefault: vi.fn() };
        fire('win', 'vite:preloadError', e);
        expect(win.location.reload).toHaveBeenCalledTimes(1);
        expect(e.preventDefault).toHaveBeenCalled();
        fire('win', 'vite:preloadError', { preventDefault: vi.fn() });
        expect(win.location.reload).toHaveBeenCalledTimes(1);
    });
});
