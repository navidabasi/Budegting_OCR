import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, Trash2, Users, X, Tag } from 'lucide-react';
import Input from '../common/Input';
import Button from '../common/Button';
import SplitManager from './SplitManager';
import { categoryService } from '../../services/categoryService';
import { formatCurrency } from '../../utils/helpers';
import { storageService } from '../../services/storage';
import { exchangeRateService } from '../../services/exchangeRateService';
import { useAppStore } from '../../store/appStore';

export default function ReceiptForm({ initialData = null, onSave, onClose }) {
    const currentUser = useAppStore((state) => state.currentUser);
    const [defaultCurrency, setDefaultCurrency] = useState('EUR');
    const [selectedCurrency, setSelectedCurrency] = useState('EUR');
    const [convertedAmount, setConvertedAmount] = useState(null);
    const [converting, setConverting] = useState(false);
    const [categories, setCategories] = useState([]);
    const [groups, setGroups] = useState([]);
    const [newGroupName, setNewGroupName] = useState('');
    const [showNewGroupInput, setShowNewGroupInput] = useState(false);
    const [showSplitManager, setShowSplitManager] = useState(false);
    const [splitData, setSplitData] = useState(null);

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
            currency: initialData.currency || 'EUR',
            transactionType: initialData.transactionType || 'expense',
            groupId: initialData.groupId || '',
            groupName: initialData.groupName || '',
            groupTags: initialData.groupTags || []
        } : {
            merchant: '',
            date: new Date().toISOString().split('T')[0],
            total: '',
            category: '',
            notes: '',
            currency: 'EUR',
            transactionType: 'expense',
            groupId: '',
            groupName: '',
            groupTags: []
        }
    });

    useEffect(() => {
        if (initialData?.splitData) {
            setSplitData(initialData.splitData);
        }
    }, [initialData]);

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

    useEffect(() => {
        const loadCategories = async () => {
            if (currentUser) {
                try {
                    const cats = await categoryService.getAllCategories(currentUser.userId);
                    setCategories(cats);
                } catch (error) {
                    console.error('Failed to load categories:', error);
                    setCategories(categoryService.getAllCategoriesSync()); // Fallback to default
                }
            } else {
                setCategories(categoryService.getAllCategoriesSync()); // Fallback to default
            }
        };
        loadCategories();
        loadGroups();
    }, [currentUser]);

    const loadGroups = async () => {
        if (currentUser) {
            try {
                const allGroups = await storageService.getAllGroups(currentUser.userId);
                
                // Organize groups into parent and nested groups
                const parentGroups = allGroups.filter(g => !g.parentGroupId);
                const nestedGroups = allGroups.filter(g => g.parentGroupId);
                
                // Attach nested groups to their parents
                const organizedGroups = parentGroups.map(parent => {
                    const children = nestedGroups.filter(nested => 
                        String(nested.parentGroupId) === String(parent.id) || 
                        String(nested.parentGroupId) === String(parent.supabaseId)
                    );
                    return {
                        ...parent,
                        nestedGroups: children
                    };
                });
                
                // Add nested groups that don't have a parent (orphaned) as separate items
                const orphanedNested = nestedGroups.filter(nested => {
                    const hasParent = parentGroups.some(parent => 
                        String(nested.parentGroupId) === String(parent.id) || 
                        String(nested.parentGroupId) === String(parent.supabaseId)
                    );
                    return !hasParent;
                });
                
                // Combine organized groups with orphaned nested groups
                const allOrganizedGroups = [...organizedGroups, ...orphanedNested];
                
                setGroups(allOrganizedGroups);
                console.log('[ReceiptForm] Loaded groups:', allOrganizedGroups);
            } catch (error) {
                console.error('Failed to load groups:', error);
            }
        }
    };

    const currencies = [
        { code: 'EUR', name: 'Euro' },
        { code: 'USD', name: 'US Dollar' },
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
        // Always use watched values for group to ensure we get the latest state
        const currentGroupId = watch('groupId') || null;
        const currentGroupName = watch('groupName') || null;
        const currentGroupTags = watch('groupTags') || [];
        
        // If groupId is set, ensure we have the groupName
        let finalGroupId = currentGroupId;
        let finalGroupName = currentGroupName;
        
        if (currentGroupId && !currentGroupName) {
            // Try to find the group name from the groups list
            const selectedGroup = groups.find(g => 
                String(g.id) === String(currentGroupId) || 
                String(g.supabaseId) === String(currentGroupId)
            );
            if (selectedGroup) {
                finalGroupName = selectedGroup.name;
                finalGroupId = selectedGroup.supabaseId || selectedGroup.id;
            }
        }
        
        const receiptData = {
            merchant: data.merchant,
            date: data.date,
            total: parseFloat(data.total) || calculateTotal(),
            currency: data.currency || defaultCurrency,
            category: data.category || categoryService.getDefaultCategory(),
            lineItems: lineItems.filter(item => item.name && item.price),
            notes: data.notes || '',
            transactionType: data.transactionType || 'expense',
            groupId: finalGroupId,
            groupName: finalGroupName,
            groupTags: currentGroupTags,
            splitData: splitData || null
        };

        console.log('[ReceiptForm] Submitting receipt with group:', { 
            groupId: finalGroupId, 
            groupName: finalGroupName,
            formData: receiptData
        });
        onSave(receiptData);
    };

    const itemsTotal = calculateTotal();

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 w-full overflow-hidden">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                    Transaction Type *
                </label>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setValue('transactionType', 'expense')}
                        className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                            watch('transactionType') === 'expense'
                                ? 'border-red-500 bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-300'
                                : 'border-gray-300 bg-white dark:bg-gray-700 text-gray-700 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                    >
                        Expense
                    </button>
                    <button
                        type="button"
                        onClick={() => setValue('transactionType', 'income')}
                        className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                            watch('transactionType') === 'income'
                                ? 'border-green-500 bg-green-50 dark:bg-green-900 text-green-700 dark:text-green-300'
                                : 'border-gray-300 bg-white dark:bg-gray-700 text-gray-700 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                    >
                        Income
                    </button>
                </div>
                <input type="hidden" {...register('transactionType', { value: 'expense' })} />
            </div>

            <div style={{ padding: '0 2px' }}>
                <Input
                    label="Merchant"
                    {...register('merchant', { required: 'Merchant name is required' })}
                    error={errors.merchant?.message}
                />
            </div>

            <div style={{ padding: '0 2px' }}>
                <Input
                    label="Date"
                    type="date"
                    {...register('date', { required: 'Date is required' })}
                    error={errors.date?.message}
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-2">
                    Line Items
                </label>
                <div className="space-y-3">
                    {lineItems.map((item, index) => (
                        <div key={index} className="flex gap-2 items-start p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800">
                            <div className="flex-1 space-y-2">
                                <input
                                    type="text"
                                    placeholder="Item name"
                                    value={item.name}
                                    onChange={(e) => updateLineItem(index, 'name', e.target.value)}
                                    className="input text-sm"
                                    style={{ padding: '0.75rem 1rem', margin: 0 }}
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
                                        style={{ padding: '0.75rem 1rem', margin: 0 }}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Price"
                                        value={item.price}
                                        onChange={(e) => updateLineItem(index, 'price', e.target.value)}
                                        className="input text-sm flex-1"
                                        min="0"
                                        step="0.01"
                                        style={{ padding: '0.75rem 1rem', margin: 0 }}
                                    />
                                    <select
                                        value={item.category}
                                        onChange={(e) => updateLineItem(index, 'category', e.target.value)}
                                        className="input text-sm flex-1"
                                        style={{ padding: '0.75rem 1rem', margin: 0 }}
                                    >
                                        <option value="">Category</option>
                                        {categories.map(cat => (
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

            <div style={{ padding: '0 2px' }}>
                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                    Currency
                </label>
                <select
                    {...register('currency')}
                    className="input mb-4"
                    style={{ padding: '0.75rem 1rem', margin: 0 }}
                >
                    {currencies.map(curr => (
                        <option key={curr.code} value={curr.code}>
                            {curr.code} - {curr.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex gap-4">
                <div className="flex-1" style={{ padding: '0 2px' }}>
                    <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                        Total Amount
                    </label>
                    <input
                        type="number"
                        step="0.01"
                        {...register('total')}
                        className="input"
                        style={{ 
                            padding: '0.75rem 1rem',
                            minHeight: '42px',
                            margin: 0
                        }}
                    />
                    {convertedAmount && selectedCurrency !== defaultCurrency && (
                        <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">
                            ≈ {formatCurrency(convertedAmount, defaultCurrency)} ({defaultCurrency})
                        </p>
                    )}
                </div>
                <div className="flex-1" style={{ padding: '0 2px' }}>
                    <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                        Items Total
                    </label>
                    <div className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white" style={{ minHeight: '42px', display: 'flex', alignItems: 'center' }}>
                        {formatCurrency(itemsTotal, selectedCurrency)}
                    </div>
                </div>
            </div>

            <div style={{ padding: '0 2px' }}>
                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                    Category
                </label>
                <select
                    {...register('category')}
                    className="input"
                    style={{ padding: '0.75rem 1rem', margin: 0 }}
                >
                    <option value="">Select category</option>
                    {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                    ))}
                </select>
            </div>

            <div style={{ padding: '0 2px' }}>
                <Input
                    label="Notes (optional)"
                    {...register('notes')}
                />
            </div>

            <div style={{ padding: '0 2px' }}>
                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                    Group (optional)
                </label>
                <div className="flex flex-col gap-2">
                    {watch('groupId') && watch('groupName') && (() => {
                        // Find the selected group (could be in parent or nested)
                        let selectedGroup = null;
                        let isNested = false;
                        
                        for (const group of groups) {
                            if (String(group.id) === String(watch('groupId')) || 
                                String(group.supabaseId) === String(watch('groupId'))) {
                                selectedGroup = group;
                                isNested = !!group.parentGroupId;
                                break;
                            }
                            // Check nested groups
                            if (group.nestedGroups) {
                                const nested = group.nestedGroups.find(n => 
                                    String(n.id) === String(watch('groupId')) || 
                                    String(n.supabaseId) === String(watch('groupId'))
                                );
                                if (nested) {
                                    selectedGroup = nested;
                                    isNested = true;
                                    break;
                                }
                            }
                        }
                        
                        const groupColor = selectedGroup?.color || '#3b82f6';
                        return (
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-600 dark:text-gray-300">Selected:</span>
                                <span 
                                    className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded"
                                    style={{ 
                                        backgroundColor: groupColor + '20',
                                        color: groupColor,
                                        border: `1px solid ${groupColor}40`
                                    }}
                                >
                                    <Tag size={12} style={{ color: groupColor }} />
                                    {isNested && <span className="opacity-70">└─</span>}
                                    {watch('groupName')}
                                    {isNested && <span className="text-xs opacity-70 ml-1">(Nested)</span>}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setValue('groupId', '');
                                            setValue('groupName', '');
                                        }}
                                        className="hover:opacity-70"
                                        style={{ color: groupColor }}
                                    >
                                        <X size={14} />
                                    </button>
                                </span>
                            </div>
                        );
                    })()}
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <select
                                className="input"
                                value={watch('groupId') || ''}
                                style={{ padding: '0.75rem 1rem', margin: 0 }}
                                onChange={(e) => {
                                    // Find the selected group (could be in parent or nested)
                                    let selectedGroup = null;
                                    
                                    for (const group of groups) {
                                        const groupValue = String(group.supabaseId || group.id);
                                        if (groupValue === String(e.target.value)) {
                                            selectedGroup = group;
                                            break;
                                        }
                                        // Check nested groups
                                        if (group.nestedGroups) {
                                            const nested = group.nestedGroups.find(n => {
                                                const nestedValue = String(n.supabaseId || n.id);
                                                return nestedValue === String(e.target.value);
                                            });
                                            if (nested) {
                                                selectedGroup = nested;
                                                break;
                                            }
                                        }
                                    }
                                    
                                    const newGroupId = selectedGroup ? (selectedGroup.supabaseId || selectedGroup.id) : '';
                                    const newGroupName = selectedGroup?.name || '';
                                    
                                    console.log('[ReceiptForm] Group selected:', { 
                                        selectedValue: e.target.value,
                                        selectedGroup,
                                        newGroupId,
                                        newGroupName,
                                        isNested: selectedGroup?.parentGroupId ? true : false
                                    });
                                    
                                    setValue('groupId', newGroupId, { shouldValidate: true, shouldDirty: true });
                                    setValue('groupName', newGroupName, { shouldValidate: true, shouldDirty: true });
                                    setValue('groupTags', [], { shouldValidate: true, shouldDirty: true });
                                }}
                            >
                                <option value="">No group</option>
                                {groups.map(group => {
                                    const groupValue = group.supabaseId || group.id;
                                    const isNested = !!group.parentGroupId;
                                    
                                    // If it's a parent group with nested groups, show it and its children
                                    if (group.nestedGroups && group.nestedGroups.length > 0) {
                                        return (
                                            <optgroup key={group.id} label={group.name}>
                                                <option value={String(groupValue)}>
                                                    {group.name} (Parent)
                                                </option>
                                                {group.nestedGroups.map(nested => {
                                                    const nestedValue = nested.supabaseId || nested.id;
                                                    return (
                                                        <option key={nested.id} value={String(nestedValue)}>
                                                            &nbsp;&nbsp;└─ {nested.name}
                                                        </option>
                                                    );
                                                })}
                                            </optgroup>
                                        );
                                    }
                                    
                                    // Regular parent group or orphaned nested group
                                    return (
                                        <option key={group.id} value={String(groupValue)}>
                                            {isNested ? '└─ ' : ''}{group.name}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setShowNewGroupInput(!showNewGroupInput)}
                        >
                            <Plus size={18} />
                        </Button>
                    </div>
                </div>
                {showNewGroupInput && (
                    <div className="mt-2 p-3 border border-gray-200 rounded-lg bg-gray-50">
                        <Input
                            placeholder="New group name"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            className="mb-2"
                        />
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={async () => {
                                    if (!newGroupName.trim() || !currentUser) return;
                                    
                                    try {
                                        // Create group in groups table
                                        const groupId = await storageService.createGroup(currentUser.userId, {
                                            name: newGroupName.trim(),
                                            color: '#3b82f6',
                                            isPinned: false
                                        });
                                        
                                        // Get the created group
                                        const createdGroup = await storageService.getGroupById(groupId);
                                        
                                        // Reload groups to ensure consistency
                                        await loadGroups();
                                        
                                        // Set form values with validation flags
                                        const groupIdToUse = createdGroup.supabaseId || createdGroup.id;
                                        setValue('groupId', groupIdToUse, { shouldValidate: true, shouldDirty: true });
                                        setValue('groupName', createdGroup.name, { shouldValidate: true, shouldDirty: true });
                                        setValue('groupTags', [], { shouldValidate: true, shouldDirty: true });
                                        
                                        setNewGroupName('');
                                        setShowNewGroupInput(false);
                                    } catch (error) {
                                        console.error('Failed to create group:', error);
                                    }
                                }}
                            >
                                Create & Select
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                    setShowNewGroupInput(false);
                                    setNewGroupName('');
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                    Split Receipt (optional)
                </label>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant={splitData ? "primary" : "secondary"}
                        onClick={() => setShowSplitManager(true)}
                        className="flex items-center gap-2"
                    >
                        <Users size={18} />
                        {splitData ? (
                            splitData.method === 'equal' 
                                ? `Split between ${splitData.people} people`
                                : `Custom split (${splitData.users?.length || 0} people)`
                        ) : 'Add Split'}
                    </Button>
                    {splitData && (
                        <button
                            type="button"
                            onClick={() => {
                                setSplitData(null);
                            }}
                            className="text-red-500 hover:text-red-700 text-sm"
                        >
                            Remove
                        </button>
                    )}
                </div>
            </div>

            <div className="flex gap-2 pt-4">
                <Button type="submit" variant="primary" className="flex-1">
                    Save Receipt
                </Button>
                <Button type="button" variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
            </div>

            {showSplitManager && (
                <SplitManager
                    receipt={{
                        ...initialData,
                        total: parseFloat(watch('total')) || calculateTotal(),
                        currency: watch('currency') || defaultCurrency,
                        splitData: splitData
                    }}
                    onSave={(data) => {
                        setSplitData(data);
                        setShowSplitManager(false);
                    }}
                    onClose={() => setShowSplitManager(false)}
                />
            )}
        </form>
    );
}

