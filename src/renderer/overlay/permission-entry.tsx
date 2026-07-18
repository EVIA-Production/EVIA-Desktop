import React from 'react';
import ReactDOM from 'react-dom/client';
import PermissionHeader from './PermissionHeader';
import './overlay-glass.css';
import './liquid-glass.css';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.material = params.get('material') || 'custom';
document.documentElement.dataset.surface = params.get('surface') || 'modal';
document.documentElement.dataset.windowActive = document.hasFocus() ? 'true' : 'false';
window.addEventListener('focus', () => {
  document.documentElement.dataset.windowActive = 'true';
});
window.addEventListener('blur', () => {
  document.documentElement.dataset.windowActive = 'false';
});

const rootEl = document.getElementById('permission-root');

const App = () => {
  const handleContinue = () => {
    console.log('[PermissionEntry] All permissions granted, transitioning to main header...');
    // TODO: Phase 4 - HeaderController will handle this transition
    // For now, just log it
    if (window.evia?.permissions?.markComplete) {
      window.evia.permissions.markComplete();
    }
  };

  const handleClose = () => {
    console.log('[PermissionEntry] Close button clicked, quitting app');
    window.evia.app.quit();
  };

  return (
    <PermissionHeader
      onContinue={handleContinue}
      onClose={handleClose}
    />
  );
};

if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
