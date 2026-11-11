import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

/**
 * The one page header: optional back button, eyebrow, title, right-side actions and an optional row below (period switcher).
 * `back`: a path to go to when there is no history entry to return to (opened from a link or a fresh tab), or true for "-1 or /".
 */
export default function PageHeader({ title, eyebrow = null, back = null, actions = null, children = null, className = '', titleClassName = '' }) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const goBack = () => {
        const fallback = typeof back === 'string' ? back : '/';
        if (window.history.state?.idx > 0) navigate(-1);
        else navigate(fallback, { replace: true });
    };
    return (
        <header className={`flex flex-col gap-2 pt-4 ${className}`}>
            <div className="flex items-end justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                    {back ? (
                        <button type="button" onClick={goBack} aria-label={t('common.actions.back')} className="-ms-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink" data-testid="page-back">
                            <ChevronLeft size={24} className="rtl:rotate-180" aria-hidden="true" />
                        </button>
                    ) : null}
                    <div className="flex min-w-0 flex-col gap-0.5">
                        {eyebrow ? <span className="truncate text-xs font-semibold uppercase tracking-[.08em] text-ink-muted">{eyebrow}</span> : null}
                        <h1 className={`truncate font-display text-[28px] font-bold leading-[1.1] tracking-tight text-ink ${titleClassName}`}>{title}</h1>
                    </div>
                </div>
                {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            </div>
            {children}
        </header>
    );
}
