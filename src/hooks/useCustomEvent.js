import { useEffect } from 'react';

/**
 * Custom hook for listening to custom window events
 * @param {string} eventName - The event name to listen for
 * @param {Function} handler - The event handler function
 * @param {Array} deps - Dependencies array for the handler
 */
export function useCustomEvent(eventName, handler, deps = []) {
    useEffect(() => {
        window.addEventListener(eventName, handler);
        return () => {
            window.removeEventListener(eventName, handler);
        };
    }, [eventName, handler, ...deps]);
}
