import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

const SIDES = ['top', 'bottom', 'left', 'right'];

/**
 * Optional step before a receipt photo is sent to the AI provider (Settings > AI & scanning > "Crop before sending"):
 * trim each side so only the receipt leaves the device. The preview is clipped with the same trims; the file is only
 * re-encoded when the owner confirms.
 */
export default function CropStep({ imageUrl, onConfirm, onSkip, onCancel }) {
    const { t } = useTranslation();
    const [trim, setTrim] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
    const [busy, setBusy] = useState(false);
    const pct = (k) => Math.round(trim[k] * 100);
    const clip = `inset(${pct('top')}% ${pct('right')}% ${pct('bottom')}% ${pct('left')}%)`;
    const confirm = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await onConfirm(trim);
        } finally {
            setBusy(false);
        }
    };
    return (
        <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-4 px-5 pb-[calc(env(safe-area-inset-bottom)+112px)] pt-[max(env(safe-area-inset-top),16px)]" data-testid="crop-step">
            <h1 className="font-display text-2xl font-bold text-ink">{t('aiBoundary.cropTitle')}</h1>
            <p className="text-sm text-ink-muted">{t('aiBoundary.cropHint')}</p>
            <div className="flex max-h-[44dvh] justify-center overflow-hidden rounded-2xl bg-tint p-2">
                {imageUrl ? <img src={imageUrl} alt={t('aiBoundary.cropPreview')} className="max-h-[42dvh] w-auto max-w-full object-contain" style={{ clipPath: clip }} /> : null}
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {SIDES.map((k) => (
                    <label key={k} className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-ink">
                        <span className="w-20 shrink-0">{t(`aiBoundary.trim.${k}`)}</span>
                        <input type="range" min="0" max="40" step="1" value={pct(k)} onChange={(e) => setTrim((s) => ({ ...s, [k]: Number(e.target.value) / 100 }))} className="h-11 min-w-0 flex-1 accent-forest" />
                        <span className="w-10 shrink-0 text-end tabular-nums text-ink-muted">{pct(k)}%</span>
                    </label>
                ))}
            </div>
            <div className="flex flex-col gap-2.5">
                <button type="button" onClick={confirm} disabled={busy} className="flex h-14 items-center justify-center gap-2 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-60">
                    {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
                    {t('aiBoundary.cropSend')}
                </button>
                <button type="button" onClick={onSkip} disabled={busy} className="flex h-12 items-center justify-center rounded-[18px] border border-line-strong bg-surface text-sm font-semibold text-ink">
                    {t('aiBoundary.cropSkip')}
                </button>
                <button type="button" onClick={onCancel} disabled={busy} className="flex h-11 items-center justify-center text-sm font-semibold text-ink-muted">
                    {t('common.actions.cancel')}
                </button>
            </div>
        </main>
    );
}
