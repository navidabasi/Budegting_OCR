import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Toast from '../Toast';
import { useAppStore } from '../../../store/appStore';

afterEach(cleanup);

describe('Toast', () => {
    it('is pinned to the top of the screen, never the thumb zone', () => {
        render(<Toast />);
        act(() => useAppStore.getState().showToast('Saved', 'success', { duration: 60000 }));
        const root = screen.getByRole('status').parentElement;
        expect(root.className).toContain('top-0');
        expect(root.className).not.toContain('bottom-');
        expect(root.style.paddingTop).toContain('safe-area-inset-top');
    });
});
