import { formatCurrency, getEffectiveAmount } from '../../utils/helpers';
import { useReceiptNavigation } from '../../hooks/useNavigation';
import CurrencyDisplay from '../common/CurrencyDisplay';

export default function TopExpenses({ receipts }) {
    const nav = useReceiptNavigation();

    // Get current month's expenses only
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();

    const monthlyExpenses = receipts.filter(r => {
        const date = new Date(r.date);
        const isThisMonth = date.getMonth() === thisMonth && date.getFullYear() === thisYear;
        const isExpense = (r.transactionType || 'expense') === 'expense';
        return isThisMonth && isExpense;
    });

    // Sort by effective amount (user's share if split) and take top 5
    const topExpenses = [...monthlyExpenses]
        .sort((a, b) => getEffectiveAmount(b) - getEffectiveAmount(a))
        .slice(0, 5);

    if (topExpenses.length === 0) {
        return (
            <div className="card">
                <h3 className="text-lg font-semibold mb-4 dark:text-white">Top Expenses of the Month</h3>
                <p className="text-gray-500 dark:text-gray-400">No expenses this month</p>
            </div>
        );
    }

    const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });

    return (
        <div className="card">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">Top Expenses - {monthName}</h3>
            <div className="space-y-3">
                {topExpenses.map((receipt, index) => {
                    const effectiveAmount = getEffectiveAmount(receipt);
                    const hasSplit = receipt.splitData && effectiveAmount !== parseFloat(receipt.total);

                    return (
                        <div
                            key={receipt.id}
                            className="flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-2 rounded-lg transition-colors"
                            onClick={() => nav.toReceiptDetail(receipt.id, { initialReceipt: receipt, source: 'top_expenses' })}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300">
                                    {index + 1}
                                </div>
                                <div>
                                    <span className="font-medium text-gray-900 dark:text-white block">
                                        {receipt.merchant}
                                    </span>
                                    {receipt.category && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                            {receipt.category}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-semibold text-red-600 dark:text-red-400">
                                    <CurrencyDisplay amount={effectiveAmount} currency={receipt.currency} />
                                </div>
                                {hasSplit && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        Your share
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
