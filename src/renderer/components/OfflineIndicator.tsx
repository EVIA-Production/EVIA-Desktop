// Offline Mode Indicator - Shows when backend is unavailable
import React, { useState, useEffect } from 'react';
import { connectionMonitor, ConnectionStatus } from '../services/connectionMonitor';

export const OfflineIndicator: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(connectionMonitor.getStatus());

  useEffect(() => {
    const handleStatusChange = (newStatus: ConnectionStatus) => {
      setStatus(newStatus);
    };

    connectionMonitor.subscribe(handleStatusChange);
    connectionMonitor.start();

    return () => {
      connectionMonitor.unsubscribe(handleStatusChange);
    };
  }, []);

  if (status.isOnline) {
    return null; // Don't show anything when online
  }

  // Hardcoded for now - i18n will be added properly later
  const title = 'No Connection';
  const subtitle = 'Reconnecting...';

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <span style={styles.icon}>⚠️</span>
        <div style={styles.text}>
          <div style={styles.title}>{title}</div>
          <div style={styles.subtitle}>{subtitle}</div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    position: 'fixed' as const,
    top: '55px',  // FIX: Moved down from 10px to 55px (below header ~47px + gap)
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 999998,
    maxWidth: '300px',
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    background: 'rgba(255, 159, 10, 0.95)',
    borderRadius: '8px',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
  },
  icon: {
    fontSize: '18px',
  },
  text: {
    flex: 1,
  },
  title: {
    color: 'white',
    fontSize: '13px',
    fontWeight: 600,
    marginBottom: '2px',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: '11px',
  },
};

