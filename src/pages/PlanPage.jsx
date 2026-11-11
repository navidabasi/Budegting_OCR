import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MonthSwitcher, Segmented } from '../components/ui';
import LoadingSpinner from '../components/common/LoadingSpinner';
import BudgetsTab from '../components/plan/BudgetsTab';
import { useSelectedMonth } from '../hooks/useSelectedMonth';
import { usePlanData } from '../hooks/usePlanData';
import { useTranslation } from '../languages/useTranslation';

const TABS = ['budgets'];

/** Plan: Budgets / Savings & accounts / Trips segments sharing the selected month (?m=) and the tab (?tab=). */
export default function PlanPage() {
    const { t } = useTranslation();
    const [params, setParams] = useSearchParams();
    const { month, isCurrent, prev, next } = useSelectedMonth();
    const data = usePlanData();
    const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'budgets';
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
    const clearPreset = () =>
        setParams(
            (p) => {
                const n = new URLSearchParams(p);
                n.delete('budget');
                n.delete('amount');
                return n;
            },
            { replace: true }
        );

    if (data.loading) return <LoadingSpinner className="pb-20" />;

    return (
        <main className="flex flex-col gap-3 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
            <div className="flex items-center justify-between pt-4">
                <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">{t('plan.title')}</h1>
                <MonthSwitcher month={month} onPrev={prev} onNext={next} canNext={!isCurrent} />
            </div>
            {TABS.length > 1 ? (
                <Segmented fill ariaLabel={t('plan.tabs')} value={tab} onChange={setTab} options={TABS.map((v) => ({ value: v, label: t(`plan.tab.${v}`) }))} />
            ) : null}
            {tab === 'budgets' ? <BudgetsTab month={month} data={data} sheetPreset={preset} onSheetClosed={clearPreset} /> : null}
        </main>
    );
}
