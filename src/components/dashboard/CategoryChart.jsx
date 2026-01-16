import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pie } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend
} from 'chart.js';
import { formatCurrency } from '../../utils/helpers';

ChartJS.register(ArcElement, Tooltip, Legend);

export default function CategoryChart({ receipts }) {
    const navigate = useNavigate();
    const [hiddenCategories, setHiddenCategories] = useState(new Set());

    const categoryTotals = {};
    const categoryIncome = {};

    receipts.forEach(receipt => {
        const category = receipt.category || 'Other';
        const amount = parseFloat(receipt.total) || 0;
        const transactionType = receipt.transactionType || 'expense';
        
        if (transactionType === 'income') {
            categoryIncome[category] = (categoryIncome[category] || 0) + amount;
        } else {
            categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        }
    });

    const allCategories = Object.keys(categoryTotals);
    const allTotals = Object.values(categoryTotals);

    // Filter out hidden categories
    const visibleCategories = allCategories.filter(cat => !hiddenCategories.has(cat));
    const visibleTotals = visibleCategories.map(cat => categoryTotals[cat]);

    // Calculate totals
    const visibleTotal = visibleTotals.reduce((sum, val) => sum + val, 0);
    const hiddenTotal = allCategories
        .filter(cat => hiddenCategories.has(cat))
        .reduce((sum, cat) => sum + categoryTotals[cat], 0);

    const categories = visibleCategories;
    const totals = visibleTotals;

    const colors = [
        '#00573f', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
    ];

    // Map original category indices to colors
    const getCategoryColor = (category) => {
        const originalIndex = allCategories.indexOf(category);
        return colors[originalIndex % colors.length];
    };

    const data = {
        labels: categories,
        datasets: [
            {
                data: totals,
                backgroundColor: categories.map(cat => getCategoryColor(cat)),
                borderWidth: 2,
                borderColor: '#ffffff'
            }
        ]
    };

    const handleCategoryToggle = (category) => {
        const newHidden = new Set(hiddenCategories);
        if (newHidden.has(category)) {
            newHidden.delete(category);
        } else {
            newHidden.add(category);
        }
        setHiddenCategories(newHidden);
    };

    // Create a map of category to its index in allCategories for legend
    const categoryIndexMap = {};
    allCategories.forEach((cat, idx) => {
        categoryIndexMap[cat] = idx;
    });

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: {
                bottom: 10,
                top: 10,
                left: 10,
                right: 10
            }
        },
        onClick: (event, elements) => {
            if (elements.length > 0) {
                const index = elements[0].index;
                const category = categories[index];
                // Toggle category visibility on click
                handleCategoryToggle(category);
            }
        },
        plugins: {
            legend: {
                position: 'left',
                onClick: (e, legendItem) => {
                    // Find the category by label text
                    const labelText = legendItem.text;
                    const category = allCategories.find(cat => cat === labelText);
                    if (category) {
                        handleCategoryToggle(category);
                    }
                },
                onHover: (e, legendItem) => {
                    if (e.native && e.native.target) {
                        e.native.target.style.cursor = 'pointer';
                    }
                },
                labels: {
                    padding: 12,
                    usePointStyle: true,
                    boxWidth: 10,
                    font: {
                        size: 13
                    },
                    generateLabels: (chart) => {
                        // Generate labels for ALL categories, not just visible ones
                        return allCategories.map((category) => {
                            const isHidden = hiddenCategories.has(category);
                            const categoryTotal = categoryTotals[category] || 0;
                            const total = allTotals.reduce((sum, val) => sum + val, 0);
                            const percentage = total > 0 ? ((categoryTotal / total) * 100).toFixed(1) : 0;

                            return {
                                text: category,
                                fillStyle: isHidden ? '#d1d5db' : getCategoryColor(category),
                                hidden: false, // Always show in legend
                                index: categoryIndexMap[category],
                                fontColor: isHidden ? '#9ca3af' : '#374151',
                                fontStyle: isHidden ? 'line-through' : 'normal',
                                strokeStyle: isHidden ? '#d1d5db' : getCategoryColor(category),
                                lineWidth: 0
                            };
                        });
                    }
                }
            },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        const label = context.label || '';
                        const value = context.parsed || 0;
                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                        const percentage = ((value / total) * 100).toFixed(1);
                        return `${label}: $${value.toFixed(2)} (${percentage}%)`;
                    }
                }
            }
        }
    };

    if (categories.length === 0) {
        return (
            <div className="card h-64 flex items-center justify-center">
                <p className="text-gray-500 dark:text-gray-300">No data to display</p>
            </div>
        );
    }

    return (
        <div className="card h-64 w-full overflow-hidden flex flex-col relative">
            <div className="flex items-start justify-between mb-2">
                <h3 className="text-base sm:text-lg font-semibold dark:text-white">Expenses by Category</h3>
                <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                        {formatCurrency(visibleTotal)}
                    </div>
                    {hiddenTotal > 0 && (
                        <div className="text-xs text-gray-500 dark:text-gray-300 line-through whitespace-nowrap">
                            {formatCurrency(hiddenTotal)}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex-1 relative" style={{ minHeight: 0 }}>
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full h-full max-w-full max-h-full">
                        <Pie data={data} options={options} />
                    </div>
                </div>
            </div>
        </div>
    );
}

