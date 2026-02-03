import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Calendar, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';

const FREQUENCY_LABELS = {
    weekly: 'Weekly',
    biweekly: 'Bi-weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly'
};

export default function RecurringPayments({ receipts }) {
    const navigate = useNavigate();

    const recurringPayments = useMemo(() => {
        const recurring = receipts.filter(r => r.recurringData?.isActive);

        // Sort by next due date
        return recurring.sort((a, b) => {
            const dateA = new Date(a.recurringData?.nextDueDate || '9999-12-31');
            const dateB = new Date(b.recurringData?.nextDueDate || '9999-12-31');
            return dateA - dateB;
        });
    }, [receipts]);

    const getDaysUntilDue = (nextDueDate) => {
        if (!nextDueDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(nextDueDate);
        due.setHours(0, 0, 0, 0);
        const diffTime = due - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const getDueStatusClass = (daysUntil) => {
        if (daysUntil === null) return 'text-gray-500 dark:text-gray-400';
        if (daysUntil < 0) return 'text-red-600 dark:text-red-400 font-semibold';
        if (daysUntil === 0) return 'text-orange-600 dark:text-orange-400 font-semibold';
        if (daysUntil <= 3) return 'text-yellow-600 dark:text-yellow-400';
        return 'text-gray-600 dark:text-gray-300';
    };

    const getDueText = (daysUntil) => {
        if (daysUntil === null) return 'No date set';
        if (daysUntil < 0) return `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue`;
        if (daysUntil === 0) return 'Due today';
        if (daysUntil === 1) return 'Due tomorrow';
        return `Due in ${daysUntil} days`;
    };

    const monthlyTotal = useMemo(() => {
        return recurringPayments.reduce((sum, receipt) => {
            const amount = parseFloat(receipt.total) || 0;
            const frequency = receipt.recurringData?.frequency || 'monthly';

            // Convert to monthly equivalent
            switch (frequency) {
                case 'weekly':
                    return sum + (amount * 4.33);
                case 'biweekly':
                    return sum + (amount * 2.17);
                case 'monthly':
                    return sum + amount;
                case 'quarterly':
                    return sum + (amount / 3);
                case 'yearly':
                    return sum + (amount / 12);
                default:
                    return sum + amount;
            }
        }, 0);
    }, [recurringPayments]);

    if (recurringPayments.length === 0) {
        return (
            <div className="card h-full">
                <div className="flex items-center gap-2 mb-4">
                    <RefreshCw size={20} className="text-primary-600 dark:text-primary-400" />
                    <h3 className="text-lg font-semibold dark:text-white">Recurring Payments</h3>
                </div>
                <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
                    <p className="text-sm">No recurring payments set up</p>
                </div>
            </div>
        );
    }

    return (
        <div className="card h-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <RefreshCw size={20} className="text-primary-600 dark:text-primary-400" />
                    <h3 className="text-lg font-semibold dark:text-white">Recurring Payments</h3>
                </div>
                <div className="text-right">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Monthly total</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(monthlyTotal)}
                    </div>
                </div>
            </div>

            <div className="space-y-3 max-h-64 overflow-y-auto">
                {recurringPayments.slice(0, 5).map((receipt) => {
                    const daysUntil = getDaysUntilDue(receipt.recurringData?.nextDueDate);
                    const isOverdue = daysUntil !== null && daysUntil < 0;

                    return (
                        <div
                            key={receipt.id || receipt.supabaseId}
                            className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${
                                isOverdue
                                    ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                                    : 'border-gray-200 dark:border-gray-700'
                            }`}
                            onClick={() => navigate(`/receipts/${receipt.id}`)}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        {isOverdue && (
                                            <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                                        )}
                                        <p className="font-medium text-gray-900 dark:text-white truncate">
                                            {receipt.merchant || 'Unknown'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 text-xs">
                                        <span className="text-gray-500 dark:text-gray-400">
                                            {FREQUENCY_LABELS[receipt.recurringData?.frequency] || 'Monthly'}
                                        </span>
                                        <span className="text-gray-300 dark:text-gray-600">|</span>
                                        <span className={getDueStatusClass(daysUntil)}>
                                            {getDueText(daysUntil)}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0 ml-2">
                                    <p className="font-semibold text-gray-900 dark:text-white">
                                        {formatCurrency(receipt.total, receipt.currency)}
                                    </p>
                                    {receipt.category && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                            {receipt.category}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {recurringPayments.length > 5 && (
                <button
                    onClick={() => navigate('/receipts')}
                    className="w-full mt-3 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                >
                    View all {recurringPayments.length} recurring payments
                </button>
            )}
        </div>
    );
}
