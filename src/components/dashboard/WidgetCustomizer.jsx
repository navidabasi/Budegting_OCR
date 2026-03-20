import { useState, useEffect } from 'react';
import { X, GripVertical } from 'lucide-react';
import Button from '../common/Button';
import { getAllWidgets, getDefaultLayout, WIDGET_TYPES } from './WidgetRegistry';
import { useTranslation } from '../../languages/useTranslation';

export default function WidgetCustomizer({ isOpen, onClose, currentLayout, onSave }) {
    const { t } = useTranslation();
    const [widgets, setWidgets] = useState([]);
    const [enabled, setEnabled] = useState(new Set());
    const [draggedWidget, setDraggedWidget] = useState(null);

    useEffect(() => {
        if (isOpen && currentLayout) {
            // Sort widgets by order from layout
            const sortedWidgets = getAllWidgets().sort((a, b) => {
                const aOrder = currentLayout.widgets.find(w => w.id === a.id)?.order ?? a.defaultOrder;
                const bOrder = currentLayout.widgets.find(w => w.id === b.id)?.order ?? b.defaultOrder;
                return aOrder - bOrder;
            });
            setWidgets(sortedWidgets);
            setEnabled(new Set(currentLayout.enabled || []));
        } else if (isOpen) {
            // Use default layout
            const defaultLayout = getDefaultLayout();
            const sortedWidgets = getAllWidgets().sort((a, b) => {
                const aOrder = defaultLayout.widgets.find(w => w.id === a.id)?.order ?? a.defaultOrder;
                const bOrder = defaultLayout.widgets.find(w => w.id === b.id)?.order ?? b.defaultOrder;
                return aOrder - bOrder;
            });
            setWidgets(sortedWidgets);
            setEnabled(new Set(defaultLayout.enabled || []));
        }
    }, [isOpen, currentLayout]);

    const handleToggle = (widgetId) => {
        setEnabled(prev => {
            const newSet = new Set(prev);
            if (newSet.has(widgetId)) {
                newSet.delete(widgetId);
            } else {
                newSet.add(widgetId);
            }
            return newSet;
        });
    };

    const handleDragStart = (e, widgetId) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ widgetId }));
        e.dataTransfer.effectAllowed = 'move';
        setDraggedWidget(widgetId);
    };

    const handleDragEnd = () => {
        setDraggedWidget(null);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, targetWidgetId) => {
        e.preventDefault();
        e.stopPropagation();

        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            const sourceWidgetId = data.widgetId;

            if (sourceWidgetId === targetWidgetId) return;

            const sourceIndex = widgets.findIndex(w => w.id === sourceWidgetId);
            const targetIndex = widgets.findIndex(w => w.id === targetWidgetId);

            if (sourceIndex === -1 || targetIndex === -1) return;

            const newWidgets = [...widgets];
            const [removed] = newWidgets.splice(sourceIndex, 1);
            newWidgets.splice(targetIndex, 0, removed);

            setWidgets(newWidgets);
        } catch (err) {
            console.error('Failed to parse drop data:', err);
        }
    };

    const handleSave = () => {
        // Save ALL widgets (both enabled and disabled) with their current order
        // This ensures that when widgets are toggled back on, they appear in the correct position
        const allWidgets = getAllWidgets();
        const widgetOrderMap = new Map();
        widgets.forEach((widget, index) => {
            widgetOrderMap.set(widget.id, index);
        });

        // For widgets not in the current list (shouldn't happen, but safety check)
        // use their default order or a high number
        const layout = {
            widgets: allWidgets.map((widget) => {
                const currentOrder = widgetOrderMap.get(widget.id);
                return {
                    id: widget.id,
                    type: widget.id,
                    order: currentOrder !== undefined ? currentOrder : widget.defaultOrder
                };
            }),
            enabled: Array.from(enabled)
        };
        console.log('[WidgetCustomizer] Saving layout with order:', layout.widgets.map(w => ({ id: w.id, order: w.order })));
        onSave(layout);
        onClose();
    };

    if (!isOpen) return null;

    const getWidgetName = (widgetId) => {
        switch (widgetId) {
            case WIDGET_TYPES.SUMMARY_CARDS:
                return t('dashboard.widgetNames.summaryCards');
            case WIDGET_TYPES.CATEGORY_CHART:
                return t('dashboard.widgetNames.categoryChart');
            case WIDGET_TYPES.EXPENSE_CHART:
                return t('dashboard.widgetNames.expenseChart');
            case WIDGET_TYPES.TOP_MERCHANTS:
                return t('dashboard.widgetNames.topMerchants');
            case WIDGET_TYPES.TOP_EXPENSES:
                return t('dashboard.widgetNames.topExpenses');
            case WIDGET_TYPES.CASH_FLOW:
                return t('dashboard.widgetNames.cashFlow');
            case WIDGET_TYPES.RECURRING_PAYMENTS:
                return t('dashboard.widgetNames.recurringPayments');
            default:
                return widgetId;
        }
    };

    const getWidgetDescription = (widgetId) => {
        switch (widgetId) {
            case WIDGET_TYPES.SUMMARY_CARDS:
                return t('dashboard.widgetDescriptions.summaryCards');
            case WIDGET_TYPES.CATEGORY_CHART:
                return t('dashboard.widgetDescriptions.categoryChart');
            case WIDGET_TYPES.EXPENSE_CHART:
                return t('dashboard.widgetDescriptions.expenseChart');
            case WIDGET_TYPES.TOP_MERCHANTS:
                return t('dashboard.widgetDescriptions.topMerchants');
            case WIDGET_TYPES.TOP_EXPENSES:
                return t('dashboard.widgetDescriptions.topExpenses');
            case WIDGET_TYPES.CASH_FLOW:
                return t('dashboard.widgetDescriptions.cashFlow');
            case WIDGET_TYPES.RECURRING_PAYMENTS:
                return t('dashboard.widgetDescriptions.recurringPayments');
            default:
                return '';
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold dark:text-white">{t('dashboard.widgetCustomizer.title')}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
                    >
                        <X size={24} />
                    </button>
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                    {t('dashboard.widgetCustomizer.subtitle')}
                </p>

                <div className="space-y-2 mb-6">
                    {widgets.map((widget) => {
                        const isWidgetEnabled = enabled.has(widget.id);
                        const isDragging = draggedWidget === widget.id;

                        return (
                            <div
                                key={widget.id}
                                draggable={true}
                                onDragStart={(e) => handleDragStart(e, widget.id)}
                                onDragEnd={handleDragEnd}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, widget.id)}
                                className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${isDragging
                                    ? 'opacity-50 border-primary-500 bg-primary-50 dark:bg-primary-900'
                                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                                    }`}
                            >
                                <div className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move">
                                    <GripVertical size={20} />
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-medium text-gray-900 dark:text-white">{getWidgetName(widget.id)}</h4>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">{getWidgetDescription(widget.id)}</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={isWidgetEnabled}
                                        onChange={() => handleToggle(widget.id)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                                </label>
                            </div>
                        );
                    })}
                </div>

                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        onClick={onClose}
                        className="flex-1"
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleSave}
                        className="flex-1"
                    >
                        {t('dashboard.widgetCustomizer.saveLayout')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
