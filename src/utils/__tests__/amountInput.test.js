import { describe, expect, it } from 'vitest';
import { displayExpression, evaluate, expressionFromNumber, keyFromEvent, pressKey } from '../amountInput';

const type = (keys) => keys.reduce((e, k) => pressKey(e, k), '');

describe('keypad input', () => {
    it('builds 12,40 with a comma key', () => {
        const e = type(['1', '2', ',', '4', '0']);
        expect(e).toBe('12.40');
        expect(displayExpression(e, ',')).toBe('12,40');
        expect(evaluate(e)).toBe(12.4);
    });
    it('limits decimals to two and ignores a second separator', () => {
        expect(type(['1', ',', '2', '3', '4'])).toBe('1.23');
        expect(type(['1', ',', ',', '5'])).toBe('1.5');
    });
    it('starts with 0, on a bare separator', () => {
        expect(type([','])).toBe('0.');
        expect(type([',', '5'])).toBe('0.5');
    });
    it('replaces a leading zero and ignores repeated zeros', () => {
        expect(type(['0', '0', '7'])).toBe('7');
        expect(type(['0', '00'])).toBe('0');
    });
    it('"00" appends two zeros after digits', () => {
        expect(type(['5', '00'])).toBe('500');
    });
    it('caps the integer part', () => {
        expect(type('1234567890'.split(''))).toBe('123456789');
    });
    it('adds several amounts with +', () => {
        const e = type(['1', '2', ',', '5', '+', '3', ',', '2', '0']);
        expect(e).toBe('12.5+3.20');
        expect(evaluate(e)).toBe(15.7);
        expect(displayExpression(e, ',')).toBe('12,5+3,20');
    });
    it('ignores a leading or doubled +, and drops a dangling separator before +', () => {
        expect(type(['+'])).toBe('');
        expect(type(['4', '+', '+'])).toBe('4+');
        expect(type(['4', ',', '+'])).toBe('4+');
        expect(type(['4', '+', ',', '5'])).toBe('4+0.5');
    });
    it('backspace removes one character; clear empties', () => {
        expect(pressKey('12.4', 'back')).toBe('12.');
        expect(pressKey('', 'back')).toBe('');
        expect(pressKey('12.4', 'clear')).toBe('');
    });
    it('evaluates float sums without drift', () => {
        expect(evaluate('0.1+0.2')).toBe(0.3);
        expect(evaluate('')).toBe(0);
        expect(evaluate('3.')).toBe(3);
    });
    it('maps physical keys', () => {
        expect(keyFromEvent('7')).toBe('7');
        expect(keyFromEvent('.')).toBe(',');
        expect(keyFromEvent('Backspace')).toBe('back');
        expect(keyFromEvent('a')).toBeNull();
    });
    it('prefills from a number', () => {
        expect(expressionFromNumber(23.47)).toBe('23.47');
        expect(expressionFromNumber(0)).toBe('');
    });
});
