import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AiBlockedError, cleanBase64, getLastOutbound, post, pseudo, resetPseudonyms, restoreAliases, sanitizeBody, scrubText, setOutboundContext, stripImageMetadata } from '../aiOutbound';
import { postAi } from '../aiClient';
import { categorizeMerchants } from '../aiCategorize';
import { extractReceipt } from '../receiptScan';
import { setScanPrefs } from '../../utils/scanPrefs';

const people = [{ id: 'p-marta', name: 'Marta Bianchi' }];
const accounts = [{ id: 'acc-1', name: 'Revolut Marco' }, { id: 'acc-2', name: 'Prestito Luca', counterparty: 'Luca Verdi' }];
const trips = [{ id: 'trip-1', name: 'Lisbon', companions: ['Giulia'] }];

beforeEach(() => {
    localStorage.clear();
    resetPseudonyms();
    setOutboundContext({ people, accounts, trips });
});

describe('scrubText (brief section 12 case 11: identifiers removed)', () => {
    it.each([
        ['mail', 'Coop mario.rossi@example.com 2 spesa', /@/],
        ['iban', 'Bonifico IT60 X054 2811 1010 0000 0123 456 affitto', /IT60|0123/],
        ['card number', 'Pagamento carta 4111 1111 1111 1111 Lidl', /4111/],
        ['masked card', 'Lidl carta ****1234', /1234/],
        ['phone', 'Ricarica +39 347 123 4567', /347|4567/],
        ['phone nospace', 'Ricarica 3471234567', /3471234567/],
        ['address', 'Consegna Via Giuseppe Verdi 12 Torino', /Verdi|12/],
        ['address english', 'Parcel 221 Baker Street', /Baker/],
        ['postcode', 'Negozio, 10121 Torino', /10121/],
        ['loyalty', 'Conad tessera ABC12345', /ABC12345/],
        ['loyalty id', 'Esselunga fidelity card 0412987', /0412987/],
        ['store number', 'Lidl #1234', /1234/],
        ['person from list', 'Cena con Marta Bianchi', /Marta/],
        ['counterparty', 'Rimborso Luca Verdi', /Luca|Verdi/],
        ['companion', 'Regalo Giulia', /Giulia/],
        ['p2p pattern', 'Settlement to Anna Neri', /Anna|Neri/],
        ['bonifico pattern', 'Bonifico a Paolo Gialli', /Paolo|Gialli/],
        ['terminal id', 'POS 49283746501 Bar Roma', /49283746501/],
    ])('%s', (_name, input, forbidden) => {
        const out = scrubText(input);
        expect(out).not.toMatch(forbidden);
    });

    it('keeps the merchant words', () => {
        expect(scrubText('Esselunga Milano #123')).toBe('Esselunga Milano');
        expect(scrubText('Latte intero 1L')).toBe('Latte intero 1L');
        expect(scrubText('Café Bar Roma')).toBe('Café Bar Roma');
    });
    it('replaces known names with stable aliases', () => {
        const a = scrubText('Cena con Marta Bianchi');
        expect(a).toMatch(/Person \d/);
        expect(scrubText('Marta Bianchi')).toBe(pseudo('person', 'p-marta'));
    });
});

describe('sanitizeBody', () => {
    const payload = {
        aggregates: {
            month: '2026-11',
            generatedAt: '2026-11-10T14:33:21.123Z',
            topMerchants: [{ key: 'lidl', name: 'Lidl #4411', total: 20 }],
            findings: [{ title: 'Spent at Cena Marta Bianchi', body: 'Mail marta@x.it IBAN IT60X0542811101000000123456' }],
        },
        transactions: [{ id: 't1', merchant: 'Bar 0123456789', notes: 'private note about Marta', accountId: 'acc-1', toAccountId: 'acc-2', date: '2026-11-03', time: '14:20', userId: 'u-1', payer: 'p-marta' }],
        hints: { accounts: ['Revolut Marco', 'Unknown card'], knownMerchants: ['Lidl'], companions: ['Giulia'] },
    };
    let out;
    let text;
    beforeEach(() => {
        out = sanitizeBody('chat', payload);
        text = JSON.stringify(out);
    });

    it('drops notes, user ids, times and raw ids', () => {
        expect(text).not.toMatch(/private note|u-1|14:20|acc-1|acc-2|p-marta/);
        expect(out.transactions[0].notes).toBeUndefined();
    });
    it('pseudonymises accounts and people consistently', () => {
        expect(out.transactions[0].accountId).toBe(pseudo('account', 'acc-1'));
        expect(out.transactions[0].accountId).toMatch(/^Account [A-Z]$/);
        expect(out.transactions[0].payer).toBe(pseudo('person', 'p-marta'));
        expect(out.hints.accounts[0]).toBe(pseudo('account', 'acc-1'));
        expect(text).not.toMatch(/Revolut Marco/);
    });
    it('rounds timestamps to dates and strips identifiers in strings', () => {
        expect(out.aggregates.generatedAt).toBe('2026-11-10');
        expect(text).not.toMatch(/marta@x|IT60|Marta|Bianchi|4411|0123456789|Giulia/);
    });
    it('restores aliases locally in an answer', () => {
        const alias = pseudo('person', 'p-marta');
        expect(restoreAliases(`${alias} owes you 10`)).toBe('Marta Bianchi owes you 10');
    });
});

describe('every AI request goes through post()', () => {
    const okJson = (json) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json });

    it('chat: the body that is sent and the recorded payload have no identifiers', async () => {
        const fetchImpl = okJson({ answer: 'x' });
        await postAi('/api/chat', { aggregates: { month: '2026-11', topMerchants: [{ key: 'k', name: 'Cena Marta Bianchi' }] }, messages: [{ role: 'user', content: 'What did I spend with Marta Bianchi? mail a@b.com' }], language: 'en' }, { getToken: async () => 'tok', fetchImpl });
        const sent = fetchImpl.mock.calls[0][1].body;
        expect(sent).not.toMatch(/Marta|Bianchi|a@b\.com/);
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
        const rec = getLastOutbound().chat;
        expect(rec.text).not.toMatch(/Marta|a@b\.com|tok/);
        expect(rec.endpoint).toBe('/api/chat');
    });

    it('categorize: raw descriptions are scrubbed', async () => {
        const fetchImpl = okJson({ results: [{ key: 'bar', category: 'Dining', confidence: 0.9 }] });
        await categorizeMerchants({ merchants: [{ key: 'bar', name: 'Bar Roma', description: 'POS 1234567890123 Bar Roma carta 4111 1111 1111 1111', sampleItems: [] }], categories: ['Dining', 'Other'], getToken: async () => 't', fetchImpl });
        const sent = fetchImpl.mock.calls[0][1].body;
        expect(sent).not.toMatch(/4111|1234567890123/);
        expect(sent).toMatch(/Bar Roma/);
    });

    it('extract: refuses to send when photos are switched off', async () => {
        setScanPrefs({ sendPhotos: false });
        const fetchImpl = vi.fn();
        await expect(extractReceipt({ file: new Blob(['x'], { type: 'image/jpeg' }), hints: {}, getToken: async () => 't', fetchImpl })).rejects.toMatchObject({ kind: 'photosOff' });
        await expect(post('/api/extract-receipt', { file: 'AAAA', hints: {} }, { token: 't', fetchImpl })).rejects.toBeInstanceOf(AiBlockedError);
        expect(fetchImpl).not.toHaveBeenCalled();
        setScanPrefs({ sendPhotos: true });
    });

    it('extract: metadata is removed from the photo and its bytes are not recorded', async () => {
        const jpeg = jpegWithExif();
        const b64 = btoa(String.fromCharCode(...jpeg));
        const fetchImpl = okJson({ receipt: {} });
        await post('/api/extract-receipt', { file: b64, mime: 'image/jpeg', hints: { accounts: ['Revolut Marco'], knownMerchants: ['Lidl'] } }, { token: 't', fetchImpl });
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        const bytes = Uint8Array.from(atob(body.file), (c) => c.charCodeAt(0));
        expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/Exif|GPSLatitude|iPhone/);
        expect(bytes[0]).toBe(0xff);
        expect(getLastOutbound().extract.text).not.toContain(body.file);
        expect(getLastOutbound().extract.text).toMatch(/metadata removed/);
        expect(body.hints.accounts[0]).toMatch(/^Account/);
    });

    it('no other module calls the AI endpoints directly', () => {
        const root = path.resolve(__dirname, '../..');
        const offenders = [];
        const walk = (dir) => {
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, f.name);
                if (f.isDirectory()) {
                    if (f.name !== '__tests__') walk(p);
                } else if (/\.(js|jsx)$/.test(f.name) && !p.endsWith('aiOutbound.js')) {
                    const src = fs.readFileSync(p, 'utf8');
                    if (/fetch(Impl)?\(\s*(CHAT_ENDPOINT|INSIGHTS_ENDPOINT|CATEGORIZE_ENDPOINT|EXTRACT_ENDPOINT|['"`]\/api\/(chat|insights|categorize|extract-receipt))/.test(src)) offenders.push(p);
                }
            }
        };
        walk(root);
        expect(offenders).toEqual([]);
    });
});

function jpegWithExif() {
    const exif = Buffer.from('Exif\0\0iPhone GPSLatitude 45.07 N');
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
    const dqt = Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x01, 0x02]);
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
    return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), app1, dqt, sos]));
}

describe('stripImageMetadata', () => {
    it('removes the EXIF segment from a JPEG and keeps the image segments', () => {
        const out = stripImageMetadata(jpegWithExif());
        expect(Buffer.from(out).toString('latin1')).not.toMatch(/Exif|GPS/);
        expect([...out.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xdb]);
        expect(out[out.length - 1]).toBe(0xd9);
    });
    it('removes text and EXIF chunks from a PNG', () => {
        const chunk = (type, data) => {
            const len = Buffer.alloc(4);
            len.writeUInt32BE(data.length);
            return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
        };
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('Location\0Torino')), chunk('IDAT', Buffer.from('data')), chunk('IEND', Buffer.alloc(0))]);
        const out = Buffer.from(stripImageMetadata(new Uint8Array(png))).toString('latin1');
        expect(out).not.toMatch(/Torino|tEXt/);
        expect(out).toMatch(/IDAT/);
    });
    it('cleanBase64 round-trips', () => {
        expect(cleanBase64(btoa(String.fromCharCode(...jpegWithExif())))).toBeTruthy();
    });
});
