// usage: node scripts/screenshots/import.mjs  (CSV import preview, light + dark)
import { launch, openApp, out, day } from './lib.mjs';
const stamp = (o) => `${day(o)} 12:00:00`;
const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,${stamp(0)},${stamp(0)},LIDL 0231 TORINO,-23.47,0.00,EUR,COMPLETED,100.00
CARD_PAYMENT,Current,${stamp(1)},${stamp(1)},Pastéis de Belém,-11.20,0.00,EUR,COMPLETED,120.00
CARD_PAYMENT,Current,${stamp(4)},${stamp(4)},NETFLIX.COM,-12.99,0.00,EUR,COMPLETED,130.00
CARD_PAYMENT,Current,${stamp(5)},${stamp(5)},TABACCHI VIA PO,-4.50,0.00,EUR,COMPLETED,140.00
TOPUP,Current,${stamp(6)},${stamp(6)},Top-up from card,200.00,0.00,EUR,COMPLETED,340.00
`;
const browser = await launch();
for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openApp(browser, { scheme, path: '/plan?tab=savings' });
    await page.getByRole('button', { name: /Import CSV into Revolut/ }).click();
    await page.getByRole('button', { name: /^Revolut/ }).click();
    await page.getByTestId('csv-input').setInputFiles({ name: 'revolut.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForSelector('[data-testid="import-preview"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: out(`import-preview-${scheme}`) });
    await ctx.close();
}
await browser.close();
