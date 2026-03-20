import { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import Button from '../common/Button';
import Input from '../common/Input';
import { formatCurrency } from '../../utils/helpers';
import { useTranslation } from '../../languages/useTranslation';
import { useAppStore } from '../../store/appStore';

export default function SplitManager({ receipt, onSave, onClose }) {
    const { t } = useTranslation();
    const showToast = useAppStore((state) => state.showToast);
    const [method, setMethod] = useState('equal');
    const [people, setPeople] = useState(2);
    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        if (receipt) {
            const receiptTotal = parseFloat(receipt.total) || 0;
            setTotal(receiptTotal);
            
            // Load existing split data if available
            if (receipt.splitData) {
                const splitMethod = receipt.splitData.method || 'equal';
                const splitPeople = receipt.splitData.people || 2;
                setMethod(splitMethod);
                setPeople(splitPeople);
                
                // If custom split, load existing users
                if (splitMethod === 'custom' && receipt.splitData.users && receipt.splitData.users.length > 0) {
                    const loadedUsers = receipt.splitData.users.map(u => ({
                        name: u.name || '',
                        amount: parseFloat(u.amount) || 0,
                        percentage: parseFloat(u.percentage) || 0
                    }));
                    setUsers(loadedUsers);
                    
                    // If we have fewer users than people, add empty ones with calculated amounts
                    if (loadedUsers.length < splitPeople) {
                        const customTotal = loadedUsers.reduce((sum, u) => sum + (parseFloat(u.amount) || 0), 0);
                        const remaining = receiptTotal - customTotal;
                        const remainingPeople = splitPeople - loadedUsers.length;
                        
                        if (remainingPeople > 0 && remaining > 0) {
                            const perPerson = remaining / remainingPeople;
                            const newUsers = [...loadedUsers];
                            for (let i = 0; i < remainingPeople; i++) {
                                newUsers.push({
                                    name: '',
                                    amount: perPerson,
                                    percentage: receiptTotal > 0 ? (perPerson / receiptTotal) * 100 : 0
                                });
                            }
                            setUsers(newUsers);
                        }
                    }
                } else {
                    setUsers([]);
                }
            } else {
                // Initialize with default
                setMethod('equal');
                setPeople(2);
                setUsers([]);
            }
        }
    }, [receipt]);

    useEffect(() => {
        // Only reset users if switching from custom to equal, not when loading existing data
        if (method === 'equal' && users.length > 0) {
            setUsers([]);
        } else if (method === 'custom' && users.length === 0 && (!receipt?.splitData || receipt.splitData.method !== 'custom')) {
            // Only initialize empty users if we're not loading existing custom split data
            // Distribute total equally among all people
            const perPerson = total / people;
            const initialUsers = [];
            for (let i = 0; i < people; i++) {
                initialUsers.push({
                    name: i === 0 ? 'You' : '',
                    amount: perPerson,
                    percentage: total > 0 ? (perPerson / total) * 100 : 0
                });
            }
            setUsers(initialUsers);
        }
    }, [method, people, receipt?.splitData, total, users.length]);

    // Auto-adjust users when people count changes in custom mode
    useEffect(() => {
        if (method === 'custom' && people > 0) {
            // If we have fewer users than people, add empty ones
            if (users.length < people) {
                const newUsers = [...users];
                while (newUsers.length < people) {
                    newUsers.push({ name: '', amount: 0, percentage: 0 });
                }
                // Recalculate remaining amounts
                const customTotal = newUsers.reduce((sum, u) => sum + (parseFloat(u.amount) || 0), 0);
                const remaining = total - customTotal;
                const remainingPeople = people - newUsers.filter(u => (parseFloat(u.amount) || 0) > 0).length;
                
                if (remainingPeople > 0 && remaining > 0) {
                    const perPerson = remaining / remainingPeople;
                    newUsers.forEach((user, idx) => {
                        if ((parseFloat(user.amount) || 0) === 0) {
                            user.amount = perPerson;
                            user.percentage = total > 0 ? (perPerson / total) * 100 : 0;
                        }
                    });
                }
                setUsers(newUsers);
            } else if (users.length > people) {
                // Remove excess users
                setUsers(users.slice(0, people));
            }
        }
    }, [people, method]);

    const calculateEqualSplit = () => {
        if (people <= 0) return 0;
        return total / people;
    };

    const calculateRemaining = () => {
        const customTotal = users.reduce((sum, u) => sum + (parseFloat(u.amount) || 0), 0);
        return total - customTotal;
    };

    const calculateRemainingPerPerson = () => {
        const remaining = calculateRemaining();
        const remainingPeople = people - users.length;
        if (remainingPeople <= 0) return 0;
        return remaining / remainingPeople;
    };

    const handleAddUser = () => {
        // Calculate remaining amount and distribute it to the new user
        const customTotal = users.reduce((sum, u) => sum + (parseFloat(u.amount) || 0), 0);
        const remaining = total - customTotal;
        const remainingPeople = people - users.length;
        
        let newAmount = 0;
        if (remainingPeople > 0 && remaining > 0) {
            // Distribute remaining equally among remaining people (including the new one)
            newAmount = remaining / remainingPeople;
        }
        
        setUsers([...users, { name: '', amount: newAmount, percentage: total > 0 ? (newAmount / total) * 100 : 0 }]);
    };

    const handleUserChange = (index, field, value) => {
        const updated = [...users];
        updated[index] = { ...updated[index], [field]: value };
        
        // If amount changed, recalculate percentage and auto-distribute remaining
        if (field === 'amount') {
            const amount = parseFloat(value) || 0;
            updated[index].amount = amount;
            updated[index].percentage = total > 0 ? (amount / total) * 100 : 0;
            
            // Auto-calculate remaining amounts for other users
            const customTotal = updated.reduce((sum, u, idx) => {
                if (idx === index) return sum + amount;
                return sum + (parseFloat(u.amount) || 0);
            }, 0);
            const remaining = total - customTotal;
            const remainingPeople = people - updated.length;
            
            // Distribute remaining equally among other users (excluding the one being edited)
            if (remainingPeople > 0 && remaining > 0) {
                const perPerson = remaining / remainingPeople;
                updated.forEach((user, idx) => {
                    if (idx !== index) {
                        user.amount = perPerson;
                        user.percentage = total > 0 ? (perPerson / total) * 100 : 0;
                    }
                });
            }
        }
        
        setUsers(updated);
    };

    const handleSave = () => {
        // Validate custom split - ensure total matches
        if (method === 'custom') {
            const customTotal = users.reduce((sum, u) => sum + (parseFloat(u.amount) || 0), 0);
            const difference = Math.abs(total - customTotal);
            
            if (difference > 0.01) { // Allow small rounding differences
                showToast(
                    t('receipts.split.splitTotalMismatch', {
                        customTotal: formatCurrency(customTotal, receipt?.currency || 'EUR'),
                        total: formatCurrency(total, receipt?.currency || 'EUR'),
                    }),
                    'error'
                );
                return;
            }
            
            // Ensure all people have amounts
            if (users.length !== people) {
                showToast(
                    t('receipts.split.splitPeopleMissing', { people }),
                    'error'
                );
                return;
            }
        }

        // Calculate user's share (yourShare)
        let yourShare;
        if (method === 'equal') {
            yourShare = total / people;
        } else {
            // For custom split, first user is always "You"
            yourShare = users.length > 0 ? (parseFloat(users[0].amount) || 0) : (total / people);
        }

        const splitData = {
            method,
            people,
            yourShare, // The user's portion for calculations
            users: method === 'equal' ? [] : users.map((u, idx) => ({
                name: u.name || (idx === 0 ? 'You' : `Person ${idx + 1}`),
                amount: parseFloat(u.amount) || 0,
                percentage: u.percentage || 0
            }))
        };

        onSave(splitData);
    };

    const equalAmount = calculateEqualSplit();
    const remaining = calculateRemaining();
    const remainingPerPerson = calculateRemainingPerPerson();

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold dark:text-white">{t('receipts.split.title')}</h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 dark:text-gray-300">{t('receipts.form.total')}</span>
                        <span className="text-lg font-bold dark:text-white">
                            {formatCurrency(total, receipt?.currency || 'EUR')}
                        </span>
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-white mb-2">
                        {t('receipts.split.method')}
                    </label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setMethod('equal')}
                            className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                                method === 'equal'
                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                            }`}
                        >
                            {t('receipts.split.equal')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setMethod('custom')}
                            className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                                method === 'custom'
                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                            }`}
                        >
                            {t('receipts.split.custom')}
                        </button>
                    </div>
                </div>

                {method === 'equal' ? (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                                {t('receipts.split.people')}
                            </label>
                            <Input
                                type="number"
                                min="1"
                                value={people}
                                onChange={(e) => setPeople(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                        </div>

                        <div className="p-4 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-green-900 dark:text-green-200">{t('receipts.split.eachPersonPays')}</span>
                                <span className="text-lg font-bold text-green-700 dark:text-green-300">
                                    {formatCurrency(equalAmount, receipt?.currency || 'EUR')}
                                </span>
                            </div>
                            <div className="text-xs text-green-700 dark:text-green-300">
                                {t('receipts.split.equalSummary', {
                                    people,
                                    suffix: people !== 1 ? 's' : '',
                                    amount: formatCurrency(equalAmount, receipt?.currency || 'EUR'),
                                    total: formatCurrency(total, receipt?.currency || 'EUR'),
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
                                {t('receipts.split.people')}
                            </label>
                            <Input
                                type="number"
                                min="1"
                                value={people}
                                onChange={(e) => {
                                    const newPeople = Math.max(1, parseInt(e.target.value) || 1);
                                    setPeople(newPeople);
                                    // If reducing people count, remove excess users
                                    if (newPeople < users.length) {
                                        setUsers(users.slice(0, newPeople));
                                    }
                                }}
                            />
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-white">
                                    {t('receipts.split.customAmounts', { current: users.length, total: people })}
                                </label>
                                {users.length < people && (
                                    <button
                                        type="button"
                                        onClick={handleAddUser}
                                        className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center gap-1"
                                    >
                                        <Plus size={16} />
                                        {t('receipts.split.addPerson')}
                                    </button>
                                )}
                            </div>

                            <div className="space-y-2">
                                {users.map((user, index) => (
                                    <div key={index} className="flex gap-2 items-center p-2 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800">
                                        <Input
                                            placeholder={t('receipts.split.nameOptional')}
                                            value={user.name || ''}
                                            onChange={(e) => handleUserChange(index, 'name', e.target.value)}
                                            className="flex-1"
                                        />
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max={total}
                                            placeholder={t('receipts.form.price')}
                                            value={user.amount > 0 ? user.amount.toString() : ''}
                                            onChange={(e) => handleUserChange(index, 'amount', e.target.value)}
                                            className="w-32"
                                        />
                                        <div className="w-20 text-sm text-gray-600 dark:text-gray-300 text-right">
                                            {user.percentage > 0 ? `${user.percentage.toFixed(1)}%` : '-'}
                                        </div>
                                        {users.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const updated = users.filter((_, i) => i !== index);
                                                    // Recalculate remaining amounts
                                                    const customTotal = updated.reduce((sum, u) => sum + (parseFloat(u.amount) || 0), 0);
                                                    const remaining = total - customTotal;
                                                    const remainingPeople = people - updated.length;
                                                    
                                                    if (remainingPeople > 0 && remaining > 0) {
                                                        const perPerson = remaining / remainingPeople;
                                                        updated.forEach((u) => {
                                                            if ((parseFloat(u.amount) || 0) === 0) {
                                                                u.amount = perPerson;
                                                                u.percentage = total > 0 ? (perPerson / total) * 100 : 0;
                                                            }
                                                        });
                                                    }
                                                    setUsers(updated);
                                                }}
                                                className="text-red-500 hover:text-red-700"
                                            >
                                                <X size={18} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {users.length < people && (
                                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-medium text-blue-900 dark:text-blue-200">{t('receipts.split.remainingToSplit')}</span>
                                        <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                                            {formatCurrency(remaining, receipt?.currency || 'EUR')}
                                        </span>
                                    </div>
                                    <div className="text-xs text-blue-700 dark:text-blue-300">
                                        {t('receipts.split.remainingSummary', {
                                            people: people - users.length,
                                            suffix: people - users.length !== 1 ? 's' : '',
                                            amount: formatCurrency(remainingPerPerson, receipt?.currency || 'EUR'),
                                            total: formatCurrency(remaining, receipt?.currency || 'EUR'),
                                        })}
                                    </div>
                                </div>
                            )}

                            {users.length === people && (
                                <div className={`mt-3 p-3 rounded-lg ${
                                    Math.abs(remaining) < 0.01 
                                        ? 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700' 
                                        : 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700'
                                }`}>
                                    <div className={`text-sm font-medium ${
                                        Math.abs(remaining) < 0.01 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                                    }`}>
                                        {Math.abs(remaining) < 0.01 
                                            ? t('receipts.split.exactMatch')
                                            : t('receipts.split.remaining', {
                                                remaining: formatCurrency(Math.abs(remaining), receipt?.currency || 'EUR'),
                                            })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex gap-2 mt-6 pt-4 border-t">
                    <Button
                        variant="primary"
                        onClick={handleSave}
                        className="flex-1"
                    >
                        {t('common.actions.save')}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={onClose}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
