export function isTrackedReceipt(receipt) {
    return !!receipt?.trackingData?.isTracked;
}

export function getTrackingStatus(receipt) {
    if (!isTrackedReceipt(receipt)) {
        return null;
    }

    return receipt.trackingData.status === 'done' ? 'done' : 'open';
}

export function buildOpenTrackingData(existingTrackingData = null) {
    return {
        isTracked: true,
        status: 'open',
        completedAt: null,
        sourceRecurringId: existingTrackingData?.sourceRecurringId || null,
    };
}

export function buildDoneTrackingData(existingTrackingData = null, completedAt = new Date().toISOString(), sourceRecurringId = null) {
    return {
        isTracked: true,
        status: 'done',
        completedAt,
        sourceRecurringId: sourceRecurringId || existingTrackingData?.sourceRecurringId || null,
    };
}

export function buildCompletedReceiptFromSource(receipt, completedAt = new Date().toISOString()) {
    return {
        userId: receipt.userId,
        merchant: receipt.merchant,
        date: receipt.date,
        total: receipt.total,
        currency: receipt.currency,
        category: receipt.category,
        notes: receipt.notes || '',
        lineItems: receipt.lineItems || [],
        isDemo: receipt.isDemo || false,
        isPinned: false,
        transactionType: receipt.transactionType || 'expense',
        groupId: receipt.groupId || null,
        groupName: receipt.groupName || null,
        groupTags: receipt.groupTags || [],
        splitData: receipt.splitData || null,
        recurringData: null,
        trackingData: buildDoneTrackingData(receipt.trackingData, completedAt, receipt.id),
    };
}
