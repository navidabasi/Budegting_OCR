/**
 * PageLayout - Reusable page container with consistent padding and spacing
 * Used across all pages to maintain consistent layout
 */
export default function PageLayout({ children, className = '' }) {
    return (
        <div className={`pb-24 px-4 pt-4 md:pt-0 safe-area-top ${className}`}>
            {children}
        </div>
    );
}
