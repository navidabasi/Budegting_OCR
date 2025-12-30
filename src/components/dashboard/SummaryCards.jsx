import { useNavigate } from 'react-router-dom';
import { DollarSign, Receipt, TrendingUp, Calendar } from 'lucide-react';
import CurrencyTotalDisplay from '../common/CurrencyTotalDisplay';

export default function SummaryCards({ receipts }) {
    const navigate = useNavigate();
    const totalExpenses = receipts.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
    const totalReceipts = receipts.length;
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    const monthlyReceipts = receipts.filter(r => {
        const date = new Date(r.date);
        return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
    });
    const monthlyExpenses = monthlyReceipts.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);

    const categories = {};
    receipts.forEach(r => {
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
                        <p className="text-xs sm:text-sm text-gray-600 mb-1">Total Expenses</p>
                        <div className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 truncate">
                            <CurrencyTotalDisplay receipts={receipts} amount={totalExpenses} />
                        </div>
                    </div>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center flex-shrink-0 ml-2" style={{ backgroundColor: '#e6f5f2' }}>
                        <DollarSign size={20} style={{ color: '#00573f' }} />
                    </div>
                </div>
            </div>

            <div className="card cursor-pointer hover:shadow-lg transition-shadow p-4 sm:p-6" onClick={handleTotalReceiptsClick}>
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-600 mb-1">Total Receipts</p>
                        <p className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">{totalReceipts}</p>
                    </div>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                        <Receipt className="text-blue-600" size={20} />
                    </div>
                </div>
            </div>

            <div className="card cursor-pointer hover:shadow-lg transition-shadow p-4 sm:p-6" onClick={handleThisMonthClick}>
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-600 mb-1">This Month</p>
                        <div className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 truncate">
                            <CurrencyTotalDisplay receipts={monthlyReceipts} amount={monthlyExpenses} />
                        </div>
                    </div>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center flex-shrink-0 ml-2" style={{ backgroundColor: '#e6f5f2' }}>
                        <Calendar size={20} style={{ color: '#00573f' }} />
                    </div>
                </div>
            </div>

            <div 
                className={`card p-4 sm:p-6 ${topCategory ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}`}
                onClick={topCategory ? handleTopCategoryClick : undefined}
            >
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-600 mb-1">Top Category</p>
                        <p className="text-base sm:text-lg font-bold text-gray-900 truncate">{topCategory?.[0] || 'N/A'}</p>
                        {topCategory && (
                            <div className="text-xs sm:text-sm text-gray-500 truncate">
                                <CurrencyTotalDisplay 
                                    receipts={receipts.filter(r => (r.category || 'Other') === topCategory[0])} 
                                    amount={topCategory[1]} 
                                />
                            </div>
                        )}
                    </div>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                        <TrendingUp className="text-purple-600" size={20} />
                    </div>
                </div>
            </div>
        </div>
    );
}

