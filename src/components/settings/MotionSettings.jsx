import { useAppStore } from '../../store/appStore';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { MOTION_MODES } from '../../utils/motion';
import { useTranslation } from '../../languages/useTranslation';

/** Settings > Appearance > Reduce motion: follow the device (default), always reduce, or keep the full motion. */
export default function MotionSettings() {
    const { t } = useTranslation();
    const mode = useAppStore((s) => s.motionMode);
    const setMode = useAppStore((s) => s.setMotionMode);
    const reduced = useReducedMotion();
    return (
        <fieldset className="flex flex-col gap-1" data-testid="motion-settings">
            <legend className="text-sm font-medium text-gray-900 dark:text-white">{t('motion.title')}</legend>
            <p className="text-xs text-gray-600 dark:text-gray-400">{t('motion.hint')}</p>
            <div className="mt-1 flex flex-col">
                {MOTION_MODES.map((m) => (
                    <label key={m} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-gray-900 dark:text-white">
                        <input type="radio" name="motion-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="h-5 w-5 accent-[#00573F]" />
                        {t(`motion.${m}`)}
                    </label>
                ))}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400" data-testid="motion-state">{reduced ? t('motion.nowReduced') : t('motion.nowFull')}</p>
        </fieldset>
    );
}
