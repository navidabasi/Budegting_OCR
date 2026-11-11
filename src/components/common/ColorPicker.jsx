import { useState } from 'react';
import { Check } from 'lucide-react';

const PRESET_COLORS = [
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Green', value: '#10b981' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Yellow', value: '#f59e0b' },
    { name: 'Purple', value: '#8b5cf6' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Gray', value: '#6b7280' },
    { name: 'Indigo', value: '#6366f1' }
];

export default function ColorPicker({ value = '#3b82f6', onChange, label = 'Color' }) {
    const [selectedColor, setSelectedColor] = useState(value);
    const [customColor, setCustomColor] = useState(value);
    const [showCustom, setShowCustom] = useState(!PRESET_COLORS.some(c => c.value === value));

    const handlePresetSelect = (colorValue) => {
        setSelectedColor(colorValue);
        setCustomColor(colorValue);
        setShowCustom(false);
        onChange(colorValue);
    };

    const handleCustomChange = (e) => {
        const newColor = e.target.value;
        setCustomColor(newColor);
        setSelectedColor(newColor);
        setShowCustom(true);
        onChange(newColor);
    };

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-white mb-2">
                {label}
            </label>
            
            {/* Preset Colors */}
            <div className="flex flex-wrap gap-2 mb-3">
                {PRESET_COLORS.map((color) => (
                    <button
                        key={color.value}
                        type="button"
                        onClick={() => handlePresetSelect(color.value)}
                        className={`w-10 h-10 rounded-lg border-2 transition-all ${
                            selectedColor === color.value
                                ? 'border-gray-900 dark:border-gray-100 scale-110'
                                : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                        style={{ backgroundColor: color.value }}
                        title={color.name}
                    >
                        {selectedColor === color.value && (
                            <Check 
                                size={20} 
                                className="text-white mx-auto"
                                className="color-swatch-shadow"
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* Custom Color Input */}
            <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 dark:text-gray-300">Custom:</label>
                <div className="flex items-center gap-2 flex-1">
                    <input
                        type="color"
                        value={customColor}
                        onChange={handleCustomChange}
                        className="h-11 w-12 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                    />
                    <input
                        type="text"
                        value={customColor}
                        onChange={handleCustomChange}
                        placeholder="#3b82f6"
                        className="flex-1 input text-sm font-mono"
                        pattern="^#[0-9A-Fa-f]{6}$"
                    />
                </div>
            </div>

            {/* Color Preview */}
            <div className="mt-2 p-3 rounded-lg border border-gray-200 dark:border-gray-600 color-picker-preview" style={{ backgroundColor: selectedColor + '20' }}>
                <div className="flex items-center gap-2">
                    <div 
                        className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 color-swatch"
                        style={{ backgroundColor: selectedColor }}
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        Preview: {selectedColor}
                    </span>
                </div>
            </div>
        </div>
    );
}
