import CurrencyTotalDisplay from '../common/CurrencyTotalDisplay';
import { useReceiptNavigation } from '../../hooks/useNavigation';

export default function TopMerchants({ receipts }) {
    const nav = useReceiptNavigation();
    const merchantTotals = {};
    
    receipts.forEach(receipt => {
        const merchant = receipt.merchant || 'Unknown';
        merchantTotals[merchant] = (merchantTotals[merchant] || 0) + (parseFloat(receipt.total) || 0);
    });

    const topMerchants = Object.entries(merchantTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (topMerchants.length === 0) {
        return (
            <div className="card">
                <h3 className="text-lg font-semibold mb-4 dark:text-white">Top Merchants</h3>
                <p className="text-gray-500 dark:text-gray-300">No data to display</p>
            </div>
        );
    }

    return (
        <div className="card">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">Top Merchants</h3>
            <div className="space-y-3">
                {topMerchants.map(([merchant, total], index) => (
                    <div 
                        key={merchant} 
                        className="flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-2 rounded-lg transition-colors"
                        onClick={() => nav.toMerchant(merchant)}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm primary-bg primary-color">
                                {index + 1}
                            </div>
                            <span className="font-medium text-gray-900 dark:text-white">{merchant}</span>
                        </div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                            <CurrencyTotalDisplay 
                                receipts={receipts.filter(r => (r.merchant || 'Unknown') === merchant)} 
                                amount={total} 
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

