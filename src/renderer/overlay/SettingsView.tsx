import React, { useEffect, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';

interface SettingsViewProps {
  language: 'de' | 'en';
  onToggleLanguage: () => void;
  onClose?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ language, onToggleLanguage, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [shortcuts, setShortcuts] = useState<{ [key: string]: string }>({});
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState<{ id: number; title: string; is_default: boolean }[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);

  useEffect(() => {
    // Simulate loading data
    setTimeout(() => {
      setShortcuts({
        toggleVisibility: 'Cmd+\\',
        nextStep: 'Cmd+Enter',
        scrollUp: 'Cmd+Up',
        scrollDown: 'Cmd+Down',
      });
      setPresets([
        { id: 1, title: 'Default Preset', is_default: 1 },
        { id: 2, title: 'Custom Preset 1', is_default: 0 },
      ]);
      setSelectedPreset(2);
      setIsLoading(false);
    }, 1000);
  }, []);

  const togglePresets = () => setShowPresets(!showPresets);

  const handlePresetSelect = (presetId: number) => {
    setSelectedPreset(presetId);
  };

  const handleToggleAutoUpdate = () => {
    setAutoUpdateEnabled(!autoUpdateEnabled);
  };

  const renderShortcutKeys = (accelerator: string) => {
    const keyMap: { [key: string]: string } = {
      Cmd: '⌘',
      Command: '⌘',
      Ctrl: '⌃',
      Alt: '⌥',
      Shift: '⇧',
      Enter: '↵',
      Up: '↑',
      Down: '↓',
      Left: '←',
      Right: '→',
    };
    return accelerator.split('+').map((key, index) => (
      <span key={index} className="shortcut-key">
        {keyMap[key] || key}
      </span>
    ));
  };

  if (isLoading) {
    return (
      <div className="settings-container" style={{ background: '#1e1e1e', borderRadius: '12px', padding: '16px' }}>
        <div className="loading-state" style={{ textAlign: 'center', color: 'white' }}>
          <div className="loading-spinner"></div>
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  // Glass parity: Settings hover behavior (SettingsView.js:1048-1056)
  const handleMouseEnter = () => {
    console.log('[SettingsView] Mouse entered - canceling hide');
    (window as any).evia?.windows?.cancelHideSettingsWindow?.();
  };

  const handleMouseLeave = () => {
    console.log('[SettingsView] Mouse left - requesting hide');
    (window as any).evia?.windows?.hideSettingsWindow?.();
  };

  return (
    <div
      className="settings-container"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        background: 'rgba(0, 0, 0, 0.7)', // Slightly darker background
        borderRadius: '12px',
        padding: '16px',
        color: 'white',
        width: '100%',
        maxWidth: '600px', // Slightly increased width for better layout
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)', // Adjusted shadow for balance
        position: 'relative',
      }}
    >
      {/* Close button - Glass parity */}
      <button 
        className="close-button" 
        onClick={() => (window as any).evia?.closeWindow?.('settings')}
        title="Close"
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <div className="header-section" style={{ marginBottom: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '8px' }}>
        <h1 className="app-title" style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Settings</h1>
        <div className="account-info" style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>Account: Not Logged In</div>
      </div>

      <div className="shortcuts-section" style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>Shortcuts</h2>
        {Object.entries(shortcuts).map(([name, accelerator]) => (
          <div key={name} className="shortcut-item" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span className="shortcut-name" style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>
              {name.replace(/([A-Z])/g, ' $1')}
            </span>
            <div className="shortcut-keys" style={{ display: 'flex', gap: '4px' }}>
              {renderShortcutKeys(accelerator)}
            </div>
          </div>
        ))}
      </div>

      <div className="preset-section" style={{ marginBottom: '16px' }}>
        <div className="preset-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span className="preset-title" style={{ fontSize: '14px', fontWeight: 'bold' }}>
            My Presets
            <span className="preset-count" style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)', marginLeft: '4px' }}>
              ({presets.filter((p) => p.is_default === 0).length})
            </span>
          </span>
          <span
            className="preset-toggle"
            onClick={togglePresets}
            style={{
              fontSize: '12px',
              color: 'rgba(255, 255, 255, 0.7)',
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: '4px',
              transition: 'background-color 0.2s',
            }}
          >
            {showPresets ? '▼' : '▶'}
          </span>
        </div>

        {showPresets && (
          <div className="preset-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {presets.filter((p) => p.is_default === 0).length === 0 ? (
              <div className="no-presets-message" style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center' }}>
                No custom presets yet.
              </div>
            ) : (
              presets
                .filter((p) => p.is_default === 0)
                .map((preset) => (
                  <div
                    key={preset.id}
                    className={`preset-item ${selectedPreset === preset.id ? 'selected' : ''}`}
                    onClick={() => handlePresetSelect(preset.id)}
                    style={{
                      padding: '8px',
                      background: selectedPreset === preset.id ? 'rgba(0, 122, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    <span className="preset-name" style={{ fontSize: '12px', color: 'white' }}>{preset.title}</span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      <div className="buttons-section" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          className="settings-button"
          onClick={handleToggleAutoUpdate}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '4px',
            color: 'white',
            padding: '8px',
            fontSize: '12px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          Automatic Updates: {autoUpdateEnabled ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  );
};

export default SettingsView;
