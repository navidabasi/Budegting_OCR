import { Lightbulb } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

/**
 * General tips under an answer (assistant v2, A-T5): advice that does not come from the owner's data. A dashed outline sets it
 * apart from the evidence card (solid border, the owner's records) so a tip is never mistaken for a computed figure.
 */
export default function GeneralTips({ tips }) {
    const { t } = useTranslation();
    if (!Array.isArray(tips) || tips.length === 0) return null;
    return (
        <section className="flex w-full flex-col gap-1.5 rounded-2xl border border-dashed border-line-strong px-3.5 py-3" aria-label={t('chat.generalTips')} data-testid="general-tips">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                <Lightbulb size={13} className="shrink-0" aria-hidden="true" />
                {t('chat.generalTips')}
            </h3>
            <ul className="flex list-disc flex-col gap-1 ps-5 text-sm leading-snug text-ink marker:text-ink-faint">
                {tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                ))}
            </ul>
        </section>
    );
}
