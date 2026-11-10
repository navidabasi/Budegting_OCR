import { useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import QuickAddSheet from '../quickadd/QuickAddSheet';
import ReceiptUpload from '../receipts/ReceiptUpload';
import ErrorBoundary from '../common/ErrorBoundary';

/**
 * Host for the add flow: the FAB opens the Quick Add sheet; its camera/gallery shortcuts open the scan flow.
 */
export default function AddReceiptModal() {
    const open = useAppStore((state) => state.addReceiptModalOpen);
    const preset = useAppStore((state) => state.quickAddPreset);
    const setOpen = useAppStore((state) => state.setAddReceiptModalOpen);
    const openQuickAdd = useAppStore((state) => state.openQuickAdd);
    const [scan, setScan] = useState(null); // { mode: 'camera' | 'upload', file? }
    const fileInputRef = useRef(null);

    const closeAll = () => {
        setScan(null);
        setOpen(false);
    };

    const handleScan = (source) => {
        if (source === 'camera') setScan({ mode: 'camera' });
        else fileInputRef.current?.click();
    };

    const handleFile = (e) => {
        const file = e.target.files?.[0];
        if (file) setScan({ mode: 'upload', file });
        e.target.value = '';
    };

    return (
        <ErrorBoundary>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFile} className="hidden" aria-hidden="true" tabIndex={-1} />
            <QuickAddSheet open={open && !scan} onClose={closeAll} preset={preset} onScan={handleScan} />
            {scan ? (
                <ReceiptUpload
                    isOpen={open}
                    onClose={closeAll}
                    mode={scan.mode}
                    initialFile={scan.file}
                    onSwitchToManual={() => {
                        setScan(null);
                        openQuickAdd();
                    }}
                />
            ) : null}
        </ErrorBoundary>
    );
}
