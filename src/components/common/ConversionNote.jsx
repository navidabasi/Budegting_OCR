import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';
import { pendingConversionCount } from '../../utils/conversion';
import { useMoney } from '../../hooks/useMoney';

/**
 * "+ N transactions not yet converted": foreign-currency records without a base amount are left out of totals (never counted 1:1),
 * so every screen that shows a total says how many are missing. Renders nothing when none are.
 */
export default function ConversionNote({ transactions, period, className = '', hint = false }) {
    const { t } = useTranslation();
    const { currency } = useMoney();
    const { count } = useMemo(() => pendingConversionCount(transactions, period, currency), [transactions, period, currency]);
    if (count === 0) return null;
    return (
        <p className={`flex items-start gap-1.5 text-xs font-medium text-warn-ink ${className}`} data-testid="conversion-note">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
                {count === 1 ? t('fx.notConverted1') : t('fx.notConverted', { count })}
                {hint ? <span className="block font-normal text-ink-muted">{t('fx.notConvertedHint')}</span> : null}
            </span>
        </p>
    );
}
