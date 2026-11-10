import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useSaveLayout } from '../data/hooks';
import SummaryCards from '../components/dashboard/SummaryCards';
import CategoryChart from '../components/dashboard/CategoryChart';
import ExpenseChart from '../components/dashboard/ExpenseChart';
import TopMerchants from '../components/dashboard/TopMerchants';
import TopExpenses from '../components/dashboard/TopExpenses';
import CashFlow from '../components/dashboard/CashFlow';
import RecurringPayments from '../components/dashboard/RecurringPayments';
import WidgetCustomizer from '../components/dashboard/WidgetCustomizer';
import { WIDGET_TYPES } from '../components/dashboard/WidgetRegistry';
import PageLayout from '../components/common/PageLayout';
import PageHeader from '../components/common/PageHeader';
import LoadingSpinner from '../components/common/LoadingSpinner';
import IconButton from '../components/common/IconButton';
import { useReceipts } from '../hooks/useReceipts';
import { useUserLayout } from '../hooks/useUserLayout';
import { Settings, Layout } from 'lucide-react';
import { shouldIncludeInFinancialTotals } from '../utils/tracking';
import { useTranslation } from '../languages/useTranslation';

export default function HomePage() {
    const { t } = useTranslation();
    const currentUser = useAppStore((state) => state.currentUser);
    const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
    const showToast = useAppStore((state) => state.showToast);
    const { receipts, loading: receiptsLoading } = useReceipts();
    const { layout, loading: layoutLoading } = useUserLayout();
    const saveLayout = useSaveLayout();
    const [showCustomizer, setShowCustomizer] = useState(false);

    const loading = receiptsLoading || layoutLoading;
    if (loading || !layout) {
        return <LoadingSpinner />;
    }

    const financialReceipts = receipts.filter(shouldIncludeInFinancialTotals);

    const handleSaveLayout = async (newLayout) => {
        if (!currentUser) return;

        try {
            console.log('[HomePage] Saving layout:', newLayout);
            await saveLayout(newLayout);
            showToast(t('dashboard.toasts.layoutSaved'), 'success');
        } catch (err) {
            console.error('Failed to save layout:', err);
            showToast(t('dashboard.toasts.layoutSaveFailed'), 'error');
        }
    };

    const renderWidget = (widgetId) => {
        switch (widgetId) {
            case WIDGET_TYPES.SUMMARY_CARDS:
                return <SummaryCards receipts={financialReceipts} />;
            case WIDGET_TYPES.CATEGORY_CHART:
                return <CategoryChart receipts={financialReceipts} />;
            case WIDGET_TYPES.EXPENSE_CHART:
                return <ExpenseChart receipts={financialReceipts} />;
            case WIDGET_TYPES.TOP_MERCHANTS:
                return <TopMerchants receipts={financialReceipts} />;
            case WIDGET_TYPES.TOP_EXPENSES:
                return <TopExpenses receipts={financialReceipts} />;
            case WIDGET_TYPES.CASH_FLOW:
                return <CashFlow receipts={financialReceipts} />;
            case WIDGET_TYPES.RECURRING_PAYMENTS:
                return <RecurringPayments receipts={receipts} />;
            default:
                return null;
        }
    };

    if (!layout) {
        return <LoadingSpinner />;
    }

    // Get enabled widgets sorted by order
    const enabledWidgets = (layout.widgets || [])
        .filter(w => layout.enabled && layout.enabled.includes(w.id))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    console.log('[HomePage] Enabled widgets in order:', enabledWidgets.map(w => ({ id: w.id, order: w.order })));

    // Render widgets in the exact order they appear in enabledWidgets
    // Charts (CategoryChart and ExpenseChart) should be in a grid when they appear together
    const renderWidgetsInOrder = () => {
        const widgets = [];
        let chartGroup = [];

        enabledWidgets.forEach((widget, index) => {
            const isChart = widget.id === WIDGET_TYPES.CATEGORY_CHART || widget.id === WIDGET_TYPES.EXPENSE_CHART;

            if (isChart) {
                chartGroup.push(widget);
            } else {
                // If we have accumulated charts, render them first
                if (chartGroup.length > 0) {
                    if (chartGroup.length === 1) {
                        // Single chart - render full width
                        widgets.push(
                            <div key={chartGroup[0].id} className="mb-6">
                                {renderWidget(chartGroup[0].id)}
                            </div>
                        );
                    } else {
                        // Multiple charts - render in grid
                        widgets.push(
                            <div key={`chart-group-${index}`} className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                                {chartGroup.map((chartWidget) => (
                                    <div
                                        key={chartWidget.id}
                                        className={chartWidget.id === WIDGET_TYPES.EXPENSE_CHART ? 'contents' : ''}
                                    >
                                        {renderWidget(chartWidget.id)}
                                    </div>
                                ))}
                            </div>
                        );
                    }
                    chartGroup = [];
                }

                // Render the non-chart widget
                widgets.push(
                    <div key={widget.id} className="mb-6">
                        {renderWidget(widget.id)}
                    </div>
                );
            }
        });

        // Render any remaining charts
        if (chartGroup.length > 0) {
            if (chartGroup.length === 1) {
                widgets.push(
                    <div key={chartGroup[0].id} className="mb-6">
                        {renderWidget(chartGroup[0].id)}
                    </div>
                );
            } else {
                widgets.push(
                    <div key="chart-group-final" className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        {chartGroup.map((chartWidget) => (
                            <div
                                key={chartWidget.id}
                                className={chartWidget.id === WIDGET_TYPES.EXPENSE_CHART ? 'contents' : ''}
                            >
                                {renderWidget(chartWidget.id)}
                            </div>
                        ))}
                    </div>
                );
            }
        }

        return widgets;
    };

    return (
        <PageLayout className="pt-8 md:pt-0">
            <PageHeader
                title={t('dashboard.title')}
                subtitle={t('dashboard.subtitle')}
                actions={
                    <>
                        <IconButton
                            icon={Layout}
                            onClick={() => setShowCustomizer(true)}
                            ariaLabel={t('dashboard.widgetCustomizer.title')}
                        />
                        <IconButton
                            icon={Settings}
                            onClick={() => setSidebarOpen(true)}
                            ariaLabel={t('navigation.settings')}
                        />
                    </>
                }
            />

            {/* Render widgets in the exact order from layout */}
            {renderWidgetsInOrder()}

            <WidgetCustomizer
                isOpen={showCustomizer}
                onClose={() => setShowCustomizer(false)}
                currentLayout={layout}
                onSave={handleSaveLayout}
            />
        </PageLayout>
    );
}
