import React from 'react';
import { DB_NAME } from '../../data/db';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
        this.setState({ errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-lg w-full">
                        <h1 className="text-xl font-bold text-red-600 dark:text-red-400 mb-4">
                            Something went wrong
                        </h1>
                        <p className="text-gray-700 dark:text-gray-300 mb-4">
                            The app encountered an error. This might be due to browser security settings blocking required features.
                        </p>
                        <details className="mb-4">
                            <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400">
                                Error details
                            </summary>
                            <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-700 rounded text-xs overflow-auto max-h-40">
                                {this.state.error?.toString()}
                                {this.state.errorInfo?.componentStack}
                            </pre>
                        </details>
                        <div className="flex gap-2">
                            <button
                                onClick={() => window.location.reload()}
                                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Reload Page
                            </button>
                            <button
                                onClick={() => {
                                    // Clear the local IndexedDB mirror (and the legacy PGlite database) and reload
                                    indexedDB.deleteDatabase(DB_NAME);
                                    indexedDB.deleteDatabase('receipts-electric-v2');
                                    window.location.reload();
                                }}
                                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
                            >
                                Clear Data & Reload
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
