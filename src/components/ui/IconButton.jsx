import { forwardRef } from 'react';

/** Icon-only button, 44 px minimum. `label` is required (aria-label). */
const VARIANTS = {
    plain: 'bg-transparent text-ink',
    surface: 'bg-surface text-ink shadow-[0_1px_2px_rgba(16,33,27,.08)] dark:ring-1 dark:ring-line',
    primary: 'bg-forest text-white',
    danger: 'bg-transparent text-over-ink',
};

const IconButton = forwardRef(function IconButton({ icon: Icon, label, variant = 'plain', size = 20, className = '', children, ...rest }, ref) {
    return (
        <button
            ref={ref}
            type="button"
            aria-label={label}
            className={`inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full transition-colors duration-press ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-ink active:opacity-80 ${VARIANTS[variant] || VARIANTS.plain} ${className}`}
            {...rest}
        >
            {Icon ? <Icon size={size} aria-hidden="true" /> : null}
            {children}
        </button>
    );
});

export default IconButton;
