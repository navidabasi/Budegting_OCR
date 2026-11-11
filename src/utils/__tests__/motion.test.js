import { afterEach, describe, expect, it } from 'vitest';
import { DURATION, applyMotionMode, chartAnimation, resolveReduced } from '../motion';
import { useAppStore } from '../../store/appStore';

afterEach(() => {
    delete document.documentElement.dataset.motion;
    useAppStore.setState({ motionMode: 'system' });
});

describe('motion tokens', () => {
    it('matches the brief: press 120, inline 190, sheet/nav 260 ms', () => {
        expect(DURATION).toEqual({ press: 120, inline: 190, sheet: 260 });
    });
    it('the CSS and Tailwind tokens carry the same numbers', async () => {
        const fs = await import('node:fs');
        const css = fs.readFileSync('src/index.css', 'utf8');
        expect(css).toMatch(/--mo-press: 120ms; --mo-inline: 190ms; --mo-sheet: 260ms/);
        expect(fs.readFileSync('tailwind.config.js', 'utf8')).toMatch(/duration-?|transitionDuration: \{ press: 'var\(--mo-press\)'/);
    });
});

describe('reduced motion decision', () => {
    it('the app setting wins over the device', () => {
        expect(resolveReduced('reduced', false)).toBe(true);
        expect(resolveReduced('full', true)).toBe(false);
        expect(resolveReduced('system', true)).toBe(true);
        expect(resolveReduced('system', false)).toBe(false);
    });
    it('puts the decision on <html data-motion>', () => {
        applyMotionMode('reduced');
        expect(document.documentElement.dataset.motion).toBe('reduced');
        applyMotionMode('full');
        expect(document.documentElement.dataset.motion).toBe('full');
    });
    it('the store keeps and applies the setting', () => {
        useAppStore.getState().setMotionMode('reduced');
        expect(useAppStore.getState().motionMode).toBe('reduced');
        expect(document.documentElement.dataset.motion).toBe('reduced');
        useAppStore.getState().setMotionMode('nonsense');
        expect(useAppStore.getState().motionMode).toBe('system');
    });
});

describe('chart animation', () => {
    it('values are final at once; only a changed selection animates, and never when reduced', () => {
        expect(chartAnimation({ reduced: false, selectionChanged: false })).toBe(false);
        expect(chartAnimation({ reduced: true, selectionChanged: true })).toBe(false);
        expect(chartAnimation({ reduced: false, selectionChanged: true })).toMatchObject({ duration: 260 });
    });
});
