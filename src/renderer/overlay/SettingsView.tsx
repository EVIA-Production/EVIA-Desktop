import React, { useEffect, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { i18n } from '../i18n/i18n';
import { FRONTEND_URL } from '../config/config';

interface SettingsViewProps {
  language: 'de' | 'en';
  onToggleLanguage: () => void;
  onClose?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ language, onToggleLanguage, onClose }) => {
  const [accountInfo, setAccountInfo] = useState<string>('');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
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
            const email = result.user.email || result.user.username;
            setAccountInfo(email);
            setIsLoggedIn(true);
          } else {
            setAccountInfo('');
            setIsLoggedIn(false);
          }
        }
      } catch (error) {
        console.error('[SettingsView] Failed to fetch account info:', error);
        setAccountInfo('');
        setIsLoggedIn(false);
      }
    };
    fetchAccountInfo();
  }, []);

  // 🔧 FIX ISSUE #2: Load auto-update setting on mount
  useEffect(() => {
    const loadAutoUpdateSetting = async () => {
      try {
        const eviaIpc = (window as any).evia?.ipc;
        const result = await eviaIpc?.invoke('settings:get-auto-update');
        if (result?.enabled !== undefined) {
          setAutoUpdateEnabled(result.enabled);
          console.log('[SettingsView] ✅ Loaded auto-update setting:', result.enabled);
        }
      } catch (error) {
        console.error('[SettingsView] ❌ Failed to load auto-update setting:', error);
      }
    };
    loadAutoUpdateSetting();
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

  const handlePersonalize = async () => {
    console.log('[SettingsView] 📝 Personalize / Meeting Notes clicked - opening /activity');
    const eviaWindows = (window as any).evia?.windows;
    const eviaAuth = (window as any).evia?.auth;
    if (!eviaWindows?.openExternal) return;
    
    try {
      const token = await eviaAuth?.getToken?.();
      if (token) {
        eviaWindows.openExternal(`${FRONTEND_URL}/activity?desktop_token=${encodeURIComponent(token)}`);
      } else {
        eviaWindows.openExternal(`${FRONTEND_URL}/activity`);
      }
    } catch (error) {
      console.error('[SettingsView] Error getting token:', error);
      eviaWindows.openExternal(`${FRONTEND_URL}/activity`);
    }
  };
  
  const handleCreatePreset = async () => {
    console.log('[SettingsView] ➕ Create first preset clicked - opening /personalize');
    const eviaWindows = (window as any).evia?.windows;
    const eviaAuth = (window as any).evia?.auth;
    if (!eviaWindows?.openExternal) return;
    
    try {
      const token = await eviaAuth?.getToken?.();
      if (token) {
        eviaWindows.openExternal(`${FRONTEND_URL}/personalize?desktop_token=${encodeURIComponent(token)}`);
      } else {
        eviaWindows.openExternal(`${FRONTEND_URL}/personalize`);
      }
    } catch (error) {
      console.error('[SettingsView] Error getting token:', error);
      eviaWindows.openExternal(`${FRONTEND_URL}/personalize`);
    }
  };

  // 🔧 FIX ISSUE #2: Persist auto-update toggle via IPC
  const handleToggleAutoUpdate = async () => {
    const newState = !autoUpdateEnabled;
    setAutoUpdateEnabled(newState);
    console.log('[SettingsView] 🔄 Auto-update:', newState);
    
    // Persist to main process
    try {
      const eviaIpc = (window as any).evia?.ipc;
      await eviaIpc?.invoke('settings:set-auto-update', newState);
      console.log('[SettingsView] ✅ Auto-update persisted:', newState);
    } catch (error) {
      console.error('[SettingsView] ❌ Failed to persist auto-update:', error);
      // Revert UI state on failure
      setAutoUpdateEnabled(!newState);
    }
  };

  const handleMoveLeft = () => {
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.nudgeHeader) {
      // 🔧 FIX: Increased from -10 to -50 to match arrow key movement distance
      eviaWindows.nudgeHeader(-50, 0);
    }
  };

  const handleMoveRight = () => {
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.nudgeHeader) {
      // 🔧 FIX: Increased from 10 to 50 to match arrow key movement distance
      eviaWindows.nudgeHeader(50, 0);
    }
  };

  const handleToggleInvisibility = async () => {
    const newState = !isInvisible;
    setIsInvisible(newState);
    console.log('[SettingsView] 👻 Invisibility:', newState);
    
    // 🔧 NEW: Implement invisibility via IPC
    try {
      const eviaWindows = (window as any).evia?.windows;
      if (eviaWindows?.setClickThrough) {
        await eviaWindows.setClickThrough(newState);
        console.log('[SettingsView] ✅ Click-through', newState ? 'enabled' : 'disabled');
      }
    } catch (error) {
      console.error('[SettingsView] ❌ Failed to toggle invisibility:', error);
    }
  };

  const handleEditShortcuts = () => {
    console.log('[SettingsView] ⌨️ Edit Shortcuts clicked');
    // 🔧 NEW: Open shortcuts window
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.show) {
      eviaWindows.show('shortcuts');
    }
  };

  const handleChangeSttModel = () => {
    console.log('[SettingsView] 🎤 Change STT Model clicked');
    // TODO: Open STT model selector modal
    // For now, just log
  };

  // Get translated strings
  const t = (key: string) => i18n.t(`overlay.settings.${key}`);

  return (
    <div className="settings-container">
      {/* Header Section */}
      <div className="header-section">
        <div className="title-line">
          <div>
            <h1 className="app-title">{t('title')}</h1>
            <p className={`account-info ${isLoggedIn ? 'logged-in' : ''}`}>
              {accountInfo 
                ? `${t('accountLoggedInAs')} ${accountInfo}` 
                : t('accountNotLoggedIn')}
            </p>
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
        <label className="language-label">{t('language')}</label>
        <div className="language-toggle">
          <button
            className={`language-button ${language === 'de' ? 'active' : ''}`}
            onClick={() => language !== 'de' && onToggleLanguage()}
          >
            {t('languageDeutsch')}
          </button>
          <button
            className={`language-button ${language === 'en' ? 'active' : ''}`}
            onClick={() => language !== 'en' && onToggleLanguage()}
          >
            {t('languageEnglish')}
          </button>
        </div>
      </div>

      {/* STT Model Section */}
      <div className="model-section">
        <label className="model-label">{t('sttModel')}</label>
        <button className="settings-button full-width" onClick={handleChangeSttModel}>
          <span>{t('sttModelNova3')}</span>
        </button>
        <button className="settings-button full-width" onClick={handleEditShortcuts}>
          <span>{t('editShortcuts')}</span>
        </button>
      </div>

      {/* Shortcuts Section */}
      <div className="shortcuts-section">
        <div className="shortcut-item">
          <span className="shortcut-name">{t('shortcutShowHide')}</span>
          <div className="shortcut-keys">
            <span className="cmd-key">⌘</span>
            <span className="shortcut-key">\</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">{t('shortcutAskAnything')}</span>
          <div className="shortcut-keys">
            <span className="cmd-key">⌘</span>
            <span className="shortcut-key">↵</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">{t('shortcutScrollUp')}</span>
          <div className="shortcut-keys">
            <span className="cmd-key">⌘</span>
            <span className="cmd-key">⇧</span>
            <span className="shortcut-key">↑</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">{t('shortcutScrollDown')}</span>
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
            <span className="preset-title">{t('myPresets')}</span>
            <span className="preset-count">({presets.filter(p => !p.is_default).length})</span>
          </div>
          <span className="preset-toggle" onClick={() => setShowPresets(!showPresets)}>
            {showPresets ? '▼' : '▶'}
          </span>
        </div>
        <div className={`preset-list ${showPresets ? '' : 'hidden'}`}>
          {presets.filter(p => !p.is_default).length === 0 ? (
            <div className="no-presets-message">
              {t('noPresetsMessage')}<br />
              <span className="web-link" onClick={handleCreatePreset}>
                {t('createFirstPreset')}
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
          <span>{t('personalizeButton')}</span>
        </button>
        <button className="settings-button full-width" onClick={handleToggleAutoUpdate}>
          <span>{autoUpdateEnabled ? t('automaticUpdatesOn') : t('automaticUpdatesOff')}</span>
        </button>

        <div className="move-buttons">
          <button className="settings-button half-width" onClick={handleMoveLeft}>
            <span>{t('moveLeft')}</span>
          </button>
          <button className="settings-button half-width" onClick={handleMoveRight}>
            <span>{t('moveRight')}</span>
          </button>
        </div>

        <button className="settings-button full-width" onClick={handleToggleInvisibility}>
          <span>{isInvisible ? t('disableInvisibility') : t('enableInvisibility')}</span>
        </button>

        <div className="bottom-buttons">
          {isLoggedIn ? (
            <button className="settings-button half-width" onClick={handleLogout}>
              <span>{t('logout')}</span>
            </button>
          ) : (
            <button className="settings-button half-width" onClick={() => {
              const eviaWindows = (window as any).evia?.windows;
              eviaWindows?.openExternal?.(`${FRONTEND_URL}/login?source=desktop`);
            }}>
              <span>{t('login')}</span>
            </button>
          )}
          <button className="settings-button half-width danger" onClick={handleQuit}>
            <span>{t('quit')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
