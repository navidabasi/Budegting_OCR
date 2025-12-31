console.log('main.jsx module started loading');

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

console.log('All imports loaded successfully');

try {
    console.log('Looking for root element...');
    const rootElement = document.getElementById('root');
    if (!rootElement) {
        throw new Error('Root element not found');
    }
    console.log('Root element found, creating React root...');
    
    const root = ReactDOM.createRoot(rootElement);
    console.log('React root created, rendering App...');
    
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
    console.log('App rendered successfully!');
} catch (error) {
    console.error('Error rendering app:', error);
    console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
    });
    const rootElement = document.getElementById('root');
    if (rootElement) {
        rootElement.innerHTML = `
            <div style="padding: 20px; font-family: sans-serif; background: white; border: 2px solid red; margin: 20px;">
                <h1 style="color: red;">Error Loading App</h1>
                <p><strong>Error:</strong> ${error.message}</p>
                <p><strong>Type:</strong> ${error.name}</p>
                <pre style="background: #f5f5f5; padding: 10px; overflow: auto; max-height: 400px;">${error.stack || 'No stack trace'}</pre>
            </div>
        `;
    }
}

