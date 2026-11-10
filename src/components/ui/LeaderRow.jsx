/** label · dotted leader · value. Value is any node (usually <Amount/>). */
export default function LeaderRow({ label, value, className = '', labelClassName = '', as: Tag = 'div' }) {
    return (
        <Tag className={`flex items-baseline text-sm text-ink ${className}`}>
            <span className={`min-w-0 truncate ${labelClassName}`}>{label}</span>
            <span className="lead" aria-hidden="true" />
            <span className="shrink-0">{value}</span>
        </Tag>
    );
}
