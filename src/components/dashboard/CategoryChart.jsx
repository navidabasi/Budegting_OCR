import { useNavigate } from 'react-router-dom';
import { Pie } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend
} from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

export default function CategoryChart({ receipts }) {
    const navigate = useNavigate();
    const categoryTotals = {};

    receipts.forEach(receipt => {
        const category = receipt.category || 'Other';
        categoryTotals[category] = (categoryTotals[category] || 0) + (parseFloat(receipt.total) || 0);
    });

    const categories = Object.keys(categoryTotals);
    const totals = Object.values(categoryTotals);

    const colors = [
        '#00573f', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
    ];

    const data = {
        labels: categories,
        datasets: [
            {
                data: totals,
                backgroundColor: colors.slice(0, categories.length),
                borderWidth: 2,
                borderColor: '#ffffff'
            }
        ]
    };

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
                navigate(`/receipts?filter=category&category=${encodeURIComponent(category)}`);
            }
        },
        plugins: {
            legend: {
                position: 'left',
                labels: {
                    padding: 8,
                    usePointStyle: true,
                    boxWidth: 8,
                    font: {
                        size: 11
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
                <p className="text-gray-500">No data to display</p>
            </div>
        );
    }

    return (
        <div className="card h-64 w-full overflow-hidden flex flex-col">
            <h3 className="text-base sm:text-lg font-semibold mb-2">Expenses by Category</h3>
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

