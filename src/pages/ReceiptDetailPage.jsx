import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTransaction, useSyncStatus } from '../data/hooks';
import { notifyDataChanged } from '../data/queryClient';
import { useAppStore } from '../store/appStore';
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
    const showToast = useAppStore((state) => state.showToast);
    const incomingReceipt = location.state?.initialReceipt || null;
    const initialReceipt = incomingReceipt && String(incomingReceipt.id) === String(id)
        ? incomingReceipt
        : null;
    const returnTo = location.state?.returnTo || '/receipts';
    const backTarget = resolveReceiptBackTarget(id, returnTo);
    const { data: liveReceipt, isLoading, error: queryError } = useTransaction(id);
    const syncStatus = useSyncStatus();
    const hadReceiptRef = useRef(false);

    // Live data from the local mirror; the navigation state gives an instant first render.
    const receipt = liveReceipt || initialReceipt || null;
    const loadError = queryError?.message || null;
    // The mirror may still be empty on a fresh device until the first pull finishes
    const waitingForFirstPull = !receipt && !syncStatus.attempted && navigator.onLine;
    const loading = !receipt && (isLoading || waitingForFirstPull);

    useEffect(() => {
        if (liveReceipt) hadReceiptRef.current = true;
    }, [liveReceipt]);

    useEffect(() => {
        if (!id) {
            showToast(t('receipts.detail.unableOpen'), 'warning');
            navigate(backTarget, { replace: true });
            return;
        }

        // A receipt that disappears after being shown was deleted here: ReceiptDetail navigates away itself.
        if (loading || receipt || queryError || hadReceiptRef.current) return;

        const candidate = initialReceipt?.date ? parseAppDate(initialReceipt.date) : new Date();
        const base = candidate || new Date();
        showToast(t('receipts.detail.unableOpen'), 'warning');
        navigate(`/receipts?filter=month&month=${base.getMonth() + 1}&year=${base.getFullYear()}`, { replace: true });
    }, [id, loading, receipt, queryError, initialReceipt, navigate, showToast, backTarget, t]);

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
                                onClick={() => notifyDataChanged()}
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
                onUpdate={() => notifyDataChanged()}
                onDelete={handleDelete}
            />
        </PageLayout>
    );
}
