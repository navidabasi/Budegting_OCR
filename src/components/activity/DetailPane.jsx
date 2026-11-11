import { forwardRef } from 'react';
import { MousePointerClick } from 'lucide-react';
import ReceiptDetail from '../receipts/ReceiptDetail';
import LoadingSpinner from '../common/LoadingSpinner';
import { useTransaction } from '../../data/hooks';
import { notifyDataChanged } from '../../data/queryClient';
import { useTranslation } from '../../languages/useTranslation';

/** The transaction beside the list on tablet and PC (the same ReceiptDetail as the phone page). Esc / the X clear the selection. */
const DetailPane = forwardRef(function DetailPane({ id, onClose }, ref) {
    const { t } = useTranslation();
    const { data: receipt, isLoading } = useTransaction(id || undefined);
    return (
        <aside ref={ref} tabIndex={-1} aria-label={t('pane.detail')} className="min-w-0 flex-1 overflow-y-auto bg-ground outline-none" data-testid="detail-pane">
            {!id ? (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 px-8 text-center text-ink-muted" data-testid="detail-empty">
                    <MousePointerClick size={26} aria-hidden="true" />
                    <p className="text-sm">{t('pane.selectPrompt')}</p>
                    <p className="hidden text-xs desk:block">{t('pane.keyboardHint')}</p>
                </div>
            ) : isLoading && !receipt ? (
                <LoadingSpinner />
            ) : receipt ? (
                <ReceiptDetail key={receipt.id} receipt={receipt} embedded onClose={onClose} onUpdate={() => notifyDataChanged()} onDelete={onClose} />
            ) : null}
        </aside>
    );
});
export default DetailPane;
