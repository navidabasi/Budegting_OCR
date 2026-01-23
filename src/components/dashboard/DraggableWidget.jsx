import { useState } from 'react';
import { GripVertical } from 'lucide-react';

export default function DraggableWidget({ 
    widgetId, 
    children, 
    isDragging = false, 
    onDragStart, 
    onDragEnd,
    onDragOver,
    onDrop,
    isCustomizing = false
}) {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragStart = (e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ widgetId }));
        e.dataTransfer.effectAllowed = 'move';
        if (onDragStart) onDragStart(widgetId);
    };

    const handleDragEnd = (e) => {
        setIsDragOver(false);
        if (onDragEnd) onDragEnd();
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (!isDragOver) {
            setIsDragOver(true);
        }
        if (onDragOver) onDragOver(e, widgetId);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsDragOver(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            if (data.widgetId && data.widgetId !== widgetId && onDrop) {
                onDrop(data.widgetId, widgetId);
            }
        } catch (err) {
            console.error('Failed to parse drop data:', err);
        }
    };

    return (
        <div
            draggable={isCustomizing}
            onDragStart={isCustomizing ? handleDragStart : undefined}
            onDragEnd={isCustomizing ? handleDragEnd : undefined}
            onDragOver={isCustomizing ? handleDragOver : undefined}
            onDragLeave={isCustomizing ? handleDragLeave : undefined}
            onDrop={isCustomizing ? handleDrop : undefined}
            className={`relative transition-all ${isCustomizing ? 'cursor-move' : ''} ${isDragOver ? 'opacity-50' : ''} ${isDragging ? 'opacity-30' : ''}`}
            style={{
                transform: isDragOver ? 'translateY(4px)' : 'translateY(0)'
            }}
        >
            {isCustomizing && (
                <div className="absolute -left-2 top-2 z-10 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <GripVertical size={20} />
                </div>
            )}
            {children}
        </div>
    );
}
