import { describe, expect, it } from 'vitest';
import { ariaSort, isNavKey, moveSelection, toggleSort } from '../tableNav';

describe('table sorting', () => {
    it('a new column starts descending, the same column flips', () => {
        expect(toggleSort({ sort: 'date', dir: 'desc' }, 'amount')).toEqual({ sort: 'amount', dir: 'desc' });
        expect(toggleSort({ sort: 'amount', dir: 'desc' }, 'amount')).toEqual({ sort: 'amount', dir: 'asc' });
        expect(toggleSort({ sort: 'amount', dir: 'asc' }, 'amount')).toEqual({ sort: 'amount', dir: 'desc' });
    });
    it('merchant and category sort A to Z first; account and group do not sort', () => {
        const cur = { sort: 'date', dir: 'desc' };
        expect(toggleSort(cur, 'merchant')).toEqual({ sort: 'merchant', dir: 'asc' });
        expect(toggleSort({ sort: 'category', dir: 'asc' }, 'category')).toEqual({ sort: 'category', dir: 'desc' });
        expect(toggleSort(cur, 'account')).toBe(cur);
        expect(toggleSort(cur, 'group')).toBe(cur);
    });
    it('reports aria-sort for the active column only', () => {
        expect(ariaSort({ sort: 'amount', dir: 'asc' }, 'amount')).toBe('ascending');
        expect(ariaSort({ sort: 'amount', dir: 'desc' }, 'amount')).toBe('descending');
        expect(ariaSort({ sort: 'amount', dir: 'desc' }, 'date')).toBe('none');
    });
});

describe('keyboard selection', () => {
    it('j / k and arrows move by one and stop at the edges', () => {
        expect(moveSelection('j', 0, 5)).toBe(1);
        expect(moveSelection('ArrowDown', 4, 5)).toBe(4);
        expect(moveSelection('k', 3, 5)).toBe(2);
        expect(moveSelection('ArrowUp', 0, 5)).toBe(0);
    });
    it('enters at the first row going down and the last going up when nothing is selected', () => {
        expect(moveSelection('j', -1, 5)).toBe(0);
        expect(moveSelection('k', -1, 5)).toBe(4);
    });
    it('Home / End jump; other keys and empty lists change nothing', () => {
        expect(moveSelection('Home', 3, 5)).toBe(0);
        expect(moveSelection('End', 1, 5)).toBe(4);
        expect(moveSelection('x', 2, 5)).toBe(2);
        expect(moveSelection('j', -1, 0)).toBe(-1);
    });
    it('knows the keys it owns', () => {
        expect(['j', 'k', 'Enter', 'Escape', 'ArrowDown'].every(isNavKey)).toBe(true);
        expect(isNavKey('a')).toBe(false);
    });
});
