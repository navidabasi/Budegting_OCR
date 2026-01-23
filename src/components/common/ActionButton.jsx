import Button from './Button';

/**
 * ActionButton - Reusable button with icon and text
 * Used for header actions like "New Group", "Filters", etc.
 */
export default function ActionButton({
    icon: Icon,
    children,
    onClick,
    variant = 'primary',
    size = 'sm',
    iconSize = 16,
    className = '',
    ...props
}) {
    const sizeClasses = {
        sm: 'text-sm px-3 py-1.5',
        md: 'px-4 py-2',
        lg: 'px-6 py-3 text-lg'
    };

    return (
        <Button
            variant={variant}
            onClick={onClick}
            className={`${sizeClasses[size]} flex items-center gap-1 ${className}`}
            {...props}
        >
            {Icon && <Icon size={iconSize} />}
            {children}
        </Button>
    );
}
