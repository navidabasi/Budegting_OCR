import { useState, useCallback } from 'react';

/**
 * Custom hook for handling async operations with loading and error states
 * @param {Function} asyncFunction - The async function to execute
 * @returns {Object} { execute, loading, error }
 */
export function useAsync(asyncFunction) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const execute = useCallback(async (...args) => {
        setLoading(true);
        setError(null);
        try {
            const result = await asyncFunction(...args);
            return result;
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [asyncFunction]);

    return { execute, loading, error };
}
