import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'
import { queryClient } from './data/queryClient'
import './index.css'
import { loadLanguage } from './languages'
import { useAppStore } from './store/appStore'
import { registerServiceWorker } from './services/swUpdate'

// Wait for the persisted language pack (small, loaded in parallel with the app) so the first paint is already translated
const ready = Promise.race([loadLanguage(useAppStore.getState().languageCode), new Promise((r) => setTimeout(r, 1500))]);

// The installed app follows every deploy (production only: the dev server has no service worker)
if (import.meta.env.PROD) registerServiceWorker()

function start() {
try {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
        throw new Error('Root element not found');
    }

    const root = ReactDOM.createRoot(rootElement);

    root.render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <ErrorBoundary>
                    <App />
                </ErrorBoundary>
            </QueryClientProvider>
        </React.StrictMode>
    );
} catch (error) {
    console.error('Error rendering app:', error);

    const rootElement = document.getElementById('root');
    if (rootElement) {
        rootElement.replaceChildren();

        const wrapper = document.createElement('div');
        wrapper.style.padding = '20px';
        wrapper.style.fontFamily = 'sans-serif';
        wrapper.style.background = 'white';
        wrapper.style.border = '2px solid red';
        wrapper.style.margin = '20px';

        const heading = document.createElement('h1');
        heading.style.color = 'red';
        heading.textContent = 'Error Loading App';

        const errorMessage = document.createElement('p');
        errorMessage.textContent = `Error: ${error.message}`;

        const errorType = document.createElement('p');
        errorType.textContent = `Type: ${error.name}`;

        const stack = document.createElement('pre');
        stack.style.background = '#f5f5f5';
        stack.style.padding = '10px';
        stack.style.overflow = 'auto';
        stack.style.maxHeight = '400px';
        stack.textContent = error.stack || 'No stack trace';

        wrapper.append(heading, errorMessage, errorType, stack);
        rootElement.appendChild(wrapper);
    }
}
}

ready.finally(start);
