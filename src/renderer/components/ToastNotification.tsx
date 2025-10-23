// Toast Notification System for EVIA Desktop
import React, { useState, useEffect } from 'react';

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success' | 'warning' | 'info';
  duration?: number; // ms, default 5000
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
    duration: duration || 5000
  };
  toastSubscribers.forEach(fn => fn(toast));
};

export const ToastContainer: React.FC<ToastContainerProps> = ({ position = 'top-right' }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handleNewToast = (toast: Toast) => {
      setToasts(prev => [...prev, toast]);
      
      // Auto-remove after duration
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, toast.duration || 5000);
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

  const getPositionStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxWidth: '400px',
    };

    switch (position) {
      case 'top-right':
        return { ...base, top: '20px', right: '20px' };
      case 'top-center':
        return { ...base, top: '20px', left: '50%', transform: 'translateX(-50%)' };
      case 'bottom-right':
        return { ...base, bottom: '20px', right: '20px' };
      case 'bottom-center':
        return { ...base, bottom: '20px', left: '50%', transform: 'translateX(-50%)' };
      default:
        return { ...base, top: '20px', right: '20px' };
    }
  };

  const getToastStyle = (type: Toast['type']): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: '12px 16px',
      borderRadius: '8px',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 8px 16px rgba(0, 0, 0, 0.3)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      color: 'white',
      fontSize: '13px',
      fontWeight: '500',
      cursor: 'pointer',
      animation: 'slideIn 0.3s ease-out',
      border: '1px solid rgba(255, 255, 255, 0.1)',
    };

    switch (type) {
      case 'error':
        return { ...base, background: 'rgba(255, 59, 48, 0.9)' };
      case 'success':
        return { ...base, background: 'rgba(52, 199, 89, 0.9)' };
      case 'warning':
        return { ...base, background: 'rgba(255, 159, 10, 0.9)' };
      case 'info':
        return { ...base, background: 'rgba(10, 132, 255, 0.9)' };
      default:
        return { ...base, background: 'rgba(10, 132, 255, 0.9)' };
    }
  };

  const getIcon = (type: Toast['type']): string => {
    switch (type) {
      case 'error': return '❌';
      case 'success': return '✅';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return 'ℹ️';
    }
  };

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
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
            <span style={{ fontSize: '16px' }}>{getIcon(toast.type)}</span>
            <span style={{ flex: 1 }}>{toast.message}</span>
            <span style={{ fontSize: '18px', opacity: 0.7, cursor: 'pointer' }}>×</span>
          </div>
        ))}
      </div>
    </>
  );
};

