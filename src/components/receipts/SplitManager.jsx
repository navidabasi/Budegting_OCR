import { useState, useEffect } from 'react';
import { X, Plus, Users, DollarSign } from 'lucide-react';
import Button from '../common/Button';
import Input from '../common/Input';
import { formatCurrency } from '../../utils/helpers';

export default function SplitManager({ receipt, onSave, onClose }) {
    const [method, setMethod] = useState('equal');
    const [people, setPeople] = useState(2);
    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        if (receipt) {
            setTotal(parseFloat(receipt.total) || 0);
            
            // Load existing split data if available
            if (receipt.splitData) {
                const splitMethod = receipt.splitData.method || 'equal';
                const splitPeople = receipt.splitData.people || 2;
                setMethod(splitMethod);
                setPeople(splitPeople);
                
                // If custom split, load existing users
                if (splitMethod === 'custom' && receipt.splitData.users && receipt.splitData.users.length > 0) {
                    setUsers(receipt.splitData.users.map(u => ({
                        name: u.name || '',
                        amount: parseFloat(u.amount) || 0,
                        percentage: parseFloat(u.percentage) || 0
                    })));
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
            setUsers([{ name: '', amount: 0, percentage: 0 }]);
        }
    }, [method]);

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
        setUsers([...users, { name: '', amount: 0, percentage: 0 }]);
    };

    const handleRemoveUser = (index) => {
        setUsers(users.filter((_, i) => i !== index));
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
                alert(`The split amounts (${formatCurrency(customTotal, receipt?.currency || 'EUR')}) don't match the total (${formatCurrency(total, receipt?.currency || 'EUR')}). Please adjust the amounts.`);
                return;
            }
            
            // Ensure all people have amounts
            if (users.length !== people) {
                alert(`Please add amounts for all ${people} people.`);
                return;
            }
        }

        const splitData = {
            method,
            people,
            users: method === 'equal' ? [] : users.map(u => ({
                name: u.name || `Person ${users.indexOf(u) + 1}`,
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
                    <h3 className="text-lg font-semibold">Split Receipt</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={20} />
                    </button>
                </div>

                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Total Amount</span>
                        <span className="text-lg font-bold">
                            {formatCurrency(total, receipt?.currency || 'EUR')}
                        </span>
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Split Method
                    </label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setMethod('equal')}
                            className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                                method === 'equal'
                                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                            }`}
                        >
                            Equal Split
                        </button>
                        <button
                            type="button"
                            onClick={() => setMethod('custom')}
                            className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                                method === 'custom'
                                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                            }`}
                        >
                            Custom Split
                        </button>
                    </div>
                </div>

                {method === 'equal' ? (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Number of People
                            </label>
                            <Input
                                type="number"
                                min="1"
                                value={people}
                                onChange={(e) => setPeople(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                        </div>

                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-green-900">Each Person Pays</span>
                                <span className="text-lg font-bold text-green-700">
                                    {formatCurrency(equalAmount, receipt?.currency || 'EUR')}
                                </span>
                            </div>
                            <div className="text-xs text-green-700">
                                {people} person{people !== 1 ? 's' : ''} × {formatCurrency(equalAmount, receipt?.currency || 'EUR')} = {formatCurrency(total, receipt?.currency || 'EUR')}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Total Number of People
                            </label>
                            <Input
                                type="number"
                                min="1"
                                value={people}
                                onChange={(e) => setPeople(Math.max(users.length, parseInt(e.target.value) || 1))}
                            />
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-gray-700">
                                    Custom Amounts ({users.length} / {people})
                                </label>
                                {users.length < people && (
                                    <button
                                        type="button"
                                        onClick={handleAddUser}
                                        className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                                    >
                                        <Plus size={16} />
                                        Add Person
                                    </button>
                                )}
                            </div>

                            <div className="space-y-2">
                                {users.map((user, index) => (
                                    <div key={index} className="flex gap-2 items-center p-2 border border-gray-200 rounded">
                                        <Input
                                            placeholder="Name (optional)"
                                            value={user.name || ''}
                                            onChange={(e) => handleUserChange(index, 'name', e.target.value)}
                                            className="flex-1"
                                        />
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max={total}
                                            placeholder="Amount"
                                            value={user.amount > 0 ? user.amount : ''}
                                            onChange={(e) => handleUserChange(index, 'amount', e.target.value)}
                                            className="w-32"
                                        />
                                        <div className="w-20 text-sm text-gray-600 text-right">
                                            {user.percentage > 0 ? `${user.percentage.toFixed(1)}%` : '-'}
                                        </div>
                                        {users.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveUser(index)}
                                                className="text-red-500 hover:text-red-700"
                                            >
                                                <X size={18} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {users.length < people && (
                                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-medium text-blue-900">Remaining to Split</span>
                                        <span className="text-sm font-bold text-blue-700">
                                            {formatCurrency(remaining, receipt?.currency || 'EUR')}
                                        </span>
                                    </div>
                                    <div className="text-xs text-blue-700">
                                        {people - users.length} person{people - users.length !== 1 ? 's' : ''} × {formatCurrency(remainingPerPerson, receipt?.currency || 'EUR')} = {formatCurrency(remaining, receipt?.currency || 'EUR')}
                                    </div>
                                </div>
                            )}

                            {users.length === people && (
                                <div className={`mt-3 p-3 rounded-lg ${
                                    Math.abs(remaining) < 0.01 
                                        ? 'bg-green-50 border border-green-200' 
                                        : 'bg-red-50 border border-red-200'
                                }`}>
                                    <div className={`text-sm font-medium ${
                                        Math.abs(remaining) < 0.01 ? 'text-green-700' : 'text-red-700'
                                    }`}>
                                        {Math.abs(remaining) < 0.01 
                                            ? '✓ Split is balanced' 
                                            : `⚠ Remaining: ${formatCurrency(Math.abs(remaining), receipt?.currency || 'EUR')}. Please adjust amounts to match the total.`}
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
                        Save Split
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        </div>
    );
}

