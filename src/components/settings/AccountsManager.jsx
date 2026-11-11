import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Chip, Sheet } from '../ui';
import Amount from '../ui/Amount';
import { useAccounts, useRowMutations, useSettings, useTransactions } from '../../data/hooks';
import { useAppStore } from '../../store/appStore';
import { accountBalances } from '../../utils/money';
import { dateKey } from '../../utils/quickAdd';
import { useTranslation } from '../../languages/useTranslation';
import DateField from '../ui/DateField';

export const ACCOUNT_KINDS = ['spending', 'cash', 'savings', 'investment', 'debt', 'receivable'];
const field = 'h-12 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const lbl = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';

const parseMoney = (s) => {
    const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

/** Settings > Accounts: list with balances, add / edit / archive / delete. */
export default function AccountsManager() {
    const { t } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const { accounts } = useAccounts();
    const { transactions } = useTransactions();
    const { defaultCurrency } = useSettings();
    const { create, update, remove } = useRowMutations('accounts');
    const [form, setForm] = useState(null); // null | { id?, name, kind, counterparty, openingBalance, openingDate, currency }
    const [confirmRemove, setConfirmRemove] = useState(null);
    const [saving, setSaving] = useState(false);

    const balances = useMemo(() => new Map(accountBalances(accounts, transactions).map((b) => [b.id, b.balance])), [accounts, transactions]);
    const usedBy = (id) => transactions.some((tx) => tx.accountId === id || tx.toAccountId === id);

    const open = (a) =>
        setForm(
            a
                ? { id: a.id, name: a.name, kind: a.kind, counterparty: a.counterparty || '', openingBalance: String(a.openingBalance ?? 0).replace('.', ','), openingDate: a.openingDate || dateKey(0), currency: a.currency || defaultCurrency }
                : { name: '', kind: 'spending', counterparty: '', openingBalance: '', openingDate: dateKey(0), currency: defaultCurrency }
        );

    const nameTaken = form && accounts.some((a) => a.id !== form.id && a.name.trim().toLowerCase() === form.name.trim().toLowerCase());
    const canSave = form && form.name.trim() && !nameTaken && !saving;
    const needsCounterparty = form && (form.kind === 'debt' || form.kind === 'receivable');

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        const data = {
            name: form.name.trim(),
            kind: form.kind,
            currency: form.currency,
            openingBalance: parseMoney(form.openingBalance),
            openingDate: form.openingDate || dateKey(0),
            counterparty: needsCounterparty && form.counterparty.trim() ? form.counterparty.trim() : null,
        };
        try {
            if (form.id) await update(form.id, data);
            else await create({ ...data, isArchived: false, sortOrder: accounts.length });
            showToast(t('accounts.saved'), 'success');
            setForm(null);
        } catch {
            showToast(t('quickAdd.saveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const archiveOrDelete = async (a) => {
        try {
            if (usedBy(a.id)) await update(a.id, { isArchived: true });
            else await remove(a.id);
            showToast(t(usedBy(a.id) ? 'accounts.archived' : 'accounts.deleted'), 'success');
        } catch {
            showToast(t('quickAdd.saveFailed'), 'error');
        }
        setConfirmRemove(null);
        setForm(null);
    };

    return (
        <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">{t('accounts.intro')}</p>
            {accounts.length === 0 ? <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{t('accounts.empty')}</p> : null}
            <ul className="flex flex-col">
                {accounts.map((a) => (
                    <li key={a.id} className="border-b border-line last:border-0">
                        <button type="button" onClick={() => open(a)} className="flex min-h-[56px] w-full items-center gap-3 py-2 text-start">
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-[15px] font-medium text-ink">{a.name}</span>
                                <span className="text-xs text-ink-muted">
                                    {t(`accounts.kind.${a.kind}`)}
                                    {a.counterparty ? ` · ${a.counterparty}` : ''}
                                </span>
                            </span>
                            <Amount value={balances.get(a.id) ?? a.openingBalance ?? 0} currency={a.currency} symbol className="text-[15px]" />
                        </button>
                    </li>
                ))}
            </ul>
            <button type="button" onClick={() => open(null)} className="flex h-12 items-center justify-center gap-1.5 rounded-[14px] border border-line-strong bg-surface text-sm font-semibold text-forest-ink">
                <Plus size={16} aria-hidden="true" />
                {t('accounts.add')}
            </button>

            <Sheet open={!!form} onClose={() => setForm(null)} label={form?.id ? t('accounts.edit') : t('accounts.add')}>
                {form ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-2">
                        <h2 className="font-display text-lg font-bold text-ink">{form.id ? t('accounts.edit') : t('accounts.add')}</h2>
                        <label className="flex flex-col gap-1.5">
                            <span className={lbl}>{t('accounts.name')}</span>
                            <input className={field} value={form.name} placeholder={t('accounts.namePlaceholder')} onChange={(e) => setForm({ ...form, name: e.target.value })} data-autofocus />
                            {nameTaken ? <span className="text-xs text-over-ink">{t('accounts.nameTaken')}</span> : null}
                        </label>
                        <div className="flex flex-col gap-1.5">
                            <span className={lbl}>{t('accounts.kindLabel')}</span>
                            <div className="flex flex-wrap gap-2">
                                {ACCOUNT_KINDS.map((k) => (
                                    <Chip key={k} selected={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>
                                        {t(`accounts.kind.${k}`)}
                                    </Chip>
                                ))}
                            </div>
                            <span className="text-xs text-ink-muted">{t(`accounts.kindHint.${form.kind}`)}</span>
                        </div>
                        {needsCounterparty ? (
                            <label className="flex flex-col gap-1.5">
                                <span className={lbl}>{form.kind === 'debt' ? t('accounts.owedTo') : t('accounts.owedBy')}</span>
                                <input className={field} value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
                            </label>
                        ) : null}
                        <div className="flex gap-3">
                            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <span className={lbl}>{t('accounts.openingBalance')}</span>
                                <input className={`${field} font-mono`} inputMode="decimal" dir="ltr" value={form.openingBalance} placeholder="0,00" onChange={(e) => setForm({ ...form, openingBalance: e.target.value.replace(/[^\d.,-]/g, '') })} />
                            </label>
                            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <span className={lbl}>{t('accounts.openingDate')}</span>
                                <DateField value={form.openingDate} onChange={(v) => setForm({ ...form, openingDate: v })} label={t('accounts.openingDate')} />
                            </label>
                        </div>
                    </div>
                ) : null}
                <div className="flex flex-col gap-2 px-5 pt-3">
                    <button type="button" disabled={!canSave} onClick={save} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40">
                        {t('quickAdd.save')}
                    </button>
                    {form?.id ? (
                        <button type="button" onClick={() => setConfirmRemove(accounts.find((a) => a.id === form.id))} className="h-12 rounded-[18px] text-sm font-semibold text-over-ink">
                            {usedBy(form.id) ? t('accounts.archive') : t('common.actions.delete')}
                        </button>
                    ) : null}
                </div>
            </Sheet>

            <Sheet open={!!confirmRemove} onClose={() => setConfirmRemove(null)} label={t('accounts.removeTitle')}>
                {confirmRemove ? (
                    <div className="flex flex-col gap-3 px-5 pb-2">
                        <h2 className="font-display text-lg font-bold text-ink">{usedBy(confirmRemove.id) ? t('accounts.archiveTitle', { name: confirmRemove.name }) : t('accounts.deleteTitle', { name: confirmRemove.name })}</h2>
                        <p className="text-sm text-ink-muted">{usedBy(confirmRemove.id) ? t('accounts.archiveBody') : t('accounts.deleteBody')}</p>
                        <button type="button" onClick={() => archiveOrDelete(confirmRemove)} className="h-14 rounded-[18px] bg-over text-base font-semibold text-white" data-autofocus>
                            {usedBy(confirmRemove.id) ? t('accounts.archive') : t('common.actions.delete')}
                        </button>
                        <button type="button" onClick={() => setConfirmRemove(null)} className="h-12 rounded-[18px] text-sm font-semibold text-ink-muted">
                            {t('common.actions.cancel')}
                        </button>
                    </div>
                ) : null}
            </Sheet>
        </div>
    );
}
