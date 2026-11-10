import { useState, useEffect } from 'react';
import { formatCurrency } from '../../utils/helpers';
import { useSettings } from '../../data/hooks';
import { exchangeRateService } from '../../services/exchangeRateService';

export default function CurrencyDisplay({ amount, currency: receiptCurrency }) {
    const { defaultCurrency } = useSettings();
    const [convertedAmount, setConvertedAmount] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const convertAmount = async () => {
            if (!amount || !receiptCurrency || !defaultCurrency || receiptCurrency === defaultCurrency) {
                setConvertedAmount(null);
                return;
            }

            setLoading(true);
            try {
                const converted = await exchangeRateService.convertAmount(
                    parseFloat(amount),
                    receiptCurrency,
                    defaultCurrency
                );
                setConvertedAmount(converted);
            } catch (error) {
                console.error('Failed to convert amount:', error);
                setConvertedAmount(null);
            } finally {
                setLoading(false);
            }
        };

        convertAmount();
    }, [amount, receiptCurrency, defaultCurrency]);

    if (!receiptCurrency) {
        return <span>{formatCurrency(amount, defaultCurrency)}</span>;
    }

    if (receiptCurrency === defaultCurrency) {
        return <span>{formatCurrency(amount, receiptCurrency)}</span>;
    }

    return (
        <div>
            <div>{formatCurrency(amount, receiptCurrency)}</div>
            {convertedAmount && (
                <div className="text-sm text-gray-500 mt-0.5">
                    ≈ {formatCurrency(convertedAmount, defaultCurrency)} ({defaultCurrency})
                </div>
            )}
        </div>
    );
}

