import { formatCurrency } from '../../utils/helpers';
import { useSettings } from '../../data/hooks';
import { shareAmount } from '../../utils/money';

/**
 * Total of receipts that may be in different currencies. Uses the base amounts stored at write time
 * (`amountBase`), so nothing is converted at render time and nothing flickers.
 * `amount` is the caller's own sum in the receipts' entered currency.
 */
export default function CurrencyTotalDisplay({ receipts, amount }) {
    const { defaultCurrency } = useSettings();

    if (!receipts || receipts.length === 0) return <span>{formatCurrency(amount || 0, defaultCurrency)}</span>;

    const currencies = new Set(receipts.map((r) => r.currency || defaultCurrency));
    const single = currencies.size === 1 ? [...currencies][0] : null;
    const allConverted = receipts.every((r) => (r.currency || defaultCurrency) === defaultCurrency || (r.amountBase !== null && r.amountBase !== undefined));
    const baseTotal = receipts.reduce((sum, r) => sum + shareAmount(r), 0);

    if (single === defaultCurrency) return <span>{formatCurrency(amount || 0, defaultCurrency)}</span>;

    if (single && allConverted) {
        return (
            <div>
                <div>{formatCurrency(amount || 0, single)}</div>
                <div className="mt-0.5 text-xs text-ink-muted">≈ {formatCurrency(baseTotal, defaultCurrency)}</div>
            </div>
        );
    }
    if (!single && allConverted) {
        return (
            <div>
                <div>{formatCurrency(baseTotal, defaultCurrency)}</div>
                <div className="mt-0.5 text-xs text-ink-muted">≈ {defaultCurrency}</div>
            </div>
        );
    }
    return <span>{formatCurrency(amount || 0, single || defaultCurrency)}</span>;
}
