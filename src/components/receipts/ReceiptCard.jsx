import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../utils/helpers';
import CurrencyDisplay from '../common/CurrencyDisplay';
import { Tag, Users } from 'lucide-react';

export default function ReceiptCard({ receipt }) {
    const navigate = useNavigate();

    return (
        <div
            onClick={() => navigate(`/receipts/${receipt.id}`)}
            className="card cursor-pointer hover:shadow-lg transition-shadow w-full"
        >
            <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg text-gray-900">{receipt.merchant}</h3>
                        {receipt.groupName && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-700">
                                <Tag size={12} />
                                {receipt.groupName}
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-gray-500">{formatDate(receipt.date)}</p>
                </div>
                <div className="text-right">
                    <div className={`font-bold text-xl ${receipt.transactionType === 'income' ? 'text-green-600' : 'text-gray-900'}`}>
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
            {receipt.splitData && (
                <p className="text-xs text-blue-600 mt-2 flex items-center gap-1">
                    <Users size={12} />
                    Split between {receipt.splitData.people} person{receipt.splitData.people !== 1 ? 's' : ''}
                </p>
            )}
        </div>
    );
}

