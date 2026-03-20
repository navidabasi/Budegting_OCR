import { useState, useEffect, useMemo } from 'react';
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
import { eachDayOfInterval, subDays } from 'date-fns';
import { formatCurrency, getDateKey, getEffectiveAmount } from '../../utils/helpers';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import CurrencyDisplay from '../common/CurrencyDisplay';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { shouldIncludeInFinancialTotals } from '../../utils/tracking';
import { useTranslation } from '../../languages/useTranslation';

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
    const { t, languageCode, localizeCategory } = useTranslation();
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
    const [isTouchDevice, setIsTouchDevice] = useState(false);
    const [navIndex, setNavIndex] = useState(null);
    const [showMobileNav, setShowMobileNav] = useState(false);
    const [navTimeout, setNavTimeout] = useState(null);
    const financialReceipts = useMemo(
        () => receipts.filter(shouldIncludeInFinancialTotals),
        [receipts]
    );

    // Restore state from store on mount and when receipts change
    useEffect(() => {
        if (selectedChartDate && selectedChartReceipts.length > 0) {
            const date = new Date(selectedChartDate);
            // Verify receipts still exist in current receipts list and match the date
            const dateStr = getDateKey(date);
            const validReceipts = financialReceipts.filter(receipt => {
                const receiptDateStr = getDateKey(receipt.date);
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
    }, [financialReceipts]); // Update when receipts change

    // Detect touch device
    useEffect(() => {
        const checkTouchDevice = () => {
            const isTouchCapable = 'ontouchstart' in window ||
                navigator.maxTouchPoints > 0 ||
                window.matchMedia('(pointer: coarse)').matches;
            const isSmallScreen = window.innerWidth < 768;
            setIsTouchDevice(isTouchCapable && isSmallScreen);
        };

        checkTouchDevice();
        window.addEventListener('resize', checkTouchDevice);
        return () => window.removeEventListener('resize', checkTouchDevice);
    }, []);

    const last30Days = eachDayOfInterval({
        start: subDays(new Date(), 29),
        end: new Date()
    });

    const dailyExpenses = {};
    const dailyIncome = {};
    const dailyReceipts = {};
    
    last30Days.forEach(day => {
        const dateStr = getDateKey(day);
        dailyExpenses[dateStr] = 0;
        dailyIncome[dateStr] = 0;
        dailyReceipts[dateStr] = [];
    });

    financialReceipts.forEach(receipt => {
        const dateStr = getDateKey(receipt.date);
        if (!dateStr) return;
        if (dailyExpenses.hasOwnProperty(dateStr)) {
            // Use effective amount (user's share if split)
            const amount = getEffectiveAmount(receipt);
            const transactionType = receipt.transactionType || 'expense';
            if (transactionType === 'income') {
                dailyIncome[dateStr] += amount;
            } else {
                dailyExpenses[dateStr] += amount;
            }
            dailyReceipts[dateStr].push(receipt);
        }
    });

    const labels = last30Days.map((day) =>
        day.toLocaleDateString(languageCode || 'en-US', { month: 'short', day: '2-digit' })
    );
    const expenseData = Object.values(dailyExpenses);
    const incomeData = Object.values(dailyIncome);

    // Get indices of days with data (receipts)
    const daysWithDataIndices = last30Days
        .map((day, index) => {
            const dateStr = getDateKey(day);
            return dailyReceipts[dateStr]?.length > 0 ? index : null;
        })
        .filter(index => index !== null);

    // Show mobile nav with auto-hide after 4 seconds
    const showMobileNavWithTimeout = () => {
        setShowMobileNav(true);
        if (navTimeout) {
            clearTimeout(navTimeout);
        }
        const timeout = setTimeout(() => {
            setShowMobileNav(false);
        }, 4000);
        setNavTimeout(timeout);
    };

    // Navigation functions for mobile arrows
    const handleNavPrevious = () => {
        if (daysWithDataIndices.length === 0) return;
        showMobileNavWithTimeout(); // Keep nav visible when using it

        let newIndex;
        if (navIndex === null) {
            // Start from the last day with data
            newIndex = daysWithDataIndices[daysWithDataIndices.length - 1];
        } else {
            // Find the previous day with data
            const currentPos = daysWithDataIndices.indexOf(navIndex);
            if (currentPos > 0) {
                newIndex = daysWithDataIndices[currentPos - 1];
            } else {
                // Wrap to the end
                newIndex = daysWithDataIndices[daysWithDataIndices.length - 1];
            }
        }

        setNavIndex(newIndex);
        selectDayByIndex(newIndex);
    };

    const handleNavNext = () => {
        if (daysWithDataIndices.length === 0) return;
        showMobileNavWithTimeout(); // Keep nav visible when using it

        let newIndex;
        if (navIndex === null) {
            // Start from the first day with data
            newIndex = daysWithDataIndices[0];
        } else {
            // Find the next day with data
            const currentPos = daysWithDataIndices.indexOf(navIndex);
            if (currentPos < daysWithDataIndices.length - 1) {
                newIndex = daysWithDataIndices[currentPos + 1];
            } else {
                // Wrap to the beginning
                newIndex = daysWithDataIndices[0];
            }
        }

        setNavIndex(newIndex);
        selectDayByIndex(newIndex);
    };

    const selectDayByIndex = (index) => {
        const day = last30Days[index];
        const dateStr = getDateKey(day);
        const dayReceipts = dailyReceipts[dateStr] || [];

        if (dayReceipts.length > 0) {
            setSelectedDate(day);
            setSelectedDayReceipts(dayReceipts);
            setSelectedChartDate(day, dayReceipts);
        }
    };

    const handleChartClick = (event, elements) => {
        if (elements.length > 0) {
            const index = elements[0].index;
            const clickedDay = last30Days[index];
            const dateStr = getDateKey(clickedDay);
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
        setNavIndex(null);
        clearSelectedChartDate();
    };

    // Calculate point radius: 0 for zero values, normal size for non-zero
    const basePointRadius = window.innerWidth < 768 ? 6 : 4;
    const expensePointRadius = expenseData.map(value => value > 0 ? basePointRadius : 0);
    const incomePointRadius = incomeData.map(value => value > 0 ? basePointRadius : 0);

    const chartData = {
        labels,
        datasets: [
            {
                label: t('dashboard.expenseChart.dailyExpenses'),
                data: expenseData,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: expensePointRadius,
                pointHoverRadius: expenseData.map(value => value > 0 ? (window.innerWidth < 768 ? 10 : 6) : 0)
            },
            {
                label: t('dashboard.expenseChart.dailyIncome'),
                data: incomeData,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: incomePointRadius,
                pointHoverRadius: incomeData.map(value => value > 0 ? (window.innerWidth < 768 ? 10 : 6) : 0)
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
            // Show mobile nav when user touches the chart
            if (isTouchDevice && daysWithDataIndices.length > 0) {
                showMobileNavWithTimeout();
            }
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
            const dateStr = getDateKey(clickedDay);
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
                bottom: 30
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: {
                    usePointStyle: true,
                    boxWidth: 12,
                    boxHeight: 12,
                    padding: 10,
                    font: {
                        size: 12
                    },
                    color: document.documentElement.classList.contains('dark') 
                        ? '#ffffff' 
                        : '#374151'
                }
            },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        const label = context.dataset.label || '';
                        const value = context.parsed.y;
                        return `${label}: ${formatCurrency(value)}`;
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
                    maxTicksLimit: 10,
                    color: document.documentElement.classList.contains('dark') 
                        ? '#ffffff' 
                        : '#374151'
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
                        return formatCurrency(value);
                    },
                    font: {
                        size: 10
                    },
                    color: document.documentElement.classList.contains('dark') 
                        ? '#ffffff' 
                        : '#374151'
                }
            }
        }
    };

    // Add visual indicator for highlighted point
    const chartDataWithHighlight = {
        ...chartData,
        datasets: chartData.datasets.map((dataset, datasetIndex) => {
            const data = dataset.data;
            return {
                ...dataset,
                pointRadius: data.map((value, index) => {
                    if (value === 0) return 0; // No point for zero values
                    return highlightedIndex === index 
                        ? (window.innerWidth < 768 ? 10 : 8) 
                        : (window.innerWidth < 768 ? 6 : 4);
                }),
                pointBackgroundColor: data.map((value, index) => {
                    if (value === 0) return dataset.borderColor; // Won't be visible anyway
                    return highlightedIndex === index ? '#00573f' : dataset.borderColor;
                })
            };
        })
    };

    return (
        <div className="contents">
            <div className="card h-80 w-full overflow-hidden">
                <h3 className="text-base sm:text-lg font-semibold mb-2 dark:text-white">{t('dashboard.expenseChart.title')}</h3>

                {/* Mobile Navigation Bar - only shows on interaction */}
                {isTouchDevice && daysWithDataIndices.length > 0 && (
                    <div className={`flex items-center justify-between bg-gray-200 dark:bg-gray-700 rounded-lg px-3 py-2 mb-2 transition-all duration-300 ${showMobileNav ? 'opacity-100 max-h-12' : 'opacity-0 max-h-0 overflow-hidden py-0 mb-0'}`}>
                        <button
                            onClick={handleNavPrevious}
                            className="flex items-center gap-1 text-gray-700 dark:text-white hover:text-gray-500 dark:hover:text-gray-300 active:text-gray-400 p-1"
                            aria-label={t('dashboard.expenseChart.previousDataDay')}
                        >
                            <ChevronLeft size={24} />
                            <span className="text-sm">{t('common.actions.previous')}</span>
                        </button>

                        <div className="text-gray-900 dark:text-white text-sm font-medium">
                            {navIndex !== null ? (
                                <span>
                                    {last30Days[navIndex].toLocaleDateString(languageCode || 'en-US', {
                                        month: 'short',
                                        day: '2-digit',
                                        year: 'numeric',
                                    })}
                                </span>
                            ) : (
                                <span className="text-gray-500 dark:text-gray-300">{t('dashboard.expenseChart.tapToBrowse')}</span>
                            )}
                        </div>

                        <button
                            onClick={handleNavNext}
                            className="flex items-center gap-1 text-gray-700 dark:text-white hover:text-gray-500 dark:hover:text-gray-300 active:text-gray-400 p-1"
                            aria-label={t('dashboard.expenseChart.nextDataDay')}
                        >
                            <span className="text-sm">{t('common.actions.next')}</span>
                            <ChevronRight size={24} />
                        </button>
                    </div>
                )}

                <div
                    className="h-60 -mx-2"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    <Line data={highlightedIndex !== null ? chartDataWithHighlight : chartData} options={options} />
                </div>
                {swipeCurrent !== null && highlightedIndex !== null && (
                    <div className="text-xs text-gray-500 dark:text-gray-300 mt-1 text-center">
                        {last30Days[highlightedIndex].toLocaleDateString(languageCode || 'en-US', {
                            month: 'short',
                            day: '2-digit',
                        })}
                    </div>
                )}
            </div>
            
            {selectedDate && selectedDayReceipts.length > 0 && (
                <div className="card w-full mt-4 animate-slide-in col-span-1 lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                                {selectedDate.toLocaleDateString(languageCode || 'en-US', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: '2-digit',
                                    year: 'numeric',
                                })}
                            </h4>
                            <p className="text-sm text-gray-500 dark:text-gray-300">
                                {t('dashboard.expenseChart.receiptCount', {
                                    count: selectedDayReceipts.length,
                                    suffix: selectedDayReceipts.length !== 1 ? 's' : '',
                                })}
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            className="text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-100"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                        {selectedDayReceipts.map(receipt => {
                            const isIncome = receipt.transactionType === 'income';
                            return (
                                <div
                                    key={receipt.id}
                                    className={`p-3 border rounded-lg cursor-pointer hover:shadow-md transition-shadow ${
                                        isIncome
                                            ? 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-700'
                                            : 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-700'
                                    }`}
                                    onClick={() => navigate(`/receipts/${receipt.id}`)}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-medium text-gray-900 dark:text-white">
                                            {receipt.merchant || t('dashboard.topMerchants.unknown')}
                                        </span>
                                        <span className={`font-bold ${
                                            isIncome ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                                        }`}>
                                            <CurrencyDisplay amount={receipt.total} currency={receipt.currency} />
                                        </span>
                                    </div>
                                    {receipt.category && (
                                        <span className="text-xs text-gray-600 dark:text-gray-400">{localizeCategory(receipt.category)}</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
