// Widget Registry - defines all available dashboard widgets
export const WIDGET_TYPES = {
    SUMMARY_CARDS: 'summary_cards',
    CATEGORY_CHART: 'category_chart',
    EXPENSE_CHART: 'expense_chart',
    TOP_MERCHANTS: 'top_merchants',
    TOP_EXPENSES: 'top_expenses',
    CASH_FLOW: 'cash_flow',
    RECURRING_PAYMENTS: 'recurring_payments'
};

export const WIDGET_CONFIG = {
    [WIDGET_TYPES.SUMMARY_CARDS]: {
        id: WIDGET_TYPES.SUMMARY_CARDS,
        name: 'Summary Cards',
        description: 'Total expenses, income, and balance overview',
        defaultEnabled: true,
        defaultOrder: 0
    },
    [WIDGET_TYPES.CATEGORY_CHART]: {
        id: WIDGET_TYPES.CATEGORY_CHART,
        name: 'Expense by Category',
        description: 'Pie chart showing spending by category',
        defaultEnabled: true,
        defaultOrder: 1
    },
    [WIDGET_TYPES.EXPENSE_CHART]: {
        id: WIDGET_TYPES.EXPENSE_CHART,
        name: 'Last 30 Days',
        description: 'Line chart of expenses over the last 30 days',
        defaultEnabled: true,
        defaultOrder: 2
    },
    [WIDGET_TYPES.TOP_MERCHANTS]: {
        id: WIDGET_TYPES.TOP_MERCHANTS,
        name: 'Top Merchants',
        description: 'List of merchants with highest spending',
        defaultEnabled: true,
        defaultOrder: 3
    },
    [WIDGET_TYPES.TOP_EXPENSES]: {
        id: WIDGET_TYPES.TOP_EXPENSES,
        name: 'Top Expenses of the Month',
        description: 'Shows the highest expenses for the current month',
        defaultEnabled: false,
        defaultOrder: 4
    },
    [WIDGET_TYPES.CASH_FLOW]: {
        id: WIDGET_TYPES.CASH_FLOW,
        name: 'Cash Flow',
        description: 'Horizontal bar chart showing income vs expenses',
        defaultEnabled: false,
        defaultOrder: 5
    },
    [WIDGET_TYPES.RECURRING_PAYMENTS]: {
        id: WIDGET_TYPES.RECURRING_PAYMENTS,
        name: 'Recurring Payments',
        description: 'Track upcoming recurring bills and subscriptions',
        defaultEnabled: false,
        defaultOrder: 6
    }
};

export function getDefaultLayout() {
    return {
        widgets: Object.values(WIDGET_CONFIG).map(widget => ({
            id: widget.id,
            type: widget.id,
            order: widget.defaultOrder
        })),
        enabled: Object.values(WIDGET_CONFIG).map(w => w.id)
    };
}

export function getWidgetConfig(widgetId) {
    return WIDGET_CONFIG[widgetId] || null;
}

export function getAllWidgets() {
    return Object.values(WIDGET_CONFIG);
}
