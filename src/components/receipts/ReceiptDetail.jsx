import { useState } from 'react';
import { Edit, Trash2, ArrowLeft, CheckCircle2, Clock3 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatDate, formatCurrency, resolveReceiptBackTarget } from '../../utils/helpers';
import Button from '../common/Button';
import Modal from '../common/Modal';
import ReceiptForm from './ReceiptForm';
import CurrencyDisplay from '../common/CurrencyDisplay';
import { useDeleteTransaction, useMarkTransactionDone, useUpdateTransaction } from '../../data/hooks';
import { useAppStore } from '../../store/appStore';
import { getTrackingStatus, isTrackedReceipt } from '../../utils/tracking';
import { useTranslation } from '../../languages/useTranslation';

export default function ReceiptDetail({ receipt, onUpdate, onDelete }) {
    const { t, localizeCategory } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const showToast = useAppStore((state) => state.showToast);
    const updateReceipt = useUpdateTransaction();
    const deleteReceipt = useDeleteTransaction();
    const markReceiptAsDone = useMarkTransactionDone();
    const [isEditing, setIsEditing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isMarkingDone, setIsMarkingDone] = useState(false);

    const trackingStatus = getTrackingStatus(receipt);
    const showDoneAction = isTrackedReceipt(receipt);
    const returnTo = location.state?.returnTo || '/activity';
    const backTarget = resolveReceiptBackTarget(receipt.id, returnTo);

    const handleUpdate = async (receiptData) => {
        try {
            await updateReceipt(receipt.id, receiptData);
            onUpdate();
            setIsEditing(false);
            showToast(t('receipts.form.updateSuccess'), 'success');
        } catch (err) {
            showToast(t('receipts.form.updateFailed'), 'error');
        }
    };

    const handleDelete = async () => {
        try {
            await deleteReceipt(receipt.id);
            showToast(t('receipts.detail.deleteSuccess'), 'success');
            navigate(backTarget);
            onDelete();
        } catch (err) {
            showToast(t('receipts.detail.deleteFailed'), 'error');
        }
    };

    const handleMarkAsDone = async () => {
        setIsMarkingDone(true);

        try {
            await markReceiptAsDone(receipt.id);
            onUpdate();
            showToast(
                receipt.recurringData?.isActive
                    ? t('receipts.tracking.markRecurringSuccess')
                    : t('receipts.tracking.markSuccess'),
                'success'
            );
        } catch (err) {
            showToast(err.message || t('receipts.tracking.markFailed'), 'error');
        } finally {
            setIsMarkingDone(false);
        }
    };


    return (
        <div className="max-w-2xl mx-auto pb-8">
            <div className="mb-4">
                <button
                    onClick={() => navigate(backTarget)}
                    className="flex items-center gap-2 text-gray-600 dark:text-white hover:text-gray-900 dark:hover:text-gray-200"
                >
                    <ArrowLeft size={20} />
                    {t('receipts.detail.backToReceipts')}
                </button>
            </div>

            <div className="card">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{receipt.merchant}</h1>
                            {trackingStatus === 'open' && (
                                <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                    <Clock3 size={12} />
                                    {t('receipts.tracking.open')}
                                </span>
                            )}
                            {trackingStatus === 'done' && (
                                <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200">
                                    <CheckCircle2 size={12} />
                                    {t('receipts.tracking.done')}
                                </span>
                            )}
                        </div>
                        <p className="text-gray-500 dark:text-gray-300">{formatDate(receipt.date)}</p>
                    </div>
                    <div className="text-right">
                        <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                            <CurrencyDisplay amount={receipt.total} currency={receipt.currency} />
                        </div>
                        {receipt.category && (
                            <span className="inline-block px-3 py-1 text-sm rounded primary-bg primary-color">
                                {localizeCategory(receipt.category)}
                            </span>
                        )}
                    </div>
                </div>

                {receipt.lineItems && receipt.lineItems.length > 0 && (
                    <div className="mb-6">
                        <h2 className="text-lg font-semibold mb-3 dark:text-white">{t('receipts.detail.lineItems')}</h2>
                        <div className="space-y-2">
                            {receipt.lineItems.map((item, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                                >
                                    <div className="flex-1">
                                        <p className="font-medium text-gray-900 dark:text-gray-100">{item.name}</p>
                                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-600 dark:text-gray-400">
                                            <span>{t('receipts.detail.qtyLabel', { quantity: item.quantity })}</span>
                                            {item.category && (
                                                <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-0.5 rounded">
                                                    {localizeCategory(item.category)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                                        {formatCurrency(parseFloat(item.price || 0) * parseFloat(item.quantity || 1), receipt.currency || 'USD')}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {receipt.notes && (
                    <div className="mb-6">
                        <h2 className="text-lg font-semibold mb-2 dark:text-white">{t('receipts.detail.notes')}</h2>
                        <p className="text-gray-700 dark:text-white">{receipt.notes}</p>
                    </div>
                )}

                {receipt.splitData && (
                    <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg">
                        <h2 className="text-lg font-semibold mb-3 dark:text-white">
                            {t('receipts.detail.splitDetails')}
                        </h2>
                        {receipt.splitData.method === 'equal' ? (
                            <div>
                                <p className="text-sm text-gray-700 dark:text-white">
                                    {t('receipts.detail.splitEqualSummary', {
                                        people: receipt.splitData.people,
                                        suffix: receipt.splitData.people !== 1 ? 's' : '',
                                    })}
                                </p>
                                <p className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                                    {t('receipts.detail.splitEachPerson', {
                                        amount: formatCurrency(receipt.total / receipt.splitData.people, receipt.currency || 'EUR'),
                                    })}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-sm text-gray-700 dark:text-white mb-2">
                                    {t('receipts.detail.splitCustomSummary', {
                                        people: receipt.splitData.people,
                                        suffix: receipt.splitData.people !== 1 ? 's' : '',
                                    })}
                                </p>
                                {receipt.splitData.users && receipt.splitData.users.length > 0 && (
                                    <div className="space-y-1">
                                        {receipt.splitData.users.map((user, index) => (
                                            <div key={index} className="flex items-center justify-between text-sm">
                                                <span className="text-gray-700 dark:text-white">
                                                    {user.name || t('receipts.detail.personName', { index: index + 1 })}
                                                </span>
                                                <span className="font-semibold text-gray-900 dark:text-white">
                                                    {formatCurrency(user.amount, receipt.currency || 'EUR')} ({user.percentage.toFixed(1)}%)
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex gap-2 pt-4 border-t">
                    <Button
                        variant="primary"
                        onClick={() => setIsEditing(true)}
                        className="flex-1 flex items-center justify-center gap-2"
                    >
                        <Edit size={18} />
                        {t('common.actions.edit')}
                    </Button>
                    <Button
                        variant="danger"
                        onClick={() => setIsDeleting(true)}
                        className="flex-1 flex items-center justify-center gap-2"
                    >
                        <Trash2 size={18} />
                        {t('common.actions.delete')}
                    </Button>
                </div>

                {showDoneAction && trackingStatus === 'open' && (
                    <Button
                        variant="secondary"
                        onClick={handleMarkAsDone}
                        disabled={isMarkingDone}
                        className="w-full mt-3 flex items-center justify-center gap-2"
                    >
                        <CheckCircle2 size={18} />
                        {isMarkingDone ? t('receipts.tracking.marking') : t('receipts.tracking.markAsDone')}
                    </Button>
                )}

                {showDoneAction && trackingStatus === 'done' && (
                    <Button
                        variant="secondary"
                        disabled={true}
                        className="w-full mt-3 flex items-center justify-center gap-2"
                    >
                        <CheckCircle2 size={18} />
                        {t('receipts.tracking.doneState')}
                    </Button>
                )}
            </div>

            {isEditing && (
                <Modal
                    isOpen={isEditing}
                    onClose={() => setIsEditing(false)}
                    title={t('receipts.detail.editTitle')}
                    size="lg"
                >
                    <ReceiptForm
                        initialData={receipt}
                        onSave={handleUpdate}
                        onClose={() => setIsEditing(false)}
                    />
                </Modal>
            )}

            {isDeleting && (
                <Modal
                    isOpen={isDeleting}
                    onClose={() => setIsDeleting(false)}
                    title={t('receipts.detail.deleteTitle')}
                >
                    <p className="mb-4">{t('receipts.detail.deleteConfirmMessage')}</p>
                    <div className="flex gap-2">
                        <Button variant="danger" onClick={handleDelete} className="flex-1">
                            {t('common.actions.delete')}
                        </Button>
                        <Button variant="secondary" onClick={() => setIsDeleting(false)} className="flex-1">
                            {t('common.actions.cancel')}
                        </Button>
                    </div>
                </Modal>
            )}

        </div>
    );
}
