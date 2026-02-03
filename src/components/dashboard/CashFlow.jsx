import { formatCurrency, getEffectiveAmount } from '../../utils/helpers';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function CashFlow({ receipts }) {
    const navigate = useNavigate();

    // Get current month for filter
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    const handleIncomeClick = () => {
        // Navigate to receipts page with income filter for current month
        navigate(`/receipts?type=income&month=${currentMonth + 1}&year=${currentYear}`);
    };

    const handleExpenseClick = () => {
        // Navigate to receipts page with expense filter for current month
        navigate(`/receipts?type=expense&month=${currentMonth + 1}&year=${currentYear}`);
    };
    // Separate income and expenses
    const expenses = receipts.filter(r => (r.transactionType || 'expense') === 'expense');
    const income = receipts.filter(r => r.transactionType === 'income');

    // Calculate totals using effective amount (user's share if split)
    const totalExpenses = expenses.reduce((sum, r) => sum + getEffectiveAmount(r), 0);
    const totalIncome = income.reduce((sum, r) => sum + getEffectiveAmount(r), 0);

    // Calculate the max for scaling the bars
    const maxAmount = Math.max(totalIncome, totalExpenses, 1);

    // Calculate percentages for bar widths
    const incomePercentage = (totalIncome / maxAmount) * 100;
    const expensePercentage = (totalExpenses / maxAmount) * 100;

    // Net calculation
    const net = totalIncome - totalExpenses;

    // Get default currency from first receipt or fallback to EUR
    const defaultCurrency = receipts.length > 0 ? (receipts[0].currency || 'EUR') : 'EUR';

    return (
        <div className="card">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">Cash Flow</h3>

            <div className="space-y-4">
                {/* Income Bar */}
                <div
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={handleIncomeClick}
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={18} className="text-green-600 dark:text-green-400" />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Income</span>
                        </div>
                        <span className="text-sm font-bold text-green-600 dark:text-green-400">
                            {formatCurrency(totalIncome, defaultCurrency)}
                        </span>
                    </div>
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-green-500 dark:bg-green-600 rounded-full transition-all duration-500 ease-out flex items-center justify-end pr-2"
                            style={{ width: `${Math.max(incomePercentage, 2)}%` }}
                        >
                            {incomePercentage > 15 && (
                                <span className="text-xs font-medium text-white">
                                    {formatCurrency(totalIncome, defaultCurrency)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Expenses Bar */}
                <div
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={handleExpenseClick}
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <TrendingDown size={18} className="text-red-600 dark:text-red-400" />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Expenses</span>
                        </div>
                        <span className="text-sm font-bold text-red-600 dark:text-red-400">
                            {formatCurrency(totalExpenses, defaultCurrency)}
                        </span>
                    </div>
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-red-500 dark:bg-red-600 rounded-full transition-all duration-500 ease-out flex items-center justify-end pr-2"
                            style={{ width: `${Math.max(expensePercentage, 2)}%` }}
                        >
                            {expensePercentage > 15 && (
                                <span className="text-xs font-medium text-white">
                                    {formatCurrency(totalExpenses, defaultCurrency)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Net Summary */}
                <div className={`mt-4 p-3 rounded-lg ${net >= 0 ? 'bg-green-50 dark:bg-green-900/30' : 'bg-red-50 dark:bg-red-900/30'}`}>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Net Balance</span>
                        <span className={`text-lg font-bold ${net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {net >= 0 ? '+' : ''}{formatCurrency(net, defaultCurrency)}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
