import { useEffect, useState } from 'react';
import { Check, Pin } from 'lucide-react';
import { Sheet } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { inkOn } from './GroupAvatar';

export const GROUP_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#6b7280'];
const field = 'h-12 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const lbl = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';

/** Create or edit a group: name, colour, pinned; delete with an inline confirmation (no confirm()). onSave(data) / onDelete(group). */
export default function GroupSheet({ open, onClose, group = null, onSave, onDelete, existingNames = [] }) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [color, setColor] = useState(GROUP_COLORS[5]);
    const [pinned, setPinned] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(group?.name || '');
        setColor(group?.color || GROUP_COLORS[(existingNames.length * 3) % GROUP_COLORS.length]);
        setPinned(!!group?.isPinned);
        setConfirm(false);
        setBusy(false);
    }, [open, group]); // eslint-disable-line react-hooks/exhaustive-deps

    const trimmed = name.trim();
    const duplicate = trimmed && existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase() && n !== group?.name);
    const canSave = trimmed && !duplicate && !busy;
    const save = async () => {
        if (!canSave) return;
        setBusy(true);
        try {
            await onSave({ name: trimmed, color, isPinned: pinned });
            onClose();
        } catch {
            setBusy(false);
        }
    };
    const remove = async () => {
        setBusy(true);
        try {
            await onDelete(group);
            onClose();
        } catch {
            setBusy(false);
        }
    };
    const title = group ? t('groups.edit') : t('groups.new');

    return (
        <Sheet open={open} onClose={onClose} label={title}>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
                <label className="flex flex-col gap-1.5">
                    <span className={lbl}>{t('groups.name')}</span>
                    <input className={field} value={name} placeholder={t('groups.namePlaceholder')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} data-autofocus data-testid="group-name" />
                    {duplicate ? <span className="text-xs text-over-ink">{t('groups.duplicate')}</span> : null}
                </label>
                <fieldset className="flex flex-col gap-2">
                    <legend className={`${lbl} pb-2`}>{t('groups.color')}</legend>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('groups.color')}>
                        {GROUP_COLORS.map((c) => (
                            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className="flex h-11 w-11 items-center justify-center rounded-full ring-offset-2 ring-offset-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink" style={{ backgroundColor: c }}>
                                {color === c ? <Check size={18} style={{ color: inkOn(c) }} aria-hidden="true" /> : null}
                            </button>
                        ))}
                    </div>
                </fieldset>
                <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[14px] border border-line-strong bg-surface px-3.5">
                    <Pin size={18} className={pinned ? 'text-forest-ink' : 'text-ink-muted'} aria-hidden="true" />
                    <span className="flex-1 text-[15px] text-ink">{t('groups.pin')}</span>
                    <input type="checkbox" role="switch" checked={pinned} onChange={(e) => setPinned(e.target.checked)} data-testid="group-pin" className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-line-strong transition-colors duration-press before:absolute before:start-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-white before:transition-transform checked:bg-forest checked:before:translate-x-5 rtl:checked:before:-translate-x-5" />
                </label>
                {confirm ? <p className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">{t('groups.deleteNote')}</p> : null}
            </div>
            <div className="flex flex-col gap-2 px-5 pt-3">
                {confirm ? (
                    <button type="button" onClick={remove} disabled={busy} className="h-14 rounded-[18px] bg-over text-base font-semibold text-white disabled:opacity-40" data-testid="group-delete-confirm">
                        {t('groups.deleteConfirm')}
                    </button>
                ) : (
                    <button type="button" onClick={save} disabled={!canSave} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40" data-testid="group-save">
                        {group ? t('groups.save') : t('groups.create')}
                    </button>
                )}
                {group && onDelete ? (
                    <button type="button" onClick={() => setConfirm((c) => !c)} className="h-12 rounded-[18px] text-sm font-semibold text-over-ink">
                        {confirm ? t('common.actions.cancel') : t('groups.delete')}
                    </button>
                ) : null}
            </div>
        </Sheet>
    );
}
