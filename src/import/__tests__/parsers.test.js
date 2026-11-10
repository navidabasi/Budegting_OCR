import { describe, it, expect } from 'vitest'
import { parseRevolut, isRevolutHeader } from '../parsers/revolut'
import { parsePostepay, isPostepayLike, findHeaderRow } from '../parsers/postepay'
import { parseGeneric, guessMapping } from '../parsers/generic'
import { parseCsv } from '../csv'

const REVOLUT = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-08 18:42:11,2026-11-09 07:10:02,LIDL 0231 TORINO,-23.47,0.00,EUR,COMPLETED,1476.53
CARD_PAYMENT,Current,2026-11-08 09:00:00,2026-11-08 09:00:01,"Bar ""Centrale"", Torino",-1.50,0.00,EUR,COMPLETED,1478.03
CARD_PAYMENT,Current,2026-11-07 12:00:00,,Amazon.it,-30.00,0.00,EUR,REVERTED,1500.00
CARD_PAYMENT,Current,2026-11-07 13:00:00,,Zara,-49.90,0.00,EUR,DECLINED,
CARD_PAYMENT,Current,2026-11-07 14:00:00,,Zalando,-12.00,0.00,EUR,FAILED,
CARD_PAYMENT,Current,2026-11-07 15:00:00,,Apple,-0.99,0.00,EUR,PENDING,
TOPUP,Current,2026-11-01 10:00:00,2026-11-01 10:00:05,Top-Up by *1234,500.00,0.00,EUR,COMPLETED,2000.00
TRANSFER,Current,2026-11-02 10:00:00,2026-11-02 10:00:05,To pocket EUR Savings,-200.00,0.00,EUR,COMPLETED,1800.00
TRANSFER,Current,2026-11-03 10:00:00,2026-11-03 10:00:05,Payment from Mario Rossi,45.00,0.00,EUR,COMPLETED,1845.00
TRANSFER,Current,2026-11-03 11:00:00,2026-11-03 11:00:05,To Giulia Bianchi,-20.00,0.00,EUR,COMPLETED,1825.00
EXCHANGE,Current,2026-11-04 10:00:00,2026-11-04 10:00:05,Exchanged to USD,-100.00,0.00,EUR,COMPLETED,1725.00
EXCHANGE,Current,2026-11-04 10:00:00,2026-11-04 10:00:05,Exchanged from EUR,108.00,0.00,USD,COMPLETED,108.00
ATM,Current,2026-11-05 10:00:00,2026-11-05 10:00:05,ATM Torino,-50.00,1.50,EUR,COMPLETED,1673.50
FEE,Current,2026-11-06 10:00:00,2026-11-06 10:00:05,Monthly plan fee,-3.99,0.00,EUR,COMPLETED,1669.51
CARD_REFUND,Current,2026-11-06 12:00:00,2026-11-06 12:00:05,Refund Zalando,19.99,0.00,EUR,COMPLETED,1689.50
CARD_PAYMENT,Current,2026-11-06 13:00:00,2026-11-06 13:00:05,Free coffee,0.00,0.00,EUR,COMPLETED,1689.50
CARD_PAYMENT,Current,2026-11-06 13:00:00,2026-11-06 13:00:05,Coffee,-1.20,0.00,EUR,COMPLETED,1688.30
CARD_PAYMENT,Current,2026-11-06 13:00:00,2026-11-06 13:00:05,Coffee,-1.20,0.00,EUR,COMPLETED,1688.30
`

describe('parseRevolut', () => {
    it('recognises the header and rejects other files', async () => {
        expect(isRevolutHeader(parseCsv(REVOLUT).rows[0])).toBe(true)
        await expect(parseRevolut('Data,Importo\n01/01/2026,1,00')).rejects.toThrow(/Not a Revolut/)
        expect((await parseRevolut('')).rows).toEqual([])
    })

    it('maps card payments to expenses with positive amounts and direction', async () => {
        const { rows } = await parseRevolut(REVOLUT)
        const lidl = rows.find((r) => r.description === 'LIDL 0231 TORINO')
        expect(lidl).toMatchObject({ date: '2026-11-08', amount: 23.47, signedAmount: -23.47, direction: 'out', currency: 'EUR', transactionType: 'expense' })
        expect(lidl.importRef).toMatch(/^revolut:[0-9a-f]{40}$/)
        expect(lidl.raw.Type).toBe('CARD_PAYMENT')
    })

    it('handles quoted descriptions with commas and quotes', async () => {
        const { rows } = await parseRevolut(REVOLUT)
        expect(rows.find((r) => r.amount === 1.5).description).toBe('Bar "Centrale", Torino')
    })

    it('skips REVERTED, DECLINED, FAILED, PENDING and zero rows, reporting why', async () => {
        const { rows, skipped } = await parseRevolut(REVOLUT)
        expect(skipped.map((s) => s.reason).sort()).toEqual(['declined', 'failed', 'pending', 'reverted', 'zero'])
        for (const name of ['Amazon.it', 'Zara', 'Zalando', 'Apple', 'Free coffee']) {
            expect(rows.some((r) => r.description === name)).toBe(false)
        }
    })

    it('classifies transfers between own pockets, top-ups and exchanges; people payments stay expense/income', async () => {
        const { rows } = await parseRevolut(REVOLUT)
        const by = (d) => rows.find((r) => r.description === d)
        expect(by('To pocket EUR Savings')).toMatchObject({ transactionType: 'transfer', direction: 'out', amount: 200 })
        expect(by('Top-Up by *1234')).toMatchObject({ transactionType: 'transfer', direction: 'in', amount: 500 })
        expect(by('Exchanged to USD').transactionType).toBe('transfer')
        expect(by('Exchanged from EUR')).toMatchObject({ transactionType: 'transfer', direction: 'in', currency: 'USD' })
        expect(by('Payment from Mario Rossi').transactionType).toBe('income')
        expect(by('To Giulia Bianchi').transactionType).toBe('expense')
        expect(by('Refund Zalando')).toMatchObject({ transactionType: 'income', amount: 19.99 })
    })

    it('folds the fee into the amount', async () => {
        const { rows } = await parseRevolut(REVOLUT)
        expect(rows.find((r) => r.description === 'ATM Torino')).toMatchObject({ amount: 51.5, signedAmount: -51.5, transactionType: 'expense' })
    })

    it('importRef is stable across runs and distinct for identical rows', async () => {
        const a = await parseRevolut(REVOLUT)
        const b = await parseRevolut(REVOLUT)
        expect(a.rows.map((r) => r.importRef)).toEqual(b.rows.map((r) => r.importRef))
        expect(new Set(a.rows.map((r) => r.importRef)).size).toBe(a.rows.length)
        const coffees = a.rows.filter((r) => r.description === 'Coffee')
        expect(coffees).toHaveLength(2)
        expect(coffees[0].importRef).not.toBe(coffees[1].importRef)
    })

    it('importRef changes when the row content changes, and tolerates BOM and CRLF', async () => {
        const a = await parseRevolut(REVOLUT)
        const b = await parseRevolut('﻿' + REVOLUT.replace('-23.47', '-23.48').replace(/\n/g, '\r\n'))
        const refA = a.rows.find((r) => r.description === 'LIDL 0231 TORINO').importRef
        const refB = b.rows.find((r) => r.description === 'LIDL 0231 TORINO').importRef
        expect(refA).not.toBe(refB)
        expect(a.rows.find((r) => r.description === 'Refund Zalando').importRef).toBe(b.rows.find((r) => r.description === 'Refund Zalando').importRef)
    })
})

const POSTEPAY = `Estratto conto PostePay Evolution;;;;
Intestatario;MARIO ROSSI;;;
Periodo;01/11/2026 - 30/11/2026;;;

Data contabile;Data valuta;Descrizione operazione;Addebiti;Accrediti;Divisa
10/11/2026;09/11/2026;PAGAMENTO POS ESSELUNGA SPA;"1.234,56";;EUR
11/11/2026;11/11/2026;Ricarica PostePay da carta;;500,00;EUR
12/11/2026;12/11/2026;GIROCONTO A LIBRETTO SMART;200,00;;EUR
13/11/2026;13/11/2026;Commissione mensile;1,00;;EUR
14/11/2026;14/11/2026;Riga a zero;0,00;;EUR
Saldo finale;;;;1.000,00;
`

const POSTEPAY_SIGNED = `Data operazione;Data valuta;Causale;Importo
05/11/2026;05/11/2026;Card payment to Q8 TORINO NORD;-45,30
06/11/2026;06/11/2026;Stipendio;1.850,00
`

describe('parsePostepay', () => {
    it('finds the header after the account summary lines', async () => {
        const grid = parseCsv(POSTEPAY).rows
        expect(findHeaderRow(grid)).toBe(3)
        expect(isPostepayLike(POSTEPAY)).toBe(true)
        expect(isPostepayLike('a,b\n1,2')).toBe(false)
    })

    it('parses Italian numbers, dd/mm/yyyy dates and debit/credit columns', async () => {
        const { rows, skipped, provider } = await parsePostepay(POSTEPAY)
        expect(provider).toBe('postepay')
        expect(rows).toHaveLength(4)
        expect(rows[0]).toMatchObject({ date: '2026-11-10', description: 'PAGAMENTO POS ESSELUNGA SPA', amount: 1234.56, signedAmount: -1234.56, direction: 'out', currency: 'EUR', transactionType: 'expense' })
        expect(rows[1]).toMatchObject({ date: '2026-11-11', amount: 500, direction: 'in', transactionType: 'income' })
        expect(rows[0].importRef).toMatch(/^postepay:[0-9a-f]{40}$/)
        expect(rows[0].raw['Data valuta']).toBe('09/11/2026')
        expect(skipped.map((s) => s.reason).sort()).toEqual(['no_date', 'zero'])
    })

    it('treats giroconto as a transfer', async () => {
        const { rows } = await parsePostepay(POSTEPAY)
        expect(rows[2]).toMatchObject({ transactionType: 'transfer', direction: 'out', amount: 200 })
    })

    it('supports a single signed Importo column and Causale as description', async () => {
        const { rows } = await parsePostepay(POSTEPAY_SIGNED)
        expect(rows).toEqual([
            expect.objectContaining({ date: '2026-11-05', description: 'Card payment to Q8 TORINO NORD', amount: 45.3, transactionType: 'expense' }),
            expect.objectContaining({ date: '2026-11-06', description: 'Stipendio', amount: 1850, transactionType: 'income' }),
        ])
    })

    it('prefers Data operazione over Data contabile', async () => {
        const csv = 'Data contabile;Data operazione;Descrizione;Importo\n10/11/2026;08/11/2026;Lidl;-5,00\n'
        expect((await parsePostepay(csv)).rows[0].date).toBe('2026-11-08')
    })

    it('throws a clear error when no header is found', async () => {
        await expect(parsePostepay('foo;bar\n1;2')).rejects.toThrow(/header row/)
    })

    it('re-parsing gives identical import refs', async () => {
        const a = await parsePostepay(POSTEPAY)
        const b = await parsePostepay(POSTEPAY)
        expect(a.rows.map((r) => r.importRef)).toEqual(b.rows.map((r) => r.importRef))
    })
})

describe('parseGeneric', () => {
    const CSV = `Booking date,Text,Out,In,Ccy,Kind
31.12.2026,"Coffee, Torino","3,50",,EUR,Card
01.01.2027,Salary,,"2.000,00",EUR,Card
02.01.2027,To savings,"100,00",,EUR,Transfer
bad date,x,1,,EUR,
`
    const mapping = { date: 'Booking date', description: 'Text', debit: 'Out', credit: 'In', currency: 'Ccy', type: 'Kind', dateFormat: 'dmy', decimal: ',' }

    it('applies the user mapping (debit/credit, decimal comma, dmy dates)', async () => {
        const { rows, skipped, provider } = await parseGeneric(CSV, mapping)
        expect(provider).toBe('csv')
        expect(rows).toHaveLength(3)
        expect(rows[0]).toMatchObject({ date: '2026-12-31', description: 'Coffee, Torino', amount: 3.5, direction: 'out', transactionType: 'expense' })
        expect(rows[1]).toMatchObject({ date: '2027-01-01', amount: 2000, direction: 'in', transactionType: 'income' })
        expect(rows[2].transactionType).toBe('transfer')
        expect(skipped).toEqual([{ line: 5, reason: 'no_date' }])
        expect(rows[0].importRef).toMatch(/^csv:[0-9a-f]{40}$/)
    })

    it('supports a signed amount, invertSign, column indexes and a custom provider label', async () => {
        const csv = 'd,t,a\n2026-11-08,Shop,12.50\n2026-11-09,Refund,-3.00\n'
        const out = await parseGeneric(csv, { date: 0, description: 1, amount: 2, invertSign: true, decimal: '.' }, { provider: 'n26' })
        expect(out.provider).toBe('n26')
        expect(out.rows[0]).toMatchObject({ amount: 12.5, direction: 'out', transactionType: 'expense' })
        expect(out.rows[1]).toMatchObject({ amount: 3, direction: 'in', transactionType: 'income' })
        expect(out.rows[0].importRef.startsWith('n26:')).toBe(true)
    })

    it('works without a header row', async () => {
        const out = await parseGeneric('2026-11-08;Shop;-5,00\n', { hasHeader: false, date: 0, description: 1, amount: 2 })
        expect(out.rows).toHaveLength(1)
        expect(out.rows[0]).toMatchObject({ amount: 5, date: '2026-11-08' })
    })

    it('reports mapping errors', async () => {
        await expect(parseGeneric(CSV, { description: 'Text', amount: 'Out' })).rejects.toThrow(/date column/)
        await expect(parseGeneric(CSV, { date: 'Booking date' })).rejects.toThrow(/amount/)
        await expect(parseGeneric(CSV, { date: 'Nope', amount: 'Out' })).rejects.toThrow(/date column/)
    })

    it('guessMapping suggests columns', () => {
        expect(guessMapping(['Data operazione', 'Descrizione', 'Importo', 'Divisa'])).toMatchObject({ date: 'Data operazione', description: 'Descrizione', amount: 'Importo', currency: 'Divisa' })
        expect(guessMapping(['x']).date).toBeNull()
    })
})
