import React from 'react';
import { createRoot } from 'react-dom/client';
import { EviaOverlay } from './components/EviaOverlay';

// Initialize React app
const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(React.createElement(EviaOverlay));
} else {
    console.error('Root container not found');
}
