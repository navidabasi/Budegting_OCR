import { Delete } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

const keyClass =
    'h-14 rounded-2xl bg-surface font-mono text-2xl font-medium text-ink shadow-[0_1px_2px_rgba(16,33,27,.06)] transition-transform active:scale-95 active:bg-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink dark:ring-1 dark:ring-line';

/**
 * In-app keypad. 4 columns; Save spans two rows in the thumb zone (bottom right).
 * onKey receives: '0'-'9', '00', ',', '+', 'back'.
 */
export default function Keypad({ onKey, onSave, saveLabel, saveDisabled, decimalLabel = ',' }) {
    const { t } = useTranslation();
    const num = (k, label = k) => (
        <button key={k} type="button" className={keyClass} onClick={() => onKey(k)}>
            {label}
        </button>
    );
    return (
        <div dir="ltr" className="grid shrink-0 grid-cols-4 gap-2 px-5 pt-2" data-testid="keypad">
            {num('1')}
            {num('2')}
            {num('3')}
            <button type="button" className={keyClass} aria-label={t('quickAdd.deleteDigit')} onClick={() => onKey('back')}>
                <Delete size={22} className="mx-auto" aria-hidden="true" />
            </button>
            {num('4')}
            {num('5')}
            {num('6')}
            <button type="button" className={`${keyClass} !text-lg !text-ink-muted`} aria-label={t('quickAdd.addAnother')} onClick={() => onKey('+')}>
                +
            </button>
            {num('7')}
            {num('8')}
            {num('9')}
            <button
                type="button"
                onClick={onSave}
                disabled={saveDisabled}
                className="row-span-2 flex items-center justify-center rounded-2xl bg-forest text-base font-semibold text-white transition-transform active:scale-95 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-ink"
            >
                {saveLabel}
            </button>
            <button type="button" className={keyClass} aria-label={t('quickAdd.decimalSeparator')} onClick={() => onKey(',')}>
                {decimalLabel}
            </button>
            {num('0')}
            {num('00')}
        </div>
    );
}
