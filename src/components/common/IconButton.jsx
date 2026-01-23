import { forwardRef } from 'react';

/**
 * IconButton - Reusable icon-only button component
 * Used for header actions, settings buttons, etc.
 */
const IconButton = forwardRef(({
    icon: Icon,
    onClick,
    ariaLabel,
    title,
    size = 24,
    className = '',
    ...props
}, ref) => {
    return (
        <button
            ref={ref}
            onClick={onClick}
            className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${className}`}
            aria-label={ariaLabel}
            title={title || ariaLabel}
            {...props}
        >
            <Icon size={size} className="text-gray-600 dark:text-white" />
        </button>
    );
});

IconButton.displayName = 'IconButton';

export default IconButton;
