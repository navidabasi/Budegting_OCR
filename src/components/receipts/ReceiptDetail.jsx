import { useState } from 'react';
import { Edit, Trash2, ArrowLeft, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatCurrency } from '../../utils/helpers';
import Button from '../common/Button';
import Modal from '../common/Modal';
import ReceiptForm from './ReceiptForm';
import SplitManager from './SplitManager';
import CurrencyDisplay from '../common/CurrencyDisplay';
import { storageService } from '../../services/storage';
import { useAppStore } from '../../store/appStore';

export default function ReceiptDetail({ receipt, onUpdate, onDelete }) {
    const navigate = useNavigate();
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const [isEditing, setIsEditing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showSplitManager, setShowSplitManager] = useState(false);

    const handleUpdate = async (receiptData) => {
        try {
            await storageService.updateReceipt(receipt.id, receiptData);
            onUpdate();
            setIsEditing(false);
            showToast('Receipt updated successfully', 'success');
        } catch (err) {
            showToast('Failed to update receipt', 'error');
        }
    };

    const handleDelete = async () => {
        try {
            await storageService.deleteReceipt(receipt.id);
            showToast('Receipt deleted successfully', 'success');
            navigate('/receipts');
            onDelete();
        } catch (err) {
            showToast('Failed to delete receipt', 'error');
        }
    };

    const handleSaveSplit = async (splitData) => {
        try {
            await storageService.updateReceipt(receipt.id, { splitData });
            onUpdate();
            setShowSplitManager(false);
            showToast('Split saved successfully', 'success');
        } catch (err) {
            showToast('Failed to save split', 'error');
        }
    };

    return (
        <div className="max-w-2xl mx-auto">
            <div className="mb-4">
                <button
                    onClick={() => navigate('/receipts')}
                    className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
                >
                    <ArrowLeft size={20} />
                    Back to Receipts
                </button>
            </div>

            <div className="card">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">{receipt.merchant}</h1>
                        <p className="text-gray-500">{formatDate(receipt.date)}</p>
                    </div>
                    <div className="text-right">
                        <div className="text-3xl font-bold text-gray-900 mb-2">
                            <CurrencyDisplay amount={receipt.total} currency={receipt.currency} />
                        </div>
                        {receipt.category && (
                            <span className="inline-block px-3 py-1 text-sm rounded" style={{ backgroundColor: '#e6f5f2', color: '#00573f' }}>
                                {receipt.category}
                            </span>
                        )}
                    </div>
                </div>

                {receipt.lineItems && receipt.lineItems.length > 0 && (
                    <div className="mb-6">
                        <h2 className="text-lg font-semibold mb-3">Line Items</h2>
                        <div className="space-y-2">
                            {receipt.lineItems.map((item, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                >
                                    <div className="flex-1">
                                        <p className="font-medium text-gray-900">{item.name}</p>
                                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                                            <span>Qty: {item.quantity}</span>
                                            {item.category && (
                                                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">
                                                    {item.category}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <p className="font-semibold text-gray-900">
                                        {formatCurrency(parseFloat(item.price || 0) * parseFloat(item.quantity || 1), receipt.currency || 'USD')}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {receipt.notes && (
                    <div className="mb-6">
                        <h2 className="text-lg font-semibold mb-2">Notes</h2>
                        <p className="text-gray-700">{receipt.notes}</p>
                    </div>
                )}

                {receipt.splitData && (
                    <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                            <Users size={20} />
                            Split Information
                        </h2>
                        {receipt.splitData.method === 'equal' ? (
                            <div>
                                <p className="text-sm text-gray-700">
                                    Split equally between {receipt.splitData.people} person{receipt.splitData.people !== 1 ? 's' : ''}
                                </p>
                                <p className="text-sm font-semibold text-gray-900 mt-1">
                                    Each person: {formatCurrency(receipt.total / receipt.splitData.people, receipt.currency || 'EUR')}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-sm text-gray-700 mb-2">
                                    Custom split between {receipt.splitData.people} person{receipt.splitData.people !== 1 ? 's' : ''}
                                </p>
                                {receipt.splitData.users && receipt.splitData.users.length > 0 && (
                                    <div className="space-y-1">
                                        {receipt.splitData.users.map((user, index) => (
                                            <div key={index} className="flex items-center justify-between text-sm">
                                                <span className="text-gray-700">{user.name || `Person ${index + 1}`}</span>
                                                <span className="font-semibold text-gray-900">
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
                        variant="secondary"
                        onClick={() => setShowSplitManager(true)}
                        className="flex-1 flex items-center justify-center gap-2"
                    >
                        <Users size={18} />
                        {receipt.splitData ? 'Edit Split' : 'Split Receipt'}
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => setIsEditing(true)}
                        className="flex-1 flex items-center justify-center gap-2"
                    >
                        <Edit size={18} />
                        Edit
                    </Button>
                    <Button
                        variant="danger"
                        onClick={() => setIsDeleting(true)}
                        className="flex-1 flex items-center justify-center gap-2"
                    >
                        <Trash2 size={18} />
                        Delete
                    </Button>
                </div>
            </div>

            {isEditing && (
                <Modal
                    isOpen={isEditing}
                    onClose={() => setIsEditing(false)}
                    title="Edit Receipt"
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
                    title="Delete Receipt"
                >
                    <p className="mb-4">Are you sure you want to delete this receipt? This action cannot be undone.</p>
                    <div className="flex gap-2">
                        <Button variant="danger" onClick={handleDelete} className="flex-1">
                            Delete
                        </Button>
                        <Button variant="secondary" onClick={() => setIsDeleting(false)} className="flex-1">
                            Cancel
                        </Button>
                    </div>
                </Modal>
            )}

            {showSplitManager && (
                <SplitManager
                    receipt={receipt}
                    onSave={handleSaveSplit}
                    onClose={() => setShowSplitManager(false)}
                />
            )}
        </div>
    );
}

