import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, Chip, ChipRow, IconButton, Sheet } from '../components/ui';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { usePlanData } from '../hooks/usePlanData';
import { usePeople } from '../hooks/usePeople';
import { useCreateTransaction } from '../data/hooks';
import { useReceiptNavigation } from '../hooks/useNavigation';
import { useMoney } from '../hooks/useMoney';
import { useAppStore } from '../store/appStore';
import { useTranslation } from '../languages/useTranslation';
import { buildSettlement, fromCents, iOwe, owedToMe, personBalances } from '../utils/splits';
import { dateKey, getLastAccountId } from '../utils/quickAdd';

const input = 'h-12 min-w-0 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-forest-ink';
const cap = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';

/** Shared: who owes me, whom I owe, per person with history, and "Record settlement". People need no accounts. */
export default function SharedPage() {
    const { t, isRtl } = useTranslation();
    const navigate = useNavigate();
    const { money } = useMoney();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const showToast = useAppStore((s) => s.showToast);
    const { transactions, accounts, currency, loading } = usePlanData();
    const { people, add } = usePeople();
    const createTransaction = useCreateTransaction();
    const { toReceiptDetail } = useReceiptNavigation();
    const [name, setName] = useState('');
    const [open, setOpen] = useState(null); // person id
    const [settle, setSettle] = useState(null); // { person, direction, amount, accountId, date }

    const balances = useMemo(() => personBalances(transactions, people), [transactions, people]);
    const current = balances.find((b) => b.id === open) || null;
    if (loading) return <LoadingSpinner className="pb-20" />;
    const Back = isRtl ? ChevronRight : ChevronLeft;
    const c = (cents) => money(fromCents(Math.abs(cents)), currency);

    const startSettle = (b) => {
        const last = getLastAccountId();
        setSettle({ person: b, direction: b.cents >= 0 ? 'received' : 'paid', amount: String(fromCents(Math.abs(b.cents))).replace('.', ','), accountId: (accounts.find((a) => a.id === last) || accounts[0])?.id || null, date: dateKey(0) });
    };
    const saveSettle = async () => {
        const amount = parseFloat(String(settle.amount).replace(',', '.'));
        if (!(amount > 0)) return;
        const open = settle.person.events.filter((e) => e.kind !== 'settlement' && !e.settled && (settle.direction === 'received' ? e.cents > 0 : e.cents < 0)).map((e) => e.txId);
        try {
            await createTransaction(buildSettlement({ userId, person: { id: settle.person.id, name: settle.person.name }, direction: settle.direction, amount, date: settle.date, accountId: settle.accountId, currency, settles: open }));
            showToast(t('shared.settled'), 'success');
            setSettle(null);
        } catch {
            showToast(t('quickAdd.saveFailed'), 'error');
        }
    };

    return (
        <main className="flex flex-col gap-3.5 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]" data-testid="shared-page">
            <div className="flex items-center gap-1 pt-3">
                <IconButton label={t('common.actions.back')} icon={Back} size={22} onClick={() => navigate(-1)} />
                <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">{t('shared.title')}</h1>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
                <Card className="!rounded-[18px]" data-testid="owed-to-me"><p className={cap}>{t('shared.owedToMe')}</p><p className="font-mono text-2xl font-semibold text-income">{c(owedToMe(balances))}</p></Card>
                <Card className="!rounded-[18px]" data-testid="i-owe"><p className={cap}>{t('shared.iOwe')}</p><p className="font-mono text-2xl font-semibold text-over-ink">{c(iOwe(balances))}</p></Card>
            </div>
            <p className="text-xs text-ink-muted">{t('shared.basisNote')}</p>

            <Card className="!rounded-[18px] !py-1">
                {balances.length === 0 ? <p className="py-3 text-sm text-ink-muted">{t('shared.empty')}</p> : null}
                {balances.map((b) => (
                    <button key={b.id} type="button" onClick={() => setOpen(b.id)} className="flex min-h-[56px] w-full items-center gap-3 border-b border-line py-2 text-start last:border-0" data-testid="person-row">
                        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{b.name}</span>
                        <span className={`text-sm ${b.cents > 0 ? 'text-income' : b.cents < 0 ? 'text-over-ink' : 'text-ink-muted'}`}>
                            {b.cents > 0 ? t('shared.owesYou', { amount: c(b.cents) }) : b.cents < 0 ? t('shared.youOwe', { amount: c(b.cents) }) : t('shared.allSquare')}
                        </span>
                    </button>
                ))}
            </Card>

            <div className="flex gap-2">
                <input className={`${input} flex-1`} placeholder={t('shared.newPerson')} value={name} onChange={(e) => setName(e.target.value)} />
                <button type="button" aria-label={t('shared.addPerson')} disabled={!name.trim()} onClick={async () => { await add(name); setName(''); }} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-line-strong bg-surface text-ink disabled:opacity-40">
                    <Plus size={18} aria-hidden="true" />
                </button>
            </div>

            <Sheet open={!!current} onClose={() => setOpen(null)} label={current?.name || ''}>
                {current ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 pb-2" data-testid="person-sheet">
                        <h2 className="font-display text-lg font-bold text-ink">{current.name}</h2>
                        <p className="text-sm text-ink-muted">{current.cents > 0 ? t('shared.owesYou', { amount: c(current.cents) }) : current.cents < 0 ? t('shared.youOwe', { amount: c(current.cents) }) : t('shared.allSquare')}</p>
                        <button type="button" onClick={() => startSettle(current)} className="h-12 rounded-[16px] bg-forest text-base font-semibold text-white" data-testid="record-settlement">{t('shared.recordSettlement')}</button>
                        <span className={cap}>{t('shared.history')}</span>
                        <ul>
                            {current.events.map((e) => (
                                <li key={`${e.kind}-${e.txId}`} className="border-b border-line last:border-0">
                                    <button type="button" onClick={() => { setOpen(null); toReceiptDetail(e.txId); }} className="flex min-h-[52px] w-full items-center gap-3 py-2 text-start">
                                        <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-sm text-ink">{t(`shared.kind.${e.kind}`)}</span><span className="text-xs text-ink-muted">{e.date}{e.settled ? ` · ${t('shared.settledTag')}` : ''}</span></span>
                                        <span className={`font-mono text-sm ${e.cents > 0 ? 'text-income' : 'text-over-ink'}`} dir="ltr">{e.cents > 0 ? '+' : '-'}{c(e.cents)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </Sheet>

            <Sheet open={!!settle} onClose={() => setSettle(null)} label={t('shared.recordSettlement')}>
                {settle ? (
                    <div className="flex flex-col gap-3 px-5 pb-2" data-testid="settle-sheet">
                        <h2 className="font-display text-lg font-bold text-ink">{t('shared.recordSettlement')}</h2>
                        <ChipRow>
                            <Chip selected={settle.direction === 'received'} onClick={() => setSettle({ ...settle, direction: 'received' })}>{t('shared.received', { name: settle.person.name })}</Chip>
                            <Chip selected={settle.direction === 'paid'} onClick={() => setSettle({ ...settle, direction: 'paid' })}>{t('shared.paidTo', { name: settle.person.name })}</Chip>
                        </ChipRow>
                        <label className={cap} htmlFor="settle-amount">{t('items.amount')}</label>
                        <input id="settle-amount" inputMode="decimal" dir="ltr" className={`${input} font-mono`} value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value.replace(/[^\d.,]/g, '') })} />
                        {accounts.length ? <ChipRow>{accounts.map((a) => <Chip key={a.id} selected={settle.accountId === a.id} onClick={() => setSettle({ ...settle, accountId: a.id })}>{a.name}</Chip>)}</ChipRow> : null}
                        <label className={cap} htmlFor="settle-date">{t('period.from')}</label>
                        <input id="settle-date" type="date" className={input} value={settle.date} onChange={(e) => setSettle({ ...settle, date: e.target.value })} />
                        <p className="text-xs text-ink-muted">{t('shared.settleNote')}</p>
                        <button type="button" onClick={saveSettle} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white" data-testid="settle-save">{t('shared.saveSettlement')}</button>
                    </div>
                ) : null}
            </Sheet>
        </main>
    );
}
