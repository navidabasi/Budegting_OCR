import { useState, useEffect } from 'react';
import { formatCurrency } from '../../utils/helpers';
import { storageService } from '../../services/storage';
import { exchangeRateService } from '../../services/exchangeRateService';
import { useAppStore } from '../../store/appStore';

export default function CurrencyDisplay({ amount, currency: receiptCurrency }) {
    const currentUser = useAppStore((state) => state.currentUser);
    const [defaultCurrency, setDefaultCurrency] = useState('EUR');
    const [convertedAmount, setConvertedAmount] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const loadDefaultCurrency = async () => {
            if (currentUser) {
                const currency = await storageService.getDefaultCurrency(currentUser.userId);
                setDefaultCurrency(currency);
            }
        };
        loadDefaultCurrency();
    }, [currentUser]);

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

