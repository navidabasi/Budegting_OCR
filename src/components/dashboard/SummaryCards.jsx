import { TrendingUp, Calendar, TrendingDown, ArrowUpDown } from 'lucide-react';
import SummaryCard from './SummaryCard';
import CurrencyTotalDisplay from '../common/CurrencyTotalDisplay';
import { useReceiptNavigation } from '../../hooks/useNavigation';
import { getEffectiveAmount } from '../../utils/helpers';

export default function SummaryCards({ receipts }) {
    const nav = useReceiptNavigation();

    // Separate income and expenses
    const expenses = receipts.filter(r => (r.transactionType || 'expense') === 'expense');
    const income = receipts.filter(r => r.transactionType === 'income');

    // Use effective amount (user's share if split)
    const totalExpenses = expenses.reduce((sum, r) => sum + getEffectiveAmount(r), 0);
    const totalIncome = income.reduce((sum, r) => sum + getEffectiveAmount(r), 0);
    const net = totalIncome - totalExpenses;

    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    const monthlyReceipts = receipts.filter(r => {
        const date = new Date(r.date);
        return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
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
                label="Total Income"
                amount={totalIncome}
                receipts={income}
                icon={TrendingUp}
                iconBg="bg-green-100"
                iconColor="text-green-600"
                textColor="text-green-600 dark:text-green-400"
                onClick={nav.toAllIncome}
            />
            <SummaryCard
                label="Total Expenses"
                amount={totalExpenses}
                receipts={expenses}
                icon={TrendingDown}
                iconBg="bg-red-100"
                iconColor="text-red-600"
                textColor="text-red-600 dark:text-red-400"
                onClick={nav.toAllExpenses}
            />
            <SummaryCard
                label="Net"
                amount={net}
                receipts={receipts}
                icon={ArrowUpDown}
                iconBg="bg-blue-100"
                iconColor="text-blue-600"
                textColor={net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                onClick={nav.toReceipts}
            />
            <SummaryCard
                label="This Month"
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

