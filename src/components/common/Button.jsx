export default function Button({
    children,
    onClick,
    variant = 'primary',
    disabled = false,
    className = '',
    type = 'button',
    ...props
}) {
    const baseClasses = 'btn';
    const variantClasses = {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
        danger: 'btn-danger'
    };

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={`${baseClasses} ${variantClasses[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
}

