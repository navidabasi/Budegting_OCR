import { TrendingUp, Calendar, TrendingDown, ArrowUpDown } from 'lucide-react';
import SummaryCard from './SummaryCard';
import CurrencyTotalDisplay from '../common/CurrencyTotalDisplay';
import { useReceiptNavigation } from '../../hooks/useNavigation';
import { getEffectiveAmount, isDateInMonthYear } from '../../utils/helpers';
import { shouldIncludeInFinancialTotals } from '../../utils/tracking';
import { useTranslation } from '../../languages/useTranslation';

export default function SummaryCards({ receipts }) {
    const { t } = useTranslation();
    const nav = useReceiptNavigation();
    const financialReceipts = receipts.filter(shouldIncludeInFinancialTotals);

    // Separate income and expenses
    const expenses = financialReceipts.filter(r => (r.transactionType || 'expense') === 'expense');
    const income = financialReceipts.filter(r => r.transactionType === 'income');

    // Use effective amount (user's share if split)
    const totalExpenses = expenses.reduce((sum, r) => sum + getEffectiveAmount(r), 0);
    const totalIncome = income.reduce((sum, r) => sum + getEffectiveAmount(r), 0);
    const net = totalIncome - totalExpenses;

    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    const monthlyReceipts = financialReceipts.filter(r => {
        return isDateInMonthYear(r.date, thisMonth, thisYear);
    });
    const monthlyExpenses = monthlyReceipts
        .filter(r => (r.transactionType || 'expense') === 'expense')
        .reduce((sum, r) => sum + getEffectiveAmount(r), 0);
    const monthlyIncome = monthlyReceipts
        .filter(r => r.transactionType === 'income')
        .reduce((sum, r) => sum + getEffectiveAmount(r), 0);

    const monthlyIncomeSubtitle = monthlyIncome > 0 ? (
        <span>+<CurrencyTotalDisplay receipts={monthlyReceipts.filter(r => r.transactionType === 'income')} amount={monthlyIncome} /></span>
    ) : null;

    return (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
            <SummaryCard
                label={t('dashboard.summary.totalIncome')}
                amount={totalIncome}
                receipts={income}
                icon={TrendingUp}
                iconBg="bg-green-100"
                iconColor="text-green-600"
                textColor="text-green-600 dark:text-green-400"
                onClick={nav.toAllIncome}
            />
            <SummaryCard
                label={t('dashboard.summary.totalExpenses')}
                amount={totalExpenses}
                receipts={expenses}
                icon={TrendingDown}
                iconBg="bg-red-100"
                iconColor="text-red-600"
                textColor="text-red-600 dark:text-red-400"
                onClick={nav.toAllExpenses}
            />
            <SummaryCard
                label={t('dashboard.cashFlow.net')}
                amount={net}
                receipts={financialReceipts}
                icon={ArrowUpDown}
                iconBg="bg-blue-100"
                iconColor="text-blue-600"
                textColor={net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                onClick={nav.toReceipts}
            />
            <SummaryCard
                label={t('dashboard.summary.thisMonth')}
                amount={monthlyExpenses}
                receipts={monthlyReceipts}
                icon={Calendar}
                iconBg="primary-bg"
                iconColor="primary-color"
                textColor="text-gray-900 dark:text-white"
                onClick={() => nav.toMonth(thisMonth + 1, thisYear)}
                subtitle={monthlyIncomeSubtitle}
            />
        </div>
    );
}
