import { useState } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import ToggleRow from '../common/ToggleRow';
import { clearLastOutbound, getLastOutbound } from '../../services/aiOutbound';
import { useTranslation } from '../../languages/useTranslation';

const ORDER = ['chat', 'insights', 'categorize', 'extract'];

/**
 * Settings > AI & scanning: what leaves the device. The photo switch, the optional crop step and a panel that shows the exact
 * last payload sent per feature (after identifiers were removed), so the owner can check the claim instead of trusting it.
 */
export default function AiBoundarySettings({ prefs, onChange }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [sent, setSent] = useState(() => getLastOutbound());
    const [feature, setFeature] = useState(null);
    const features = ORDER.filter((f) => sent[f]);
    const current = sent[feature] || sent[features[0]];
    const refresh = () => setSent(getLastOutbound());

    return (
        <div className="mb-3 flex flex-col gap-1" data-testid="ai-boundary">
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
                <ToggleRow testId="send-photos" label={t('aiBoundary.sendPhotos')} hint={t(prefs.sendPhotos ? 'aiBoundary.sendPhotosOn' : 'aiBoundary.sendPhotosOff')} checked={prefs.sendPhotos} onChange={(v) => onChange({ sendPhotos: v })} />
                {prefs.sendPhotos ? <ToggleRow testId="crop-first" label={t('aiBoundary.cropFirst')} hint={t('aiBoundary.cropFirstHint')} checked={prefs.cropFirst} onChange={(v) => onChange({ cropFirst: v })} /> : null}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400">{t('aiBoundary.summary')}</p>
            <details
                className="group"
                open={open}
                onToggle={(e) => {
                    setOpen(e.currentTarget.open);
                    if (e.currentTarget.open) refresh();
                }}
            >
                <summary className="flex min-h-[44px] cursor-pointer select-none items-center justify-between gap-2 text-sm font-medium text-gray-900 dark:text-white">
                    <span className="flex items-center gap-2">
                        <Eye size={16} aria-hidden="true" />
                        {t('aiBoundary.seeSent')}
                    </span>
                    <ChevronDown size={16} className="text-gray-500 transition-transform group-open:rotate-180 dark:text-gray-400" aria-hidden="true" />
                </summary>
                <div className="flex flex-col gap-2 pb-2 pt-1">
                    {features.length === 0 ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="sent-empty">{t('aiBoundary.nothingSent')}</p>
                    ) : (
                        <>
                            <div className="flex flex-wrap gap-2" role="tablist">
                                {features.map((f) => (
                                    <button key={f} type="button" role="tab" aria-selected={current === sent[f]} onClick={() => setFeature(f)} className={`min-h-[44px] rounded-full px-3.5 text-sm font-semibold ${current === sent[f] ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}>
                                        {t(`aiBoundary.feature.${f}`)}
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">{t('aiBoundary.lastSent', { date: current.at.replace('T', ' ') })}</p>
                            <pre data-testid="sent-payload" tabIndex={0} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-900 dark:text-gray-100">{current.text}</pre>
                            <button
                                type="button"
                                onClick={() => {
                                    clearLastOutbound();
                                    refresh();
                                }}
                                className="min-h-[44px] self-start rounded-lg px-2 text-sm font-semibold text-gray-700 dark:text-gray-300"
                            >
                                {t('aiBoundary.clear')}
                            </button>
                        </>
                    )}
                </div>
            </details>
        </div>
    );
}
