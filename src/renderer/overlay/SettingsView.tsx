import React, { useEffect, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { i18n } from '../i18n/i18n';

interface SettingsViewProps {
  language: 'de' | 'en';
  onToggleLanguage: () => void;
  onClose?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ language, onToggleLanguage, onClose }) => {
  const [accountInfo, setAccountInfo] = useState<string>('Not Logged In');
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState<any[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<any>(null);
  const [isInvisible, setIsInvisible] = useState(false);

  // Fetch account info on mount
  useEffect(() => {
    const fetchAccountInfo = async () => {
      try {
        const eviaAuth = (window as any).evia?.auth;
        if (eviaAuth?.validate) {
          const result = await eviaAuth.validate();
          if (result && result.authenticated && result.user) {
            setAccountInfo(`Logged in as ${result.user.email || result.user.username}`);
          }
        }
      } catch (error) {
        console.error('[SettingsView] Failed to fetch account info:', error);
      }
    };
    fetchAccountInfo();
  }, []);

  // Handlers
  const handleLogout = async () => {
    console.log('[SettingsView] 🚪 Logout clicked');
    try {
      await (window as any).evia?.auth?.logout?.();
      console.log('[SettingsView] ✅ Logout successful');
    } catch (error) {
      console.error('[SettingsView] ❌ Logout failed:', error);
    }
  };

  const handleQuit = async () => {
    console.log('[SettingsView] 🛑 Quit clicked');
    try {
      await (window as any).evia?.app?.quit?.();
      console.log('[SettingsView] ✅ Quit initiated');
    } catch (error) {
      console.error('[SettingsView] ❌ Quit failed:', error);
    }
  };

  const handlePersonalize = () => {
    console.log('[SettingsView] 📝 Personalize clicked - opening web app');
    // TODO: Open web app in browser for personalization
  };

  const handleToggleAutoUpdate = () => {
    setAutoUpdateEnabled(!autoUpdateEnabled);
    console.log('[SettingsView] 🔄 Auto-update:', !autoUpdateEnabled);
  };

  const handleMoveLeft = () => {
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.nudgeHeader) {
      eviaWindows.nudgeHeader(-10, 0);
    }
  };

  const handleMoveRight = () => {
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.nudgeHeader) {
      eviaWindows.nudgeHeader(10, 0);
    }
  };

  const handleToggleInvisibility = () => {
    setIsInvisible(!isInvisible);
    console.log('[SettingsView] 👻 Invisibility:', !isInvisible);
    // TODO: Implement invisibility toggle via IPC
  };

  const handleEditShortcuts = () => {
    console.log('[SettingsView] ⌨️ Edit Shortcuts clicked');
    // TODO: Open shortcuts editing modal/window
  };

  const handleChangeSttModel = () => {
    console.log('[SettingsView] 🎤 Change STT Model clicked');
    // TODO: Open STT model selector
  };

  return (
    <div className="settings-container">
      {/* Header Section */}
      <div className="header-section">
        <div className="title-line">
          <div>
            <h1 className="app-title">EVIA</h1>
            <p className="account-info">{accountInfo}</p>
          </div>
          <div className={`invisibility-icon ${isInvisible ? 'visible' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
        </div>
      </div>

      {/* Language Selection */}
      <div className="language-section">
        <label className="language-label">Language</label>
        <div className="language-toggle">
          <button
            className={`language-button ${language === 'de' ? 'active' : ''}`}
            onClick={() => language !== 'de' && onToggleLanguage()}
          >
            Deutsch
          </button>
          <button
            className={`language-button ${language === 'en' ? 'active' : ''}`}
            onClick={() => language !== 'en' && onToggleLanguage()}
          >
            English
          </button>
        </div>
      </div>

      {/* STT Model Section */}
      <div className="model-section">
        <label className="model-label">STT Model</label>
        <button className="settings-button full-width" onClick={handleChangeSttModel}>
          <span>Nova-3 (General)</span>
        </button>
        <button className="settings-button full-width" onClick={handleEditShortcuts}>
          <span>Edit Shortcuts</span>
        </button>
      </div>

      {/* Shortcuts Section */}
      <div className="shortcuts-section">
        <div className="shortcut-item">
          <span className="shortcut-name">Show / Hide</span>
          <div className="shortcut-keys">
            <span className="cmd-key">⌘</span>
            <span className="shortcut-key">\</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">Ask Anything</span>
          <div className="shortcut-keys">
            <span className="cmd-key">⌘</span>
            <span className="shortcut-key">↵</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">Scroll Up Response</span>
          <div className="shortcut-keys">
            <span className="cmd-key">⌘</span>
            <span className="cmd-key">⇧</span>
            <span className="shortcut-key">↑</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">Scroll Down Response</span>
          <div className="shortcut-keys">
            <span className="cmd-key">⌘</span>
            <span className="cmd-key">⇧</span>
            <span className="shortcut-key">↓</span>
          </div>
        </div>
      </div>

      {/* My Presets Section */}
      <div className="preset-section">
        <div className="preset-header">
          <div>
            <span className="preset-title">My Presets</span>
            <span className="preset-count">({presets.filter(p => !p.is_default).length})</span>
          </div>
          <span className="preset-toggle" onClick={() => setShowPresets(!showPresets)}>
            {showPresets ? '▼' : '▶'}
          </span>
        </div>
        <div className={`preset-list ${showPresets ? '' : 'hidden'}`}>
          {presets.filter(p => !p.is_default).length === 0 ? (
            <div className="no-presets-message">
              No custom presets yet.<br />
              <span className="web-link" onClick={handlePersonalize}>
                Create your first preset
              </span>
            </div>
          ) : (
            presets.filter(p => !p.is_default).map(preset => (
              <div
                key={preset.id}
                className={`preset-item ${selectedPreset?.id === preset.id ? 'selected' : ''}`}
                onClick={() => setSelectedPreset(preset)}
              >
                <span className="preset-name">{preset.title}</span>
                {selectedPreset?.id === preset.id && <span className="preset-status">Selected</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="buttons-section">
        <button className="settings-button full-width" onClick={handlePersonalize}>
          <span>Personalize / Meeting Notes</span>
        </button>
        <button className="settings-button full-width" onClick={handleToggleAutoUpdate}>
          <span>Automatic Updates: {autoUpdateEnabled ? 'On' : 'Off'}</span>
        </button>

        <div className="move-buttons">
          <button className="settings-button half-width" onClick={handleMoveLeft}>
            <span>← Move</span>
          </button>
          <button className="settings-button half-width" onClick={handleMoveRight}>
            <span>Move →</span>
          </button>
        </div>

        <button className="settings-button full-width" onClick={handleToggleInvisibility}>
          <span>Enable Invisibility</span>
        </button>

        <div className="bottom-buttons">
          <button className="settings-button half-width" onClick={handleLogout}>
            <span>Login</span>
          </button>
          <button className="settings-button half-width danger" onClick={handleQuit}>
            <span>Quit</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
