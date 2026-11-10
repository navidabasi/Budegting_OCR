import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import QuickAddSheet from '../quickadd/QuickAddSheet';
import ErrorBoundary from '../common/ErrorBoundary';

/** Host for the add flow: the FAB opens Quick Add; its camera/gallery shortcuts open the scan flow (/scan). */
export default function AddReceiptModal() {
    const navigate = useNavigate();
    const open = useAppStore((state) => state.addReceiptModalOpen);
    const preset = useAppStore((state) => state.quickAddPreset);
    const setOpen = useAppStore((state) => state.setAddReceiptModalOpen);

    return (
        <ErrorBoundary>
            <QuickAddSheet
                open={open}
                onClose={() => setOpen(false)}
                preset={preset}
                onScan={(source) => {
                    setOpen(false);
                    navigate(`/scan?source=${source}`);
                }}
            />
        </ErrorBoundary>
    );
}
