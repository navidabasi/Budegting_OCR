import { Check } from 'lucide-react';
import { Sheet } from '../ui';
import { useTranslation } from '../../languages/useTranslation';

/** Bottom sheet with a list of options (single or multi select). options: [{ value, label, hint? }]. */
export default function PickerSheet({ open, title, options, selected, multi = false, onPick, onClose, onClear }) {
    const { t } = useTranslation();
    const isOn = (v) => (multi ? selected.includes(v) : selected === v);
    return (
        <Sheet open={open} onClose={onClose} label={title}>
            <div className="flex items-center justify-between px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
                {onClear ? (
                    <button type="button" onClick={onClear} className="h-11 px-2 text-sm font-semibold text-forest-ink">
                        {t('activity.clear')}
                    </button>
                ) : null}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-2" role={multi ? 'group' : 'radiogroup'}>
                {options.map((o) => (
                    <li key={o.value}>
                        <button
                            type="button"
                            role={multi ? 'checkbox' : 'radio'}
                            aria-checked={isOn(o.value)}
                            onClick={() => onPick(o.value)}
                            className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-3 text-start text-[15px] text-ink active:bg-line"
                        >
                            <span className="flex flex-col">
                                <span className={isOn(o.value) ? 'font-semibold' : ''}>{o.label}</span>
                                {o.hint ? <span className="text-xs text-ink-muted">{o.hint}</span> : null}
                            </span>
                            {isOn(o.value) ? <Check size={18} className="text-forest-ink" aria-hidden="true" /> : null}
                        </button>
                    </li>
                ))}
            </ul>
            {multi ? (
                <div className="px-5 pt-2">
                    <button type="button" onClick={onClose} className="h-12 w-full rounded-2xl bg-forest text-base font-semibold text-white">
                        {t('activity.done')}
                    </button>
                </div>
            ) : null}
        </Sheet>
    );
}
