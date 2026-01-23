/**
 * Card - Reusable card component
 * Provides consistent card styling with optional variants
 */
export default function Card({ 
    children, 
    className = '',
    interactive = false,
    onClick = null,
    hover = false
}) {
    const baseClasses = 'card';
    const interactiveClasses = interactive || onClick 
        ? 'cursor-pointer hover:shadow-lg transition-all' 
        : '';
    const hoverClasses = hover ? 'hover:shadow-lg transition-shadow' : '';

    return (
        <div 
            className={`${baseClasses} ${interactiveClasses} ${hoverClasses} ${className}`}
            onClick={onClick}
        >
            {children}
        </div>
    );
}
