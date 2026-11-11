import { Sheet } from '../ui';
import { useReceiptNavigation } from '../../hooks/useNavigation';
import { useMoney } from '../../hooks/useMoney';
import { useTranslation } from '../../languages/useTranslation';

/**
 * Every number leads somewhere: the receipts and lines behind it. `refs` = [{ txId, itemId, name, merchant, date, amount, unallocated }];
 * a row opens the receipt (the item review list is on it). Lines without an item name are receipt totals or the unitemised remainder.
 */
export default function DrillSheet({ open, onClose, title, subtitle, total, refs = [] }) {
    const { t } = useTranslation();
    const { money } = useMoney();
    const { toReceiptDetail } = useReceiptNavigation();
    return (
        <Sheet open={open} onClose={onClose} label={title || ''}>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 pb-2" data-testid="drill-sheet">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="min-w-0 break-words font-display text-lg font-bold text-ink">{title}</h2>
                    {total !== undefined ? <span className="shrink-0 font-mono text-base font-semibold text-ink">{money(total)}</span> : null}
                </div>
                {subtitle ? <p className="text-sm text-ink-muted">{subtitle}</p> : null}
                <ul className="flex flex-col">
                    {refs.map((r, i) => (
                        <li key={`${r.txId}-${r.itemId || 'r'}-${i}`} className="border-b border-line last:border-b-0">
                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    toReceiptDetail(r.txId);
                                }}
                                className="flex min-h-[56px] w-full items-center gap-3 py-2 text-start"
                                data-testid="drill-row"
                            >
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className={`truncate text-[15px] ${r.unallocated ? 'text-warn-ink' : 'text-ink'}`}>{r.unallocated ? t('breakdown.unitemised') : r.name || r.merchant}</span>
                                    <span className="truncate text-xs text-ink-muted">{[r.name ? r.merchant : null, r.date].filter(Boolean).join(' · ')}</span>
                                </span>
                                <span className="shrink-0 font-mono text-[15px] text-ink" dir="ltr">
                                    {money(r.amount)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </Sheet>
    );
}
