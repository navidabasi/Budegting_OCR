import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PeriodSwitcher, Segmented } from '../components/ui';
import LoadingSpinner from '../components/common/LoadingSpinner';
import BudgetsTab from '../components/plan/BudgetsTab';
import SavingsTab from '../components/plan/SavingsTab';
import TripsTab from '../components/plan/TripsTab';
import GroupsOverview from '../components/groups/GroupsOverview';
import { usePeriod } from '../hooks/usePayCycle';
import { usePlanData } from '../hooks/usePlanData';
import { useTranslation } from '../languages/useTranslation';

const TABS = ['budgets', 'savings', 'trips'];

/** Plan: Budgets / Savings & accounts / Trips segments sharing the selected month (?m=) and the tab (?tab=). */
export default function PlanPage() {
    const { t } = useTranslation();
    const [params, setParams] = useSearchParams();
    const p = usePeriod();
    const month = p.period;
    const data = usePlanData();
    const rawTab = params.get('tab') === 'groups' ? 'trips' : params.get('tab'); // ?tab=groups opens Groups & trips
    const tab = TABS.includes(rawTab) ? rawTab : 'budgets';
    const setTab = useCallback(
        (value) =>
            setParams(
                (p) => {
                    const n = new URLSearchParams(p);
                    if (value === 'budgets') n.delete('tab');
                    else n.set('tab', value);
                    return n;
                },
                { replace: true }
            ),
        [setParams]
    );
    // The chat's prefilled budget sheet arrives as ?budget=<category>&amount=<n>
    const preset = params.get('budget') ? { category: params.get('budget'), amount: params.get('amount') || null } : null;
    // ...and the chat's add_goal action as ?goal=<name>&target=<n>&date=YYYY-MM-DD
    const goalPreset = params.get('goal') ? { name: params.get('goal'), targetAmount: params.get('target') || '', targetDate: params.get('date') || '' } : null;
    const clearPreset = () =>
        setParams(
            (p) => {
                const n = new URLSearchParams(p);
                n.delete('budget');
                n.delete('amount');
                n.delete('goal');
                n.delete('target');
                n.delete('date');
                return n;
            },
            { replace: true }
        );

    if (data.loading) return <LoadingSpinner className="pb-20" />;

    return (
        <main className="flex flex-col gap-3 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
            <div className="flex items-center justify-between pt-4">
                <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">{t('plan.title')}</h1>
                <PeriodSwitcher p={p} />
            </div>
            {TABS.length > 1 ? (
                <Segmented fill ariaLabel={t('plan.tabs')} value={tab} onChange={setTab} options={TABS.map((v) => ({ value: v, label: v === 'trips' ? t('groups.tab') : t(`plan.tab.${v}`) }))} />
            ) : null}
            {tab === 'trips' ? (
                <>
                    <GroupsOverview groups={data.groups} transactions={data.transactions} period={month} currency={data.currency} limit={6} title={t('groups.planSection')} testId="plan-groups" />
                    <h2 className="px-0.5 pt-2 font-display text-[17px] font-bold text-ink">{t('groups.sectionTrips')}</h2>
                    <TripsTab data={data} />
                </>
            ) : null}
            {tab === 'savings' ? <SavingsTab month={month} data={data} goalPreset={goalPreset} onGoalSheetClosed={clearPreset} /> : null}
            {tab === 'budgets' ? <BudgetsTab month={month} data={data} sheetPreset={preset} onSheetClosed={clearPreset} /> : null}
        </main>
    );
}
