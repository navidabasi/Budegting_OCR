import CurrencyTotalDisplay from '../common/CurrencyTotalDisplay';

/**
 * Reusable summary card component
 * Used in SummaryCards widget to display financial metrics
 */
export default function SummaryCard({ 
    label, 
    amount, 
    receipts, 
    icon: Icon, 
    iconBg, 
    iconColor, 
    textColor, 
    onClick,
    subtitle = null
}) {
    return (
        <div className="card cursor-pointer hover:shadow-lg transition-shadow p-4 sm:p-6" onClick={onClick}>
            <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mb-1">{label}</p>
                    <div className={`text-lg sm:text-xl md:text-2xl font-bold truncate ${textColor}`}>
                        <CurrencyTotalDisplay receipts={receipts} amount={amount} />
                    </div>
                    {subtitle && (
                        <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                            {subtitle}
                        </div>
                    )}
                </div>
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center flex-shrink-0 ml-2 ${iconBg}`}>
                    <Icon className={iconColor} size={20} />
                </div>
            </div>
        </div>
    );
}
