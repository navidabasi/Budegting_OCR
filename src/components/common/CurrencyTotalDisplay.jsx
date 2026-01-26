import { useState, useEffect } from 'react';
import { formatCurrency, getEffectiveAmount } from '../../utils/helpers';
import { storageService } from '../../services/storage';
import { exchangeRateService } from '../../services/exchangeRateService';
import { useAppStore } from '../../store/appStore';

// Component to display totals that may come from receipts with different currencies
export default function CurrencyTotalDisplay({ receipts, amount }) {
    const currentUser = useAppStore((state) => state.currentUser);
    const [defaultCurrency, setDefaultCurrency] = useState('EUR');
    const [convertedAmount, setConvertedAmount] = useState(null);
    const [hasMultipleCurrencies, setHasMultipleCurrencies] = useState(false);

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
        const checkAndConvert = async () => {
            if (!receipts || receipts.length === 0 || !amount) {
                setConvertedAmount(null);
                setHasMultipleCurrencies(false);
                return;
            }

            // Check if receipts have different currencies
            const currencies = new Set(receipts.map(r => r.currency || 'USD').filter(Boolean));
            setHasMultipleCurrencies(currencies.size > 1);

            // If all receipts use the same currency and it's not the default, convert
            if (currencies.size === 1) {
                const receiptCurrency = Array.from(currencies)[0];
                if (receiptCurrency !== defaultCurrency) {
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
                    }
                } else {
                    setConvertedAmount(null);
                }
            } else if (currencies.size > 1) {
                // Multiple currencies - convert each receipt and sum
                try {
                    let totalConverted = 0;
                    for (const receipt of receipts) {
                        const receiptCurrency = receipt.currency || 'USD';
                        // Use effective amount (user's share if split)
                        const receiptAmount = getEffectiveAmount(receipt);
                        if (receiptCurrency === defaultCurrency) {
                            totalConverted += receiptAmount;
                        } else {
                            const converted = await exchangeRateService.convertAmount(
                                receiptAmount,
                                receiptCurrency,
                                defaultCurrency
                            );
                            totalConverted += converted;
                        }
                    }
                    setConvertedAmount(totalConverted);
                } catch (error) {
                    console.error('Failed to convert amounts:', error);
                    setConvertedAmount(null);
                }
            } else {
                setConvertedAmount(null);
            }
        };

        checkAndConvert();
    }, [receipts, amount, defaultCurrency]);

    if (!receipts || receipts.length === 0) {
        return <span>{formatCurrency(amount || 0, defaultCurrency)}</span>;
    }

    const currencies = new Set(receipts.map(r => r.currency || 'USD').filter(Boolean));
    const singleCurrency = currencies.size === 1 ? Array.from(currencies)[0] : null;

    if (singleCurrency && singleCurrency === defaultCurrency) {
        return <span>{formatCurrency(amount, defaultCurrency)}</span>;
    }

    if (singleCurrency && convertedAmount) {
        return (
            <div>
                <div>{formatCurrency(amount, singleCurrency)}</div>
                <div className="text-xs text-gray-500 dark:text-gray-300 mt-0.5">
                    ≈ {formatCurrency(convertedAmount, defaultCurrency)} ({defaultCurrency})
                </div>
            </div>
        );
    }

    if (hasMultipleCurrencies && convertedAmount !== null) {
        return (
            <div>
                <div>{formatCurrency(convertedAmount, defaultCurrency)}</div>
                <div className="text-xs text-gray-500 dark:text-gray-300 mt-0.5">
                    Converted from multiple currencies
                </div>
            </div>
        );
    }

    return <span>{formatCurrency(amount || 0, defaultCurrency)}</span>;
}

