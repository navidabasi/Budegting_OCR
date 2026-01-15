import { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
} from 'chart.js';
import { format, startOfMonth, eachDayOfInterval, subDays } from 'date-fns';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { X } from 'lucide-react';
import CurrencyDisplay from '../common/CurrencyDisplay';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

export default function ExpenseChart({ receipts }) {
    const navigate = useNavigate();
    const selectedChartDate = useAppStore((state) => state.selectedChartDate);
    const selectedChartReceipts = useAppStore((state) => state.selectedChartReceipts);
    const setSelectedChartDate = useAppStore((state) => state.setSelectedChartDate);
    const clearSelectedChartDate = useAppStore((state) => state.clearSelectedChartDate);
    
    const [selectedDate, setSelectedDate] = useState(null);
    const [selectedDayReceipts, setSelectedDayReceipts] = useState([]);
    const [swipeStart, setSwipeStart] = useState(null);
    const [swipeCurrent, setSwipeCurrent] = useState(null);
    const [highlightedIndex, setHighlightedIndex] = useState(null);

    // Restore state from store on mount and when receipts change
    useEffect(() => {
        if (selectedChartDate && selectedChartReceipts.length > 0) {
            const date = new Date(selectedChartDate);
            // Verify receipts still exist in current receipts list and match the date
            const dateStr = format(date, 'yyyy-MM-dd');
            const validReceipts = receipts.filter(receipt => {
                const receiptDateStr = format(new Date(receipt.date), 'yyyy-MM-dd');
                return receiptDateStr === dateStr && 
                       selectedChartReceipts.some(r => r.id === receipt.id);
            });
            
            if (validReceipts.length > 0) {
                setSelectedDate(date);
                setSelectedDayReceipts(validReceipts);
                // Update store with valid receipts
                if (validReceipts.length !== selectedChartReceipts.length) {
                    setSelectedChartDate(date, validReceipts);
                }
            } else {
                // Clear if receipts no longer exist or don't match
                setSelectedDate(null);
                setSelectedDayReceipts([]);
                clearSelectedChartDate();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [receipts]); // Update when receipts change

    const last30Days = eachDayOfInterval({
        start: subDays(new Date(), 29),
        end: new Date()
    });

    const dailyExpenses = {};
    const dailyIncome = {};
    const dailyReceipts = {};
    
    last30Days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        dailyExpenses[dateStr] = 0;
        dailyIncome[dateStr] = 0;
        dailyReceipts[dateStr] = [];
    });

    receipts.forEach(receipt => {
        const dateStr = format(new Date(receipt.date), 'yyyy-MM-dd');
        if (dailyExpenses.hasOwnProperty(dateStr)) {
            const amount = parseFloat(receipt.total) || 0;
            const transactionType = receipt.transactionType || 'expense';
            if (transactionType === 'income') {
                dailyIncome[dateStr] += amount;
            } else {
                dailyExpenses[dateStr] += amount;
            }
            dailyReceipts[dateStr].push(receipt);
        }
    });

    const labels = last30Days.map(day => format(day, 'MMM dd'));
    const expenseData = Object.values(dailyExpenses);
    const incomeData = Object.values(dailyIncome);

    const handleChartClick = (event, elements) => {
        if (elements.length > 0) {
            const index = elements[0].index;
            const clickedDay = last30Days[index];
            const dateStr = format(clickedDay, 'yyyy-MM-dd');
            const dayReceipts = dailyReceipts[dateStr] || [];
            
            if (dayReceipts.length > 0) {
                setSelectedDate(clickedDay);
                setSelectedDayReceipts(dayReceipts);
                // Persist to store
                setSelectedChartDate(clickedDay, dayReceipts);
            }
        }
    };

    const handleClose = () => {
        setSelectedDate(null);
        setSelectedDayReceipts([]);
        clearSelectedChartDate();
    };

    const chartData = {
        labels,
        datasets: [
            {
                label: 'Daily Expenses',
                data: expenseData,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                tension: 0.4,
                fill: true
            },
            {
                label: 'Daily Income',
                data: incomeData,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true
            }
        ]
    };

    // Touch/swipe handlers for mobile
    const handleTouchStart = (e) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = e.currentTarget.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            setSwipeStart({ x, time: Date.now() });
        }
    };

    const handleTouchMove = (e) => {
        if (swipeStart && e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = e.currentTarget.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            setSwipeCurrent(x);
            
            // Calculate which data point is closest
            const chartWidth = rect.width;
            const pointIndex = Math.round((x / chartWidth) * (labels.length - 1));
            const clampedIndex = Math.max(0, Math.min(labels.length - 1, pointIndex));
            setHighlightedIndex(clampedIndex);
        }
    };

    const handleTouchEnd = (e) => {
        if (swipeStart && swipeCurrent !== null) {
            const rect = e.currentTarget.getBoundingClientRect();
            const chartWidth = rect.width;
            const pointIndex = Math.round((swipeCurrent / chartWidth) * (labels.length - 1));
            const clampedIndex = Math.max(0, Math.min(labels.length - 1, pointIndex));
            const clickedDay = last30Days[clampedIndex];
            const dateStr = format(clickedDay, 'yyyy-MM-dd');
            const dayReceipts = dailyReceipts[dateStr] || [];
            
            if (dayReceipts.length > 0) {
                setSelectedDate(clickedDay);
                setSelectedDayReceipts(dayReceipts);
                setSelectedChartDate(clickedDay, dayReceipts);
            }
        }
        setSwipeStart(null);
        setSwipeCurrent(null);
        setHighlightedIndex(null);
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        onClick: handleChartClick,
        interaction: {
            intersect: false,
            mode: 'index'
        },
        elements: {
            point: {
                radius: window.innerWidth < 768 ? 6 : 4, // Larger on mobile
                hoverRadius: window.innerWidth < 768 ? 10 : 6,
                hitRadius: window.innerWidth < 768 ? 20 : 10 // Much larger touch target on mobile
            }
        },
        layout: {
            padding: {
                left: 5,
                right: 5,
                top: 10,
                bottom: 20
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'top'
            },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        const label = context.dataset.label || '';
                        const value = context.parsed.y.toFixed(2);
                        return `${label}: $${value}`;
                    }
                }
            }
        },
        scales: {
            x: {
                ticks: {
                    maxRotation: 45,
                    minRotation: 45,
                    font: {
                        size: 8
                    },
                    maxTicksLimit: 10
                },
                grid: {
                    display: false
                },
                padding: {
                    bottom: 15
                }
            },
            y: {
                beginAtZero: true,
                ticks: {
                    callback: function (value) {
                        return '$' + value.toFixed(0);
                    },
                    font: {
                        size: 10
                    }
                }
            }
        }
    };

    // Add visual indicator for highlighted point
    const chartDataWithHighlight = {
        ...chartData,
        datasets: chartData.datasets.map((dataset, datasetIndex) => ({
            ...dataset,
            pointRadius: dataset.data.map((_, index) => 
                highlightedIndex === index ? (window.innerWidth < 768 ? 10 : 8) : (window.innerWidth < 768 ? 6 : 4)
            ),
            pointBackgroundColor: dataset.data.map((_, index) => 
                highlightedIndex === index ? '#00573f' : dataset.borderColor
            )
        }))
    };

    return (
        <div className="contents">
            <div className="card h-64 w-full overflow-hidden">
                <h3 className="text-base sm:text-lg font-semibold mb-2">Last 30 Days (Income & Expenses)</h3>
                <div 
                    className="h-52 -mx-2"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    <Line data={highlightedIndex !== null ? chartDataWithHighlight : chartData} options={options} />
                </div>
                {swipeCurrent !== null && highlightedIndex !== null && (
                    <div className="text-xs text-gray-500 mt-1 text-center">
                        {format(last30Days[highlightedIndex], 'MMM dd')}
                    </div>
                )}
            </div>
            
            {selectedDate && selectedDayReceipts.length > 0 && (
                <div className="card w-full mt-4 animate-slide-in col-span-1 lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h4 className="text-lg font-semibold text-gray-900">
                                {format(selectedDate, 'EEEE, MMMM dd, yyyy')}
                            </h4>
                            <p className="text-sm text-gray-500">
                                {selectedDayReceipts.length} receipt{selectedDayReceipts.length !== 1 ? 's' : ''}
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            className="text-gray-400 hover:text-gray-600"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                        {selectedDayReceipts.map(receipt => (
                            <div
                                key={receipt.id}
                                onClick={() => navigate(`/receipts/${receipt.id}`)}
                                className="flex flex-col p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1">
                                        <p className="font-medium text-gray-900">{receipt.merchant}</p>
                                        {receipt.category && (
                                            <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded" style={{ backgroundColor: '#e6f5f2', color: '#00573f' }}>
                                                {receipt.category}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <p className="font-semibold text-gray-900 mt-auto">
                                    <CurrencyDisplay amount={receipt.total} currency={receipt.currency} />
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

