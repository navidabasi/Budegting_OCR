import { useMemo } from 'react';
import { useSettings } from '../data/hooks';
import { useTranslation } from '../languages/useTranslation';
import { formatAmount, formatMoney, formatMoneyShort, localeFor } from '../utils/format';

/** Money formatting in the app language and the user's base currency: { currency, money(v), short(v), num(v) }. */
export function useMoney() {
    const { languageCode } = useTranslation();
    const { defaultCurrency } = useSettings();
    return useMemo(
        () => ({
            currency: defaultCurrency,
            money: (v, cur = defaultCurrency) => formatMoney(v, cur, localeFor(languageCode, cur)),
            short: (v, cur = defaultCurrency) => formatMoneyShort(v, cur, localeFor(languageCode, cur)),
            /** "212" or "212,40": the number only, no symbol (compact lines like "212 / 180"). */
            num: (v, cur = defaultCurrency) => formatAmount(v, { locale: localeFor(languageCode, cur), digits: Math.abs(Number(v) - Math.round(Number(v))) < 0.005 ? 0 : 2 }),
        }),
        [languageCode, defaultCurrency]
    );
}

/** "Nov 2026" in the app language (Gregorian calendar and Latin digits for every language). */
export function monthLabel(month, languageCode, { long = false } = {}) {
    const [y, m] = String(month).split('-').map(Number);
    if (!y || !m) return String(month);
    try {
        const text = new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { month: long ? 'long' : 'short', year: 'numeric' }).format(new Date(y, m - 1, 1));
        return text.charAt(0).toUpperCase() + text.slice(1);
    } catch {
        return month;
    }
}
