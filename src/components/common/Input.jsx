import { forwardRef } from 'react';

const Input = forwardRef(({
    label,
    type = 'text',
    placeholder,
    error,
    required = false,
    className = '',
    ...props
}, ref) => {
    return (
        <div className="mb-4">
            {label && (
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                </label>
            )}
            <input
                ref={ref}
                type={type}
                placeholder={placeholder}
                className={`input ${error ? 'border-red-500' : ''} ${type === 'date' ? 'max-w-full' : ''} ${className}`}
                style={type === 'date' ? { maxWidth: '100%', boxSizing: 'border-box' } : {}}
                {...props}
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        </div>
    );
});

Input.displayName = 'Input';

export default Input;

