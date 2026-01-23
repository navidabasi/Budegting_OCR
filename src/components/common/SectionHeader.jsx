/**
 * SectionHeader - Reusable section header component
 * Used for section titles within pages
 */
export default function SectionHeader({ 
    title, 
    subtitle = null,
    action = null,
    className = '' 
}) {
    return (
        <div className={`flex items-center justify-between mb-4 ${className}`}>
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {title}
                </h2>
                {subtitle && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {subtitle}
                    </p>
                )}
            </div>
            {action && (
                <div>
                    {action}
                </div>
            )}
        </div>
    );
}
