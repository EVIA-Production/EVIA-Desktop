import React from 'react';
import ReactDOM from 'react-dom/client';
import PermissionHeader from './PermissionHeader';

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

