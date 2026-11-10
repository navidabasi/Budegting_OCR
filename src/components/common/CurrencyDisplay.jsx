import { formatCurrency } from '../../utils/helpers';
import { useSettings } from '../../data/hooks';

/** Amount in its own currency plus the stored base amount (computed at write time) when the currencies differ. */
export default function CurrencyDisplay({ amount, currency: receiptCurrency, amountBase = null, baseCurrency = null }) {
    const { defaultCurrency } = useSettings();

    if (!receiptCurrency || receiptCurrency === defaultCurrency) return <span>{formatCurrency(amount, receiptCurrency || defaultCurrency)}</span>;

    return (
        <div>
            <div>{formatCurrency(amount, receiptCurrency)}</div>
            {amountBase !== null && amountBase !== undefined ? (
                <div className="mt-0.5 text-sm text-ink-muted">≈ {formatCurrency(amountBase, baseCurrency || defaultCurrency)} ({baseCurrency || defaultCurrency})</div>
            ) : null}
        </div>
    );
}
