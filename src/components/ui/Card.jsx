/** Surface card (design: 18 px radius, hairline shadow). */
export default function Card({ as: Tag = 'div', padded = true, className = '', children, ...rest }) {
    return (
        <Tag className={`rounded-[18px] bg-surface shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line ${padded ? 'px-4 py-3' : ''} ${className}`} {...rest}>
            {children}
        </Tag>
    );
}
