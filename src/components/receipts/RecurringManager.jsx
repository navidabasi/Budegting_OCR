import { useState, useEffect } from 'react';
import { RefreshCw, Calendar, Bell } from 'lucide-react';
import { calculateNextRecurringDate } from '../../utils/recurring';

const FREQUENCY_OPTIONS = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Every 2 Weeks' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' }
];

export default function RecurringManager({ recurringData, onChange, receiptDate }) {
    const [isRecurring, setIsRecurring] = useState(!!recurringData?.isActive);
    const [frequency, setFrequency] = useState(recurringData?.frequency || 'monthly');
    const [nextDueDate, setNextDueDate] = useState(recurringData?.nextDueDate || '');
    const [endDate, setEndDate] = useState(recurringData?.endDate || '');
    const [reminderDays, setReminderDays] = useState(recurringData?.reminderDays ?? 3);

    useEffect(() => {
        const active = !!recurringData?.isActive;
        setIsRecurring(active);
        setFrequency(recurringData?.frequency || 'monthly');
        setNextDueDate(recurringData?.nextDueDate || '');
        setEndDate(recurringData?.endDate || '');
        setReminderDays(recurringData?.reminderDays ?? 3);
    }, [recurringData]);

    // Calculate default next due date based on receipt date and frequency
    useEffect(() => {
        if (isRecurring && !nextDueDate && receiptDate) {
            calculateNextDate(receiptDate, frequency);
        }
    }, [isRecurring, receiptDate, frequency]);

    const calculateNextDate = (fromDate, freq) => {
        const formattedDate = calculateNextRecurringDate(fromDate, freq);
        setNextDueDate(formattedDate);
        return formattedDate;
    };

    const buildData = (overrides = {}) => ({
        isActive: true,
        frequency,
        nextDueDate,
        endDate: endDate || null,
        reminderDays,
        ...overrides,
    });

    const handleToggle = () => {
        const newIsRecurring = !isRecurring;
        setIsRecurring(newIsRecurring);

        if (newIsRecurring) {
            const calculatedNextDate = nextDueDate || calculateNextDate(receiptDate || new Date(), frequency);
            onChange(buildData({ nextDueDate: calculatedNextDate }));
        } else {
            onChange(null);
        }
    };

    const handleFrequencyChange = (newFrequency) => {
        setFrequency(newFrequency);
        const newNextDate = calculateNextDate(receiptDate || new Date(), newFrequency);
        onChange(buildData({ frequency: newFrequency, nextDueDate: newNextDate }));
    };

    const handleDateChange = (newDate) => {
        setNextDueDate(newDate);
        onChange(buildData({ nextDueDate: newDate }));
    };

    const handleEndDateChange = (newEndDate) => {
        setEndDate(newEndDate);
        onChange(buildData({ endDate: newEndDate || null }));
    };

    const handleReminderChange = (days) => {
        setReminderDays(days);
        onChange(buildData({ reminderDays: days }));
    };

    const inputClass = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500";

    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <RefreshCw size={18} className={isRecurring ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'} />
                    <span className="font-medium text-gray-700 dark:text-gray-200">Recurring Payment</span>
                </div>
                <button
                    type="button"
                    onClick={handleToggle}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${isRecurring ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                    role="switch"
                    aria-checked={isRecurring}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isRecurring ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                </button>
            </div>

            {isRecurring && (
                <div className="space-y-3 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Frequency
                        </label>
                        <select
                            value={frequency}
                            onChange={(e) => handleFrequencyChange(e.target.value)}
                            className={inputClass}
                        >
                            {FREQUENCY_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="input-wrapper">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                <Calendar size={14} className="inline mr-1" />
                                Next Due Date
                            </label>
                            <input
                                type="date"
                                value={nextDueDate}
                                onChange={(e) => handleDateChange(e.target.value)}
                                className={inputClass}
                            />
                        </div>
                        <div className="input-wrapper">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                <Calendar size={14} className="inline mr-1" />
                                End Date
                                <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(optional)</span>
                            </label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => handleEndDateChange(e.target.value)}
                                className={inputClass}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            <Bell size={14} className="inline mr-1" />
                            Remind me (days before)
                        </label>
                        <select
                            value={reminderDays}
                            onChange={(e) => handleReminderChange(parseInt(e.target.value))}
                            className={inputClass}
                        >
                            <option value={0}>On due date</option>
                            <option value={1}>1 day before</option>
                            <option value={3}>3 days before</option>
                            <option value={7}>1 week before</option>
                        </select>
                    </div>
                </div>
            )}
        </div>
    );
}
