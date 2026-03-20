import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import ReceiptDetail from '../components/receipts/ReceiptDetail';
import PageLayout from '../components/common/PageLayout';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import { parseAppDate, resolveReceiptBackTarget } from '../utils/helpers';
import { useTranslation } from '../languages/useTranslation';

export default function ReceiptDetailPage() {
    const { t } = useTranslation();
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const incomingReceipt = location.state?.initialReceipt || null;
    const initialReceipt = incomingReceipt && String(incomingReceipt.id) === String(id)
        ? incomingReceipt
        : null;
    const returnTo = location.state?.returnTo || '/receipts';
    const backTarget = resolveReceiptBackTarget(id, returnTo);
    const [receipt, setReceipt] = useState(initialReceipt);
    const [loading, setLoading] = useState(!initialReceipt);
    const [loadError, setLoadError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;

        // Optimistic render from navigation state when available
        setReceipt(initialReceipt || null);
        setLoadError(null);

        const getFallbackMonthYear = () => {
            const candidate = initialReceipt?.date ? parseAppDate(initialReceipt.date) : new Date();
            if (!candidate) {
                const now = new Date();
                return {
                    month: now.getMonth() + 1,
                    year: now.getFullYear()
                };
            }

            return {
                month: candidate.getMonth() + 1,
                year: candidate.getFullYear()
            };
        };

        const loadReceipt = async () => {
            if (!id) {
                showToast(t('receipts.detail.unableOpen'), 'warning');
                navigate(backTarget, { replace: true });
                return;
            }

            const shouldShowSpinner = !initialReceipt;
            if (shouldShowSpinner) {
                setLoading(true);
            }

            try {
                let receiptData = await storageService.getReceiptById(id);

                // Fallback strategy: if direct fetch fails to resolve an item, refresh from list.
                if (!receiptData && currentUser?.userId) {
                    const userReceipts = await storageService.getReceiptsByUserId(currentUser.userId);
                    receiptData = userReceipts.find((item) => item.id === id) || null;
                }

                if (!active) return;

                if (!receiptData) {
                    throw new Error(t('receipts.page.noReceipts'));
                }

                setReceipt(receiptData);
            } catch (err) {
                if (!active) return;
                console.error(`Failed to load receipt (${id}):`, err);
                const message = err?.message || t('receipts.detail.deleteFailed');
                const isNotFound = /not found|invalid receipt|missing receipt/i.test(message.toLowerCase());

                if (isNotFound) {
                    const { month, year } = getFallbackMonthYear();
                    showToast(t('receipts.detail.unableOpen'), 'warning');
                    navigate(`/receipts?filter=month&month=${month}&year=${year}`, { replace: true });
                    return;
                }

                setLoadError(message);
                if (initialReceipt) {
                    setReceipt(initialReceipt);
                    showToast(t('receipts.detail.unableOpen'), 'warning');
                } else {
                    setReceipt(null);
                    showToast(t('receipts.detail.deleteFailed'), 'error');
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        loadReceipt();

        return () => {
            active = false;
        };
    }, [id, initialReceipt, navigate, reloadKey, showToast, currentUser?.userId, backTarget]);

    if (loading) {
        return <LoadingSpinner className="pb-20" />;
    }

    if (!receipt) {
        return (
            <PageLayout className="pt-6 md:pt-4 pb-32">
                <EmptyState
                    message={loadError ? t('receipts.detail.deleteFailed') : t('receipts.page.noReceipts')}
                    action={
                        <div className="flex justify-center gap-2">
                            <button
                                onClick={() => setReloadKey((prev) => prev + 1)}
                                className="btn btn-primary"
                            >
                                {t('common.messages.tryAgain')}
                            </button>
                            <button
                                onClick={() => navigate(backTarget)}
                                className="btn btn-secondary"
                            >
                                {t('common.actions.back')}
                            </button>
                        </div>
                    }
                />
            </PageLayout>
        );
    }

    const handleDelete = () => {
        // ReceiptDetail handles the redirect to /receipts after delete.
    };

    return (
        <PageLayout className="pt-6 md:pt-4 pb-32">
            <ReceiptDetail
                receipt={receipt}
                onUpdate={() => setReloadKey((prev) => prev + 1)}
                onDelete={handleDelete}
            />
        </PageLayout>
    );
}
