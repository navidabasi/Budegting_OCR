import Card from './Card';

/**
 * SettingsCard - Reusable card component for settings sections
 * Displays icon, title, and content in a consistent format
 */
export default function SettingsCard({ 
    icon: Icon, 
    title, 
    children,
    iconColor = 'text-primary-600',
    className = '' 
}) {
    return (
        <Card className={className}>
            <div className="flex items-center gap-3 mb-4">
                {Icon && <Icon className={iconColor} size={20} />}
                <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
            </div>
            {children}
        </Card>
    );
}
