import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { parseCsv, detectDelimiter, toRecords, stripBom } from '../csv'
import { sha1Hex, parseAmount, parseDateString, findColumn, createRefBuilder } from '../utils'

describe('parseCsv', () => {
    it('parses simple comma CSV with CRLF and a trailing newline', () => {
        const { rows, delimiter } = parseCsv('a,b,c\r\n1,2,3\r\n')
        expect(delimiter).toBe(',')
        expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    })
    it('handles quotes, escaped quotes, delimiters and newlines inside quotes', () => {
        const { rows } = parseCsv('name,note\n"Rossi, Mario","said ""ciao""\nsecond line"\nx,y')
        expect(rows).toEqual([['name', 'note'], ['Rossi, Mario', 'said "ciao"\nsecond line'], ['x', 'y']])
    })
    it('auto-detects semicolons (Italian exports) and tabs', () => {
        expect(parseCsv('a;b;c\n1,5;2;3').delimiter).toBe(';')
        expect(parseCsv('a;b;c\n1,5;2;3').rows[1]).toEqual(['1,5', '2', '3'])
        expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t')
    })
    it('ignores delimiters inside quotes when detecting', () => {
        expect(detectDelimiter('"a;b;c;d",e\n"x;y;z",f')).toBe(',')
    })
    it('strips the BOM', () => {
        expect(stripBom('﻿a,b')).toBe('a,b')
        expect(parseCsv('﻿Type,Amount\nX,1').rows[0]).toEqual(['Type', 'Amount'])
    })
    it('keeps empty fields, drops blank lines, accepts bare CR and LF', () => {
        expect(parseCsv('a,b,c\n1,,3\n\n4,5,\n').rows).toEqual([['a', 'b', 'c'], ['1', '', '3'], ['4', '5', '']])
        expect(parseCsv('a,b\r1,2\r3,4').rows).toHaveLength(3)
    })
    it('trims unquoted fields but not quoted ones', () => {
        expect(parseCsv('a,b\n  x , " y "').rows[1]).toEqual(['x', ' y '])
    })
    it('handles empty input and a lone header', () => {
        expect(parseCsv('').rows).toEqual([])
        expect(parseCsv(null).rows).toEqual([])
        expect(parseCsv('a,b').rows).toEqual([['a', 'b']])
    })
    it('last row without newline and an unterminated quote do not throw', () => {
        expect(parseCsv('a,b\n1,2').rows[1]).toEqual(['1', '2'])
        expect(parseCsv('a,b\n"1,2').rows[1]).toEqual(['1,2'])
    })
})

describe('toRecords', () => {
    it('maps rows to objects, numbers lines and de-duplicates headers', () => {
        const { rows } = parseCsv('x,x,y\n1,2,3')
        const { headers, records } = toRecords(rows)
        expect(headers).toEqual(['x', 'x_2', 'y'])
        expect(records[0].record).toEqual({ x: '1', x_2: '2', y: '3' })
        expect(records[0].line).toBe(2)
    })
})

describe('import utils', () => {
    it('sha1Hex matches the reference implementation (and the fallback path)', async () => {
        for (const msg of ['abc', '', 'revolut|2026-11-08|lidl|-23.47', 'x'.repeat(200), 'caffè ☕']) {
            expect(await sha1Hex(msg)).toBe(createHash('sha1').update(msg).digest('hex'))
        }
    })
    it('sha1Hex works without crypto.subtle', async () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
        Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
        try {
            expect(await sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
        } finally {
            if (original) Object.defineProperty(globalThis, 'crypto', original)
        }
    })
    it('parseAmount: Italian, US, signs and symbols', () => {
        expect(parseAmount('1.234,56', ',')).toBe(1234.56)
        expect(parseAmount('-12,50', ',')).toBe(-12.5)
        expect(parseAmount('€ 12,50-', ',')).toBe(-12.5)
        expect(parseAmount('(45.00)', '.')).toBe(-45)
        expect(parseAmount('+7,5', ',')).toBe(7.5)
        expect(parseAmount('1,234.56', '.')).toBe(1234.56)
        expect(parseAmount('1.234,56')).toBe(1234.56)
        expect(parseAmount('1,234.56')).toBe(1234.56)
        expect(parseAmount('1.234')).toBe(1234)
        expect(parseAmount('12.5')).toBe(12.5)
        expect(parseAmount('')).toBeNull()
        expect(parseAmount('n/a')).toBeNull()
        expect(parseAmount(null)).toBeNull()
    })
    it('parseDateString', () => {
        expect(parseDateString('08/11/2026')).toBe('2026-11-08')
        expect(parseDateString('8-1-26')).toBe('2026-01-08')
        expect(parseDateString('31.12.2026 18:42')).toBe('2026-12-31')
        expect(parseDateString('2026-11-08 18:42:11')).toBe('2026-11-08')
        expect(parseDateString('11/08/2026', 'mdy')).toBe('2026-11-08')
        expect(parseDateString('31/02/2026')).toBeNull()
        expect(parseDateString('2026-13-01')).toBeNull()
        expect(parseDateString('')).toBeNull()
        expect(parseDateString('hello')).toBeNull()
    })
    it('findColumn ignores case, accents and punctuation', () => {
        expect(findColumn(['Data Operazione', 'Importo'], ['data operazione'])).toBe(0)
        expect(findColumn(['Descrizione', 'Importo (€)'], ['importo'])).toBe(1)
        expect(findColumn(['a'], ['b'])).toBe(-1)
    })
    it('ref builder: stable per row, distinct for identical rows in one file', async () => {
        const a = createRefBuilder('x')
        const b = createRefBuilder('x')
        const r1 = await a(['1', 'coffee'])
        const r2 = await a(['1', 'coffee'])
        expect(r1).not.toBe(r2)
        expect(await b(['1', 'coffee'])).toBe(r1)
        expect(r1).toMatch(/^x:[0-9a-f]{40}$/)
    })
})
