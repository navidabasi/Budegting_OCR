import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Chip, ChipRow, Segmented, Sheet } from '../ui';
import { ME, buildSplit, fromCents, readSplit } from '../../utils/splits';
import { normalizeItems } from '../../utils/receiptItems';
import { usePeople } from '../../hooks/usePeople';
import { formatMoney, localeFor } from '../../utils/format';
import { useTranslation } from '../../languages/useTranslation';

const input = 'h-12 min-w-0 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const cap = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';
const num = (v) => {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

/**
 * Split an expense: who is in, who paid, and how it is shared (equal, percentages, fixed amounts or per item). Shares are exact cents;
 * leftover cents are named. Saves the v2 split shape (utils/splits.js).
 */
export default function SplitSheet({ open, onClose, total, currency = 'EUR', items = [], value, onSave }) {
    const { t, languageCode } = useTranslation();
    const { people, add } = usePeople();
    const locale = localeFor(languageCode, currency);
    const money = (cents) => formatMoney(fromCents(cents), currency, locale);
    const [chosen, setChosen] = useState([]); // person ids besides me
    const [meIn, setMeIn] = useState(true);
    const [payer, setPayer] = useState(ME);
    const [method, setMethod] = useState('equal');
    const [percents, setPercents] = useState({});
    const [fixed, setFixed] = useState({});
    const [alloc, setAlloc] = useState({});
    const [name, setName] = useState('');
    const lines = useMemo(() => normalizeItems(items).filter((it) => it.amount !== null), [items]);

    useEffect(() => {
        if (!open) return;
        const s = readSplit(value, total);
        if (s) {
            setChosen(s.participants.filter((p) => p.id !== ME).map((p) => p.id));
            setMeIn(s.participants.some((p) => p.id === ME));
            setPayer(s.payer);
            setMethod(s.method);
            setPercents(s.percents || {});
            setFixed(Object.fromEntries(Object.entries(s.shares).map(([k, v]) => [k, String(fromCents(v))])));
            setAlloc(s.itemAllocations ? Object.fromEntries(Object.entries(s.itemAllocations).map(([k, v]) => [k, Object.keys(v)])) : {});
        } else {
            setChosen([]);
            setMeIn(true);
            setPayer(ME);
            setMethod('equal');
            setPercents({});
            setFixed({});
            setAlloc({});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const known = useMemo(() => {
        const fromValue = readSplit(value, total)?.participants.filter((p) => p.id !== ME && !people.some((x) => x.id === p.id)) || [];
        return [...people, ...fromValue];
    }, [people, value, total]);
    const participants = [...(meIn ? [{ id: ME, name: t('shared.me') }] : []), ...known.filter((p) => chosen.includes(p.id))];
    const everyone = [{ id: ME, name: t('shared.me') }, ...known];
    const built = useMemo(() => (participants.length >= 1 ? buildSplit({ total, method, participants, payer, percents, fixed, items, allocations: alloc }) : null), [total, method, participants.map((p) => p.id).join(), payer, percents, fixed, items, alloc]); // eslint-disable-line react-hooks/exhaustive-deps
    const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    const canSave = !!built && built.ok && chosen.length >= 1 && (payer === ME || participants.some((p) => p.id === payer) || chosen.includes(payer));

    const addPerson = async () => {
        const p = await add(name);
        setName('');
        if (p) setChosen((c) => (c.includes(p.id) ? c : [...c, p.id]));
    };
    const methods = [
        { value: 'equal', label: t('shared.equal') },
        { value: 'percent', label: '%' },
        { value: 'fixed', label: t('shared.amounts') },
        ...(lines.length ? [{ value: 'items', label: t('shared.byItem') }] : []),
    ];

    return (
        <Sheet open={open} onClose={onClose} label={t('shared.splitTitle')}>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-2" data-testid="split-sheet">
                <h2 className="font-display text-lg font-bold text-ink">{t('shared.splitTitle')}</h2>
                <p className="font-mono text-sm text-ink-muted" dir="ltr">{formatMoney(total, currency, locale)}</p>

                <span className={cap}>{t('shared.with')}</span>
                <div className="flex flex-wrap gap-2">
                    <Chip selected={meIn} onClick={() => setMeIn((v) => !v)}>{t('shared.me')}</Chip>
                    {known.map((p) => (
                        <Chip key={p.id} selected={chosen.includes(p.id)} onClick={() => toggle(p.id)}>{p.name}</Chip>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input className={`${input} flex-1`} placeholder={t('shared.newPerson')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerson()} />
                    <button type="button" aria-label={t('shared.addPerson')} disabled={!name.trim()} onClick={addPerson} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-line-strong bg-surface text-ink disabled:opacity-40">
                        <Plus size={18} aria-hidden="true" />
                    </button>
                </div>

                <span className={cap}>{t('shared.paidBy')}</span>
                <ChipRow>
                    {everyone.filter((p) => p.id === ME || chosen.includes(p.id)).map((p) => (
                        <Chip key={p.id} selected={payer === p.id} onClick={() => setPayer(p.id)}>{p.name}</Chip>
                    ))}
                </ChipRow>

                <Segmented fill ariaLabel={t('shared.method')} value={method} onChange={setMethod} options={methods} />

                {method === 'percent' || method === 'fixed' ? (
                    <div className="flex flex-col gap-2">
                        {participants.map((p) => (
                            <label key={p.id} className="flex items-center gap-3 text-sm text-ink">
                                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                <input inputMode="decimal" dir="ltr" aria-label={p.name} className={`${input} w-28 font-mono`} value={method === 'percent' ? percents[p.id] ?? '' : fixed[p.id] ?? ''} onChange={(e) => (method === 'percent' ? setPercents({ ...percents, [p.id]: num(e.target.value) }) : setFixed({ ...fixed, [p.id]: e.target.value.replace(/[^\d.,]/g, '') }))} />
                                <span className="w-6 text-ink-muted">{method === 'percent' ? '%' : ''}</span>
                            </label>
                        ))}
                    </div>
                ) : null}

                {method === 'items' ? (
                    <div className="flex flex-col gap-2">
                        {lines.map((it) => (
                            <div key={it.id} className="flex flex-col gap-1 rounded-[14px] border border-line px-3 py-2">
                                <span className="flex justify-between text-sm text-ink"><span className="truncate">{it.name}</span><span className="font-mono" dir="ltr">{formatMoney(it.amount, currency, locale)}</span></span>
                                <div className="flex flex-wrap gap-1.5">
                                    {participants.map((p) => {
                                        const on = (alloc[it.id] || participants.map((x) => x.id)).includes(p.id);
                                        return <Chip key={p.id} size="sm" selected={on} onClick={() => { const cur = alloc[it.id] || participants.map((x) => x.id); setAlloc({ ...alloc, [it.id]: on ? cur.filter((x) => x !== p.id) : [...cur, p.id] }); }}>{p.name}</Chip>;
                                    })}
                                </div>
                            </div>
                        ))}
                        <p className="text-xs text-ink-muted">{t('shared.itemsRest')}</p>
                    </div>
                ) : null}

                {built ? (
                    <div className="rounded-[14px] bg-tint px-3.5 py-3 text-sm" data-testid="split-preview">
                        {participants.map((p) => (
                            <div key={p.id} className="flex justify-between text-ink"><span>{p.name}{payer === p.id ? ` · ${t('shared.paid')}` : ''}</span><span className="font-mono" dir="ltr">{money(built.split.shares[p.id] || 0)}</span></div>
                        ))}
                        {built.remainder.cents > 0 ? <p className="mt-1 text-xs text-ink-muted" data-testid="rounding-note">{t('shared.rounding', { cents: built.remainder.cents, who: built.remainder.to.map((id) => participants.find((p) => p.id === id)?.name || id).join(', ') })}</p> : null}
                        {!built.ok ? <p className="mt-1 text-xs font-semibold text-warn-ink">{t(built.percentShort ? 'shared.percentOff' : 'shared.amountOff', { diff: built.percentShort ? `${(built.difference / 100).toFixed(2)}%` : money(built.difference) })}</p> : null}
                    </div>
                ) : null}

                <button type="button" disabled={!canSave} onClick={() => onSave(built.split)} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40" data-testid="split-save">{t('shared.saveSplit')}</button>
                {value ? <button type="button" onClick={() => onSave(null)} className="h-12 rounded-[18px] text-sm font-semibold text-over-ink">{t('shared.removeSplit')}</button> : null}
            </div>
        </Sheet>
    );
}
