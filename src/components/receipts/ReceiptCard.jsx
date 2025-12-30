import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../utils/helpers';
import CurrencyDisplay from '../common/CurrencyDisplay';

export default function ReceiptCard({ receipt }) {
    const navigate = useNavigate();

    return (
        <div
            onClick={() => navigate(`/receipts/${receipt.id}`)}
            className="card cursor-pointer hover:shadow-lg transition-shadow w-full"
        >
            <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                    <h3 className="font-semibold text-lg text-gray-900">{receipt.merchant}</h3>
                    <p className="text-sm text-gray-500">{formatDate(receipt.date)}</p>
                </div>
                <div className="text-right">
                    <div className="font-bold text-xl text-gray-900">
                        <CurrencyDisplay amount={receipt.total} currency={receipt.currency} />
                    </div>
                    {receipt.category && (
                        <span className="inline-block mt-1 px-2 py-1 text-xs rounded" style={{ backgroundColor: '#e6f5f2', color: '#00573f' }}>
                            {receipt.category}
                        </span>
                    )}
                </div>
            </div>
            {receipt.notes && (
                <p className="text-sm text-gray-600 mt-2 line-clamp-1">{receipt.notes}</p>
            )}
            {receipt.lineItems && receipt.lineItems.length > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                    {receipt.lineItems.length} item{receipt.lineItems.length !== 1 ? 's' : ''}
                </p>
            )}
        </div>
    );
}

