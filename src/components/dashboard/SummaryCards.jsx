import { useNavigate } from 'react-router-dom';
import { DollarSign, Receipt, TrendingUp, Calendar, TrendingDown, ArrowUpDown } from 'lucide-react';
import CurrencyTotalDisplay from '../common/CurrencyTotalDisplay';

export default function SummaryCards({ receipts }) {
    const navigate = useNavigate();
    
    // Separate income and expenses
    const expenses = receipts.filter(r => (r.transactionType || 'expense') === 'expense');
    const income = receipts.filter(r => r.transactionType === 'income');
    
    const totalExpenses = expenses.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
    const totalIncome = income.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
    const net = totalIncome - totalExpenses;
    
    const totalReceipts = receipts.length;
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    const monthlyReceipts = receipts.filter(r => {
        const date = new Date(r.date);
        return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
    });
    const monthlyExpenses = monthlyReceipts
        .filter(r => (r.transactionType || 'expense') === 'expense')
        .reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
    const monthlyIncome = monthlyReceipts
        .filter(r => r.transactionType === 'income')
        .reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);

    const categories = {};
    expenses.forEach(r => {
        const cat = r.category || 'Other';
        categories[cat] = (categories[cat] || 0) + (parseFloat(r.total) || 0);
    });
    const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];

    const handleThisMonthClick = () => {
        navigate(`/receipts?filter=month&month=${thisMonth + 1}&year=${thisYear}`);
    };

    const handleTopCategoryClick = () => {
        if (topCategory) {
            navigate(`/receipts?filter=category&category=${encodeURIComponent(topCategory[0])}`);
        }
    };

    const handleTotalReceiptsClick = () => {
        navigate('/receipts');
    };

    return (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
            <div className="card cursor-pointer hover:shadow-lg transition-shadow p-4 sm:p-6" onClick={handleTotalReceiptsClick}>
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mb-1">Total Income</p>
                        <div className="text-lg sm:text-xl md:text-2xl font-bold text-green-600 dark:text-green-400 truncate">
                            <CurrencyTotalDisplay receipts={income} amount={totalIncome} />
                        </div>
                    </div>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                        <TrendingUp className="text-green-600" size={20} />
                    </div>
                </div>
            </div>

            <div className="card cursor-pointer hover:shadow-lg transition-shadow p-4 sm:p-6" onClick={handleTotalReceiptsClick}>
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mb-1">Total Expenses</p>
                        <div className="text-lg sm:text-xl md:text-2xl font-bold text-red-600 dark:text-red-400 truncate">
                            <CurrencyTotalDisplay receipts={expenses} amount={totalExpenses} />
                        </div>
                    </div>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                        <TrendingDown className="text-red-600" size={20} />
                    </div>
                </div>
            </div>

            <div className="card cursor-pointer hover:shadow-lg transition-shadow p-4 sm:p-6" onClick={handleTotalReceiptsClick}>
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mb-1">Net</p>
                        <div className={`text-lg sm:text-xl md:text-2xl font-bold truncate ${net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            <CurrencyTotalDisplay receipts={receipts} amount={net} />
                        </div>
                    </div>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                        <ArrowUpDown className="text-blue-600" size={20} />
                    </div>
                </div>
            </div>

            <div className="card cursor-pointer hover:shadow-lg transition-shadow p-4 sm:p-6" onClick={handleThisMonthClick}>
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mb-1">This Month</p>
                        <div className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white truncate">
                            <CurrencyTotalDisplay receipts={monthlyReceipts} amount={monthlyExpenses} />
                        </div>
                        {monthlyIncome > 0 && (
                            <div className="text-xs text-green-600 dark:text-green-400">
                                +<CurrencyTotalDisplay receipts={monthlyReceipts.filter(r => r.transactionType === 'income')} amount={monthlyIncome} />
                            </div>
                        )}
                    </div>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center flex-shrink-0 ml-2" style={{ backgroundColor: '#e6f5f2' }}>
                        <Calendar size={20} style={{ color: '#00573f' }} />
                    </div>
                </div>
            </div>
        </div>
    );
}

