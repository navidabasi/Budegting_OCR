import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { useDraft } from '../../data/syncHooks';
import { deleteDraft, isMeaningfulQuickAddDraft } from '../../data/drafts';
import { draftSummary } from '../quickadd/QuickAddSheet';
import { useTranslation } from '../../languages/useTranslation';
import { localeFor } from '../../utils/format';

/** Unsaved Quick Add / Scan work left from earlier (dismissed sheet, closed app): resume or discard it from Home. */
export default function DraftBanner() {
    const { t, languageCode } = useTranslation();
    const navigate = useNavigate();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const showToast = useAppStore((s) => s.showToast);
    const openQuickAdd = useAppStore((s) => s.openQuickAdd);
    const qa = useDraft('quickadd');
    const scan = useDraft('scan');
    const rows = [];
    if (qa?.data?.state && isMeaningfulQuickAddDraft(qa.data.state)) {
        rows.push({
            kind: 'quickadd',
            text: draftSummary(qa.data.state, t, localeFor(languageCode, qa.data.state.more?.currency)),
            resume: () => openQuickAdd({ resume: true }),
        });
    }
    if (scan?.blob) rows.push({ kind: 'scan', text: t('draft.scanTitle'), resume: () => navigate('/scan?resume=1') });
    if (!rows.length) return null;
    return (
        <div className="flex flex-col gap-2" data-testid="draft-banners">
            {rows.map((r) => (
                <div key={r.kind} className="flex items-center gap-2 rounded-[16px] bg-mint px-3.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-forest-ink">{r.text}</span>
                    <button type="button" onClick={r.resume} className="h-11 shrink-0 rounded-[12px] px-3 text-sm font-semibold text-forest-ink">
                        {t('draft.resume')}
                    </button>
                    <button
                        type="button"
                        aria-label={t('draft.discard')}
                        onClick={() => deleteDraft(userId, r.kind).then(() => showToast(t('draft.discarded'), 'info'))}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-ink-muted"
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            ))}
        </div>
    );
}
