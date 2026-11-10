import { useTranslation } from '../../languages/useTranslation';
import { currencySymbol, formatAmount, localeFor } from '../../utils/format';

/**
 * Monospace, tabular amount. `1.240,30` formatting follows the app language.
 * tone: default | income | savings | warn | over | muted. `sign` prefixes + or the true minus sign.
 */
const TONES = {
    default: '',
    income: 'text-income',
    savings: 'text-savings',
    warn: 'text-warn-ink',
    over: 'text-over-ink',
    muted: 'text-ink-faint',
};

export default function Amount({ value, currency, symbol = false, sign = false, tone = 'default', className = '', symbolClassName = '' }) {
    const { languageCode } = useTranslation();
    const locale = localeFor(languageCode, currency || 'EUR');
    const n = Number(value) || 0;
    const prefix = sign ? (n > 0 ? '+' : n < 0 ? '−' : '') : n < 0 ? '−' : '';
    return (
        <span className={`mono-num ${TONES[tone] || ''} ${className}`} dir="ltr" style={{ unicodeBidi: 'isolate' }}>
            {prefix}
            {formatAmount(Math.abs(n), { locale })}
            {symbol && currency ? <span className={`ms-1 text-ink-muted ${symbolClassName}`}>{currencySymbol(currency, locale)}</span> : null}
        </span>
    );
}
