export function normalizeTrackingData(trackingData) {
    if (!trackingData || typeof trackingData !== 'object') {
        return null;
    }

    const hasKnownStatus = trackingData.status === 'open' || trackingData.status === 'done';
    const isTracked = trackingData.isTracked === undefined
        ? hasKnownStatus
        : Boolean(trackingData.isTracked);

    if (!isTracked && !hasKnownStatus) {
        return null;
    }

    return {
        isTracked,
        status: trackingData.status === 'done' ? 'done' : 'open',
        completedAt: trackingData.completedAt || null,
        sourceRecurringId: trackingData.sourceRecurringId || null,
    };
}

export function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function isTrackedReceipt(receipt) {
    return !!normalizeTrackingData(receipt?.trackingData)?.isTracked;
}

export function getTrackingStatus(receipt) {
    const trackingData = normalizeTrackingData(receipt?.trackingData);
    if (!trackingData?.isTracked) {
        return null;
    }

    return trackingData.status === 'done' ? 'done' : 'open';
}

export function buildOpenTrackingData(existingTrackingData = null) {
    const normalized = normalizeTrackingData(existingTrackingData);
    return {
        isTracked: true,
        status: 'open',
        completedAt: null,
        sourceRecurringId: normalized?.sourceRecurringId || null,
    };
}

export function buildDoneTrackingData(existingTrackingData = null, completedAt = new Date().toISOString(), sourceRecurringId = null) {
    const normalized = normalizeTrackingData(existingTrackingData);
    return {
        isTracked: true,
        status: 'done',
        completedAt,
        sourceRecurringId: sourceRecurringId || normalized?.sourceRecurringId || null,
    };
}

export function shouldIncludeInFinancialTotals(receipt) {
    const trackingData = normalizeTrackingData(receipt?.trackingData);
    if (!trackingData?.isTracked) {
        return true;
    }

    return trackingData.status === 'done';
}

export function buildCompletedReceiptFromSource(receipt, completedAt = new Date().toISOString(), completionDate = getLocalDateString()) {
    const sourceTrackingData = normalizeTrackingData(receipt.trackingData);
    return {
        userId: receipt.userId,
        merchant: receipt.merchant,
        date: completionDate,
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
        trackingData: buildDoneTrackingData(sourceTrackingData, completedAt, receipt.id),
    };
}
