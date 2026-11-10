import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { handleShareRequest, saveSharedFiles, takeSharedFiles } from '../sharedFiles';

const fakeFile = (name, type, bytes = [1, 2, 3]) => ({ name, type, arrayBuffer: async () => new Uint8Array(bytes).buffer });

describe('share target storage', () => {
    it('round-trips files and clears them once taken', async () => {
        expect(await saveSharedFiles([fakeFile('a.pdf', 'application/pdf'), fakeFile('b.jpg', 'image/jpeg')])).toBe(2);
        const files = await takeSharedFiles();
        expect(files.map((f) => f.name)).toEqual(['a.pdf', 'b.jpg']);
        expect(files[0].type).toBe('application/pdf');
        expect(files[0].size).toBe(3);
        expect(await takeSharedFiles()).toEqual([]);
    });

    it('drops unsupported types', async () => {
        await saveSharedFiles([fakeFile('notes.txt', 'text/plain'), fakeFile('scan.png', 'image/png')]);
        expect((await takeSharedFiles()).map((f) => f.name)).toEqual(['scan.png']);
    });

    it('POST /share stores the files and redirects 303 to /scan?shared=1', async () => {
        const request = { url: 'https://app.example/share', formData: async () => ({ getAll: (k) => (k === 'files' ? [fakeFile('r.pdf', 'application/pdf'), 'not-a-file'] : []) }) };
        const res = await handleShareRequest(request);
        expect(res.status).toBe(303);
        expect(res.headers.get('Location')).toBe('https://app.example/scan?shared=1');
        expect((await takeSharedFiles()).map((f) => f.name)).toEqual(['r.pdf']);
    });

    it('still redirects when the body cannot be read', async () => {
        const res = await handleShareRequest({ url: 'https://app.example/share', formData: async () => { throw new Error('bad body'); } });
        expect(res.status).toBe(303);
    });
});
