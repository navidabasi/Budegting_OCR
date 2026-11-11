import { Calendar } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-08" -> "8 Nov 2026" in the UI language. Parsed as a local date, so no timezone day shift. */
export function formatDateLabel(value, locale, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
    const m = RE.exec(String(value || ''));
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString(locale || 'en', options);
}

const LOOKS = {
    field: 'h-12 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink',
    bare: 'min-h-[24px] text-base font-medium text-ink',
    legacy: 'h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
};

/**
 * Date input that looks identical on every device. iOS renders native date inputs with its own sizing and alignment
 * (and nothing at all for an empty value), so the visible text is drawn here and a transparent native input is laid
 * exactly over it: a tap lands on the native control and opens the system date picker on iPhone and Android.
 *   value: 'YYYY-MM-DD' or ''      onChange(nextValue)      min / max: 'YYYY-MM-DD'
 */
export default function DateField({ value, onChange, min, max, id, label, placeholder, variant = 'field', className = '', allowEmpty = true, invalid = false }) {
    const { t, languageCode } = useTranslation();
    const text = formatDateLabel(value, languageCode);
    return (
        <div
            className={`relative flex w-full min-w-0 items-center justify-between gap-2 focus-within:ring-2 focus-within:ring-forest-ink ${LOOKS[variant] || ''} ${invalid ? 'border-over' : ''} ${className}`}
        >
            <span className={`min-w-0 truncate ${text ? '' : 'text-ink-faint'}`} aria-hidden="true">
                {text || placeholder || t('common.pickDate')}
            </span>
            <Calendar size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />
            <input
                id={id}
                type="date"
                aria-label={label}
                value={value || ''}
                min={min || undefined}
                max={max || undefined}
                onChange={(e) => {
                    const next = e.target.value;
                    if (!next && !allowEmpty) return;
                    onChange?.(next);
                }}
                className="date-overlay absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
        </div>
    );
}
