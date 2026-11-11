import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Sheet } from '../ui';
import Amount from '../ui/Amount';
import { useTranslation } from '../../languages/useTranslation';

const norm = (s) =>
    String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');

/**
 * Bottom sheet with a list of options (single or multi select).
 * options: [{ value, label, hint?, count?, total?, color?, icon? }]. `count`/`total` show on the right (counts and spending per option);
 * `color` draws a dot (groups), `icon` a lucide icon. A search field appears when there are more than `searchFrom` options; multi
 * pickers get "Select all" / "None".
 */
export default function PickerSheet({ open, title, options, selected, multi = false, onPick, onClose, onClear, onSelectAll, searchFrom = 8, currency, footer = null }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const isOn = (v) => (multi ? selected.includes(v) : selected === v);
    const shown = useMemo(() => {
        const q = norm(query).trim();
        return q ? options.filter((o) => norm(`${o.label} ${o.hint || ''}`).includes(q)) : options;
    }, [options, query]);
    const close = () => {
        setQuery('');
        onClose();
    };
    const searchable = options.length > searchFrom;
    return (
        <Sheet open={open} onClose={close} label={title}>
            <div className="flex items-center justify-between gap-2 px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
                <div className="flex items-center">
                    {multi && onSelectAll ? (
                        <button type="button" onClick={() => onSelectAll(shown.map((o) => o.value))} className="h-11 px-2 text-sm font-semibold text-forest-ink" data-testid="picker-all">
                            {t('activity.selectAll')}
                        </button>
                    ) : null}
                    {onClear ? (
                        <button type="button" onClick={onClear} className="h-11 px-2 text-sm font-semibold text-forest-ink" data-testid="picker-none">
                            {multi ? t('activity.selectNone') : t('activity.clear')}
                        </button>
                    ) : null}
                </div>
            </div>
            {searchable ? (
                <div className="px-5 pb-2">
                    <label className="flex h-11 items-center gap-2 rounded-[14px] border border-line-strong bg-surface px-3 focus-within:ring-2 focus-within:ring-forest-ink">
                        <Search size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label={t('activity.searchOptions', { title })}
                            placeholder={t('activity.searchOptions', { title })}
                            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none"
                        />
                    </label>
                </div>
            ) : null}
            <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-2" role={multi ? 'group' : 'radiogroup'} aria-label={title}>
                {shown.map((o) => {
                    const Icon = o.icon;
                    return (
                        <li key={o.value || '__all'}>
                            <button
                                type="button"
                                role={multi ? 'checkbox' : 'radio'}
                                aria-checked={isOn(o.value)}
                                onClick={() => onPick(o.value)}
                                className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-start text-[15px] text-ink active:bg-line"
                            >
                                {o.color ? <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: o.color }} aria-hidden="true" /> : null}
                                {Icon ? <Icon size={18} className="shrink-0 text-ink-muted" aria-hidden="true" /> : null}
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className={`truncate ${isOn(o.value) ? 'font-semibold' : ''}`}>{o.label}</span>
                                    {o.hint ? <span className="truncate text-xs text-ink-muted">{o.hint}</span> : null}
                                </span>
                                {o.count !== undefined ? (
                                    <span className="flex shrink-0 items-baseline gap-1.5 text-xs text-ink-muted" data-testid="option-stats">
                                        <span className="mono-num">{t('activity.optionCount', { count: o.count })}</span>
                                        {o.total ? (
                                            <>
                                                <span aria-hidden="true">·</span>
                                                <Amount value={o.total} currency={currency} className="text-xs text-ink-muted" />
                                            </>
                                        ) : null}
                                    </span>
                                ) : null}
                                <span className="flex w-5 shrink-0 justify-end">{isOn(o.value) ? <Check size={18} className="text-forest-ink" aria-hidden="true" /> : null}</span>
                            </button>
                        </li>
                    );
                })}
                {shown.length === 0 ? <li className="px-3 py-6 text-center text-sm text-ink-muted">{t('activity.noOptions')}</li> : null}
            </ul>
            {footer}
            {multi ? (
                <div className="px-5 pt-2">
                    <button type="button" onClick={close} className="h-12 w-full rounded-2xl bg-forest text-base font-semibold text-white">
                        {t('activity.done')}
                    </button>
                </div>
            ) : null}
        </Sheet>
    );
}
