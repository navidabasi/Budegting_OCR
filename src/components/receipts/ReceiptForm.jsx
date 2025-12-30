import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import Input from '../common/Input';
import Button from '../common/Button';
import { categoryService } from '../../services/categoryService';
import { formatCurrency } from '../../utils/helpers';
import { storageService } from '../../services/storage';
import { exchangeRateService } from '../../services/exchangeRateService';
import { useAppStore } from '../../store/appStore';

export default function ReceiptForm({ initialData = null, onSave, onClose }) {
    const currentUser = useAppStore((state) => state.currentUser);
    const [defaultCurrency, setDefaultCurrency] = useState('USD');
    const [selectedCurrency, setSelectedCurrency] = useState('USD');
    const [convertedAmount, setConvertedAmount] = useState(null);
    const [converting, setConverting] = useState(false);

    const formatDateForInput = (dateString) => {
        if (!dateString) return new Date().toISOString().split('T')[0];
        try {
            const date = new Date(dateString);
            return date.toISOString().split('T')[0];
        } catch {
            return new Date().toISOString().split('T')[0];
        }
    };

    const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
        defaultValues: initialData ? {
            merchant: initialData.merchant || '',
            date: formatDateForInput(initialData.date),
            total: initialData.total?.toString() || '',
            category: initialData.category || '',
            notes: initialData.notes || '',
            currency: initialData.currency || 'USD'
        } : {
            merchant: '',
            date: new Date().toISOString().split('T')[0],
            total: '',
            category: '',
            notes: '',
            currency: 'USD'
        }
    });

    useEffect(() => {
        const loadDefaultCurrency = async () => {
            if (currentUser) {
                try {
                    const currency = await storageService.getDefaultCurrency(currentUser.userId);
                    setDefaultCurrency(currency);
                    if (!initialData) {
                        setSelectedCurrency(currency);
                        setValue('currency', currency);
                    } else if (initialData.currency) {
                        setSelectedCurrency(initialData.currency);
                        setValue('currency', initialData.currency);
                    } else {
                        setSelectedCurrency(currency);
                        setValue('currency', currency);
                    }
                } catch (error) {
                    console.error('Failed to load default currency:', error);
                }
            }
        };
        loadDefaultCurrency();
    }, [currentUser, initialData, setValue]);

    const currencies = [
        { code: 'USD', name: 'US Dollar' },
        { code: 'EUR', name: 'Euro' },
        { code: 'GBP', name: 'British Pound' },
        { code: 'JPY', name: 'Japanese Yen' },
        { code: 'CAD', name: 'Canadian Dollar' },
        { code: 'AUD', name: 'Australian Dollar' },
        { code: 'CHF', name: 'Swiss Franc' },
        { code: 'CNY', name: 'Chinese Yuan' },
        { code: 'INR', name: 'Indian Rupee' },
        { code: 'MXN', name: 'Mexican Peso' },
        { code: 'BRL', name: 'Brazilian Real' },
        { code: 'ZAR', name: 'South African Rand' }
    ];

    const total = watch('total');
    const currency = watch('currency');

    useEffect(() => {
        if (currency) {
            setSelectedCurrency(currency);
        }
    }, [currency]);

    useEffect(() => {
        const convertAmount = async () => {
            if (!total || !selectedCurrency || !defaultCurrency || selectedCurrency === defaultCurrency) {
                setConvertedAmount(null);
                return;
            }

            setConverting(true);
            try {
                const amount = parseFloat(total);
                if (isNaN(amount) || amount <= 0) {
                    setConvertedAmount(null);
                    return;
                }
                const converted = await exchangeRateService.convertAmount(amount, selectedCurrency, defaultCurrency);
                setConvertedAmount(converted);
            } catch (error) {
                console.error('Failed to convert amount:', error);
                setConvertedAmount(null);
            } finally {
                setConverting(false);
            }
        };

        convertAmount();
    }, [total, selectedCurrency, defaultCurrency]);

    const [lineItems, setLineItems] = useState(
        initialData?.lineItems && initialData.lineItems.length > 0
            ? initialData.lineItems.map(item => ({
                name: item.name || '',
                quantity: item.quantity || 1,
                price: item.price?.toString() || '',
                category: item.category || ''
            }))
            : [{ name: '', quantity: 1, price: '', category: '' }]
    );

    const merchant = watch('merchant');

    useEffect(() => {
        if (merchant && !initialData) {
            const suggestedCategory = categoryService.suggestCategory(merchant);
            setValue('category', suggestedCategory);
        }
    }, [merchant, setValue, initialData]);

    const addLineItem = () => {
        setLineItems([...lineItems, { name: '', quantity: 1, price: '', category: '' }]);
    };

    const removeLineItem = (index) => {
        setLineItems(lineItems.filter((_, i) => i !== index));
    };

    const updateLineItem = (index, field, value) => {
        const updated = [...lineItems];
        updated[index] = { ...updated[index], [field]: value };

        // Auto-suggest category when item name is entered
        if (field === 'name' && value && value.trim()) {
            const suggestedCategory = categoryService.suggestCategory(merchant || '', value.trim());
            updated[index].category = suggestedCategory;
        }

        setLineItems(updated);
    };

    const calculateTotal = () => {
        const itemsTotal = lineItems.reduce((sum, item) => {
            return sum + (parseFloat(item.price || 0) * parseFloat(item.quantity || 1));
        }, 0);
        return itemsTotal;
    };

    const onSubmit = (data) => {
        const receiptData = {
            merchant: data.merchant,
            date: data.date,
            total: parseFloat(data.total) || calculateTotal(),
            currency: data.currency || defaultCurrency,
            category: data.category || categoryService.getDefaultCategory(),
            lineItems: lineItems.filter(item => item.name && item.price),
            notes: data.notes || ''
        };

        onSave(receiptData);
    };

    const itemsTotal = calculateTotal();

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
                label="Merchant"
                {...register('merchant', { required: 'Merchant name is required' })}
                error={errors.merchant?.message}
            />

            <Input
                label="Date"
                type="date"
                {...register('date', { required: 'Date is required' })}
                error={errors.date?.message}
            />

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Line Items
                </label>
                <div className="space-y-3">
                    {lineItems.map((item, index) => (
                        <div key={index} className="flex gap-2 items-start p-3 border border-gray-200 rounded-lg">
                            <div className="flex-1 space-y-2">
                                <input
                                    type="text"
                                    placeholder="Item name"
                                    value={item.name}
                                    onChange={(e) => updateLineItem(index, 'name', e.target.value)}
                                    className="input text-sm"
                                />
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        placeholder="Qty"
                                        value={item.quantity}
                                        onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 1)}
                                        className="input text-sm w-20"
                                        min="1"
                                        step="0.01"
                                    />
                                    <input
                                        type="number"
                                        placeholder="Price"
                                        value={item.price}
                                        onChange={(e) => updateLineItem(index, 'price', e.target.value)}
                                        className="input text-sm flex-1"
                                        min="0"
                                        step="0.01"
                                    />
                                    <select
                                        value={item.category}
                                        onChange={(e) => updateLineItem(index, 'category', e.target.value)}
                                        className="input text-sm flex-1"
                                    >
                                        <option value="">Category</option>
                                        {categoryService.getAllCategories().map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            {lineItems.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeLineItem(index)}
                                    className="text-red-500 hover:text-red-700 mt-1"
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={addLineItem}
                    className="mt-2 text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                    <Plus size={16} />
                    Add Item
                </button>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Currency
                </label>
                <select
                    {...register('currency')}
                    className="input mb-4"
                >
                    {currencies.map(curr => (
                        <option key={curr.code} value={curr.code}>
                            {curr.code} - {curr.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex gap-4">
                <div className="flex-1">
                    <Input
                        label="Total Amount"
                        type="number"
                        step="0.01"
                        {...register('total')}
                    />
                    {convertedAmount && selectedCurrency !== defaultCurrency && (
                        <p className="text-xs text-gray-500 mt-1">
                            ≈ {formatCurrency(convertedAmount, defaultCurrency)} ({defaultCurrency})
                        </p>
                    )}
                </div>
                <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Items Total
                    </label>
                    <div className="px-4 py-2 border border-gray-300 rounded-lg bg-gray-50" style={{ minHeight: '42px', display: 'flex', alignItems: 'center' }}>
                        {formatCurrency(itemsTotal, selectedCurrency)}
                    </div>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category
                </label>
                <select
                    {...register('category')}
                    className="input"
                >
                    <option value="">Select category</option>
                    {categoryService.getAllCategories().map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                    ))}
                </select>
            </div>

            <Input
                label="Notes (optional)"
                {...register('notes')}
            />

            <div className="flex gap-2 pt-4">
                <Button type="submit" variant="primary" className="flex-1">
                    Save Receipt
                </Button>
                <Button type="button" variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}

