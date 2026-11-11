import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { Chip, ChipRow } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { isTrip, splitGroups } from '../../utils/groupStats';

const field = 'h-11 min-w-0 flex-1 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';

/**
 * Group chips for a transaction form (replaces the native select): "No group", the suggested group first (the group of the last
 * transaction at the same merchant, with the reason), then the other groups, and "+ New" to create one in place.
 * value: groupId | null. onChange(group | null).
 */
export default function GroupPicker({ value, groups = [], suggested = null, merchant = '', onChange, onCreate }) {
    const { t } = useTranslation();
    const [adding, setAdding] = useState(false);
    const [name, setName] = useState('');
    const { groups: plain } = splitGroups(groups);
    const current = groups.find((g) => g.id === value) || null;
    const ordered = [...(current && isTrip(current) ? [current] : []), ...(suggested ? [suggested] : []), ...plain.filter((g) => g.id !== suggested?.id)];
    const create = async () => {
        const n = name.trim();
        if (!n || !onCreate) return;
        const g = await onCreate(n);
        if (g) onChange(g);
        setName('');
        setAdding(false);
    };
    return (
        <div className="flex flex-col gap-2" data-testid="group-picker">
            <ChipRow>
                <Chip size="sm" selected={!value} onClick={() => onChange(null)}>
                    {t('groups.none')}
                </Chip>
                {ordered.map((g) => (
                    <Chip key={g.id} size="sm" selected={value === g.id} tone={suggested?.id === g.id && value !== g.id ? 'suggested' : 'default'} onClick={() => onChange(value === g.id ? null : g)} data-testid={suggested?.id === g.id ? 'group-suggested' : undefined}>
                        {suggested?.id === g.id && value !== g.id ? <Sparkles size={13} aria-hidden="true" /> : <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color || '#6b7280' }} aria-hidden="true" />}
                        {g.name}
                    </Chip>
                ))}
                {onCreate ? (
                    <Chip size="sm" icon={Plus} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
                        {t('groups.newShort')}
                    </Chip>
                ) : null}
            </ChipRow>
            {suggested && value !== suggested.id && merchant ? <span className="text-xs text-ink-muted">{t('groups.suggested', { merchant, name: suggested.name })}</span> : null}
            {adding ? (
                <div className="flex gap-2">
                    <input className={field} value={name} placeholder={t('receipts.form.newGroupPlaceholder')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), create())} aria-label={t('groups.name')} />
                    <button type="button" className="h-11 shrink-0 rounded-xl bg-forest px-4 text-sm font-semibold text-white disabled:opacity-40" disabled={!name.trim()} onClick={create}>
                        {t('receipts.form.createAndSelect')}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
