/**
 * Segmented control. options: [{ value, label, tone? }] where tone is income | savings for coloured labels.
 */
const TONE_TEXT = { income: 'text-income', savings: 'text-savings' };

export default function Segmented({ options, value, onChange, ariaLabel, className = '', fill = false }) {
    return (
        <div role="radiogroup" aria-label={ariaLabel} className={`${fill ? 'flex w-full' : 'inline-flex'} gap-0.5 rounded-[14px] bg-line p-[3px] ${className}`}>
            {options.map((o) => {
                const on = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(o.value)}
                        className={`h-11 min-w-[44px] rounded-[11px] px-3.5 text-sm ${fill ? 'flex-1' : ''} transition-colors duration-press ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink ${
                            on ? 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(16,33,27,.1)]' : `font-medium ${TONE_TEXT[o.tone] || 'text-ink-muted'}`
                        }`}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
