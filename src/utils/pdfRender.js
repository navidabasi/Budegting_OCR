/**
 * Render page 1 of a PDF to a JPEG blob in the browser (pdfjs-dist), so the server only ever sees an image.
 * pdfjs is loaded lazily; the worker is bundled by Vite through a `?url` import.
 */
export const isPdf = (file) => file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');

const TARGET_WIDTH = 1600; // px; sharp enough for text, small enough for the upload limit

export async function renderPdfFirstPage(file, { targetWidth = TARGET_WIDTH, quality = 0.88 } = {}) {
    const [pdfjs, workerUrl] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default)]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    try {
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, Math.max(1, targetWidth / base.width));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // PDFs are transparent: JPEG needs a white page
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render PDF'))), 'image/jpeg', quality));
        const name = (file.name || 'receipt').replace(/\.pdf$/i, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    } finally {
        pdf.destroy?.();
    }
}
