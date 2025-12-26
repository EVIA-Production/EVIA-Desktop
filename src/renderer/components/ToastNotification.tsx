// Toast Notification System for EVIA Desktop
import React, { useState, useEffect } from 'react';

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success' | 'warning' | 'info';
  duration?: number; // ms, default 3000
}

interface ToastContainerProps {
  position?: 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center';
}

// Global toast queue
const toastSubscribers: ((toast: Toast) => void)[] = [];

export const showToast = (message: string, type: Toast['type'] = 'info', duration?: number) => {
  const toast: Toast = {
    id: `toast-${Date.now()}-${Math.random()}`,
    message,
    type,
    duration: duration || 3000 // 3 seconds default
  };
  toastSubscribers.forEach(fn => fn(toast));
};

export const ToastContainer: React.FC<ToastContainerProps> = ({ position = 'top-center' }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handleNewToast = (toast: Toast) => {
      setToasts(prev => [...prev, toast]);
      
      // Auto-remove after duration (3 seconds default)
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, toast.duration || 3000);
    };

    toastSubscribers.push(handleNewToast);

    return () => {
      const index = toastSubscribers.indexOf(handleNewToast);
      if (index > -1) toastSubscribers.splice(index, 1);
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // 🎨 REDESIGN: Centered text below header buttons
  // Positioned below "Fragen" & "Anzeigen" buttons
  const getPositionStyle = (): React.CSSProperties => {
    return {
      position: 'fixed',
      top: '42px', // Below header bar (height ~38px + 4px gap)
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      alignItems: 'center',
      pointerEvents: 'none', // Don't block clicks
    };
  };

  // 🎨 REDESIGN: Text-only style (no background, no border)
  // Font: 1px smaller than "Angemeldet als benekroetz" (which is ~11px)
  // Color: Same as settings text (rgba(255, 255, 255, 0.7))
  const getToastStyle = (type: Toast['type']): React.CSSProperties => {
    const base: React.CSSProperties = {
      color: 'rgba(255, 255, 255, 0.7)', // Settings text color
      fontSize: '10px', // 1px smaller than "Angemeldet als..." (11px)
      fontWeight: 400,
      cursor: 'default',
      animation: 'fadeIn 0.3s ease-out',
      textAlign: 'center' as any,
      whiteSpace: 'nowrap' as any,
      fontFamily: "'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      userSelect: 'none' as any,
      pointerEvents: 'auto', // Allow clicking to dismiss
    };

    // No background colors - pure text
    // Color already set to settings gray, same for all types
    return base;
  };

  // No icons - text only
  const getIcon = (type: Toast['type']): string => {
    return ''; // Empty - text only
  };

  return (
    <>
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <div style={getPositionStyle()}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={getToastStyle(toast.type)}
            onClick={() => removeToast(toast.id)}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </>
  );
};

