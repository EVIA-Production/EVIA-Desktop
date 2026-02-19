import React, { useEffect, useState } from 'react';
import './overlay-glass.css';
import { i18n } from '../i18n/i18n';

const WEB_APP_URL = 'https://app.taylos.ai';

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
  const [isSessionActive, setIsSessionActive] = useState(false);

  // FIX: Track session state to disable preset changes during recording
  useEffect(() => {
    const checkSessionState = () => {
      const sessionState = localStorage.getItem('evia_session_state');
      setIsSessionActive(sessionState === 'during');
    };
    
    // Check on mount
    checkSessionState();
    
    // Listen for session state changes
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.on('session-state-changed', (newState: string) => {
        // CRITICAL FIX: Also update localStorage in THIS window's context
        // Each Electron window has its own localStorage, so we must sync it here!
        localStorage.setItem('evia_session_state', newState);
        setIsSessionActive(newState === 'during');
      });
    }
    
    // Poll every second as backup
    const intervalId = setInterval(checkSessionState, 1000);
    
    return () => {
      clearInterval(intervalId);
      if (eviaIpc) {
        eviaIpc.off('session-state-changed');
      }
    };
  }, []);

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

  // FIX ISSUE #2: Load auto-update setting on mount
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

  // FIX ISSUE #2.1: Fetch presets from backend on mount
  useEffect(() => {
    const fetchPresets = async () => {
      try {
        const eviaAuth = (window as any).evia?.auth;
        const token = await eviaAuth?.getToken?.();
        if (!token) {
          console.warn('[SettingsView] No token available, skipping preset fetch');
          return;
        }

        const { BACKEND_URL } = await import('../config/config');
        const response = await fetch(`${BACKEND_URL}/prompts`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const fetchedPresets = await response.json();
          setPresets(fetchedPresets);
          console.log('[SettingsView] ✅ Loaded presets:', fetchedPresets.length);
          
          // Set the active preset as selected
          const activePreset = fetchedPresets.find((p: any) => p.is_active);
          if (activePreset) {
            setSelectedPreset(activePreset);
            console.log('[SettingsView] ✅ Active preset:', activePreset.name);
          }
        } else {
          console.error('[SettingsView] ❌ Failed to fetch presets:', response.status);
        }
      } catch (error) {
        console.error('[SettingsView] ❌ Error fetching presets:', error);
      }
    };

    fetchPresets();
  }, []); // Run once on mount

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
    const eviaShell = (window as any).evia?.shell;
    const eviaAuth = (window as any).evia?.auth;
    
    if (!eviaShell?.navigate) {
      console.error('[SettingsView] Shell navigation API not available');
      // Fallback
      if ((window as any).evia?.windows?.openExternal) {
        (window as any).evia.windows.openExternal(`${WEB_APP_URL}/activity`);
      }
      return;
    }
    
    try {
      const token = await eviaAuth?.getToken?.();
      const url = token 
        ? `${WEB_APP_URL}/activity?desktop_token=${encodeURIComponent(token)}`
        : `${WEB_APP_URL}/activity`;
      
      console.log('[SettingsView] 🧭 Requesting navigation via bridge');
      await eviaShell.navigate(url);
      console.log('[SettingsView] ✅ Navigation request sent');
    } catch (error) {
      console.error('[SettingsView] Error requesting navigation:', error);
    }
  };
  
  const handleCreatePreset = async () => {
    console.log('[SettingsView] ➕ Create first preset clicked - opening /personalize');
    const eviaShell = (window as any).evia?.shell;
    const eviaAuth = (window as any).evia?.auth;
    
    if (!eviaShell?.navigate) {
      console.error('[SettingsView] Shell navigation API not available');
      // Fallback
      if ((window as any).evia?.windows?.openExternal) {
        (window as any).evia.windows.openExternal(`${WEB_APP_URL}/personalize`);
      }
      return;
    }
    
    try {
      const token = await eviaAuth?.getToken?.();
      const url = token
        ? `${WEB_APP_URL}/personalize?desktop_token=${encodeURIComponent(token)}`
        : `${WEB_APP_URL}/personalize`;
      
      console.log('[SettingsView] 🧭 Requesting navigation via bridge');
      await eviaShell.navigate(url);
      console.log('[SettingsView] ✅ Navigation request sent');
    } catch (error) {
      console.error('[SettingsView] Error requesting navigation:', error);
    }
  };

  // FIX ISSUE #2: Persist auto-update toggle via IPC
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
      // FIX: Increased from -10 to -50 to match arrow key movement distance
      eviaWindows.nudgeHeader(-50, 0);
    }
  };

  const handleMoveRight = () => {
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.nudgeHeader) {
      // FIX: Increased from 10 to 50 to match arrow key movement distance
      eviaWindows.nudgeHeader(50, 0);
    }
  };

  const handleToggleInvisibility = async () => {
    const newState = !isInvisible;
    setIsInvisible(newState);
    console.log('[SettingsView] 👻 Invisibility:', newState);
    
    // NEW: Implement invisibility via IPC
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

  const handlePresetSelect = async (preset: any) => {
    // PREVENT preset changes during active recording session
    if (isSessionActive) {
      console.warn('[SettingsView] ⚠️ Cannot change preset during active recording session');
      console.warn('[SettingsView] ⚠️ Please stop recording first, then change preset');
      return;
    }
    
    const isDeactivating = preset.is_active;
    console.log(`[SettingsView] ${isDeactivating ? '🔴 Deactivating' : '🎨 Activating'} preset:`, preset.name);
    
    try {
      const eviaAuth = (window as any).evia?.auth;
      const token = await eviaAuth?.getToken?.();
      if (!token) {
        console.error('[SettingsView] ❌ No token available');
        return;
      }

      const { BACKEND_URL } = await import('../config/config');
      
      // Always clear cache when changing/deactivating presets
      try {
        console.log('[SettingsView] 🧹 Clearing preset cache...');
        const clearResponse = await fetch(`${BACKEND_URL}/prompts/clear-cache`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (clearResponse.ok) {
          console.log('[SettingsView] ✅ Cache cleared successfully');
        } else {
          console.warn('[SettingsView] ⚠️ Cache clear failed (non-fatal):', clearResponse.status);
        }
      } catch (clearError) {
        console.warn('[SettingsView] ⚠️ Cache clear error (non-fatal):', clearError);
      }
      
      // If deactivating, set is_active to false; otherwise activate
      const response = await fetch(`${BACKEND_URL}/prompts/${preset.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          is_active: !isDeactivating
        })
      });

      if (response.ok) {
        const updatedPreset = await response.json();
        console.log(`[SettingsView] ✅ Preset ${isDeactivating ? 'deactivated' : 'activated'}:`, updatedPreset.name);
        
        // Update local state
        const updatedPresets = presets.map(p => ({
          ...p,
          is_active: isDeactivating ? false : (p.id === preset.id)
        }));
        setPresets(updatedPresets);
        setSelectedPreset(isDeactivating ? null : updatedPreset);
        
        console.log(`[SettingsView] 🎉 ${isDeactivating ? 'Using default prompt' : `Active preset is now: ${updatedPreset.name}`}`);
      } else {
        console.error('[SettingsView] ❌ Failed to update preset:', response.status);
      }
    } catch (error) {
      console.error('[SettingsView] ❌ Error updating preset:', error);
    }
  };

  const handleEditShortcuts = () => {
    console.log('[SettingsView] ⌨️ Edit Shortcuts clicked');
    // NEW: Open shortcuts window
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
            {/* Glass parity: 14x14 icon size */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9.785 7.41787C8.7 7.41787 7.79 8.19371 7.55667 9.22621C7.0025 8.98704 6.495 9.05121 6.11 9.22037C5.87083 8.18204 4.96083 7.41787 3.88167 7.41787C2.61583 7.41787 1.58333 8.46204 1.58333 9.75121C1.58333 11.0404 2.61583 12.0845 3.88167 12.0845C5.08333 12.0845 6.06333 11.1395 6.15667 9.93787C6.355 9.79787 6.87417 9.53537 7.51 9.94954C7.615 11.1454 8.58333 12.0845 9.785 12.0845C11.0508 12.0845 12.0833 11.0404 12.0833 9.75121C12.0833 8.46204 11.0508 7.41787 9.785 7.41787ZM3.88167 11.4195C2.97167 11.4195 2.2425 10.6729 2.2425 9.75121C2.2425 8.82954 2.9775 8.08287 3.88167 8.08287C4.79167 8.08287 5.52083 8.82954 5.52083 9.75121C5.52083 10.6729 4.79167 11.4195 3.88167 11.4195ZM9.785 11.4195C8.875 11.4195 8.14583 10.6729 8.14583 9.75121C8.14583 8.82954 8.875 8.08287 9.785 8.08287C10.695 8.08287 11.43 8.82954 11.43 9.75121C11.43 10.6729 10.6892 11.4195 9.785 11.4195ZM12.6667 5.95954H1V6.83454H12.6667V5.95954ZM8.8925 1.36871C8.76417 1.08287 8.4375 0.931207 8.12833 1.03037L6.83333 1.46204L5.5325 1.03037L5.50333 1.02454C5.19417 0.93704 4.8675 1.10037 4.75083 1.39787L3.33333 5.08454H10.3333L8.91 1.39787L8.8925 1.36871Z" fill="white"/>
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

      {/* Shortcuts Edit Button - STT Model section removed per Mac parity */}
      <div className="model-section">
        <button className="settings-button full-width" onClick={handleEditShortcuts}>
          <span>{t('editShortcuts')}</span>
        </button>
      </div>

      {/* Shortcuts Section - WINDOWS FIX (2025-12-05): Use Ctrl instead of ⌘ on Windows */}
      {(() => {
        const isWindowsPlatform = Boolean((window as any)?.platformInfo?.isWindows);
        const modKey = isWindowsPlatform ? 'Ctrl' : '⌘';
        const shiftKey = isWindowsPlatform ? 'Shift' : '⇧';
        
        return (
      <div className="shortcuts-section">
        <div className="shortcut-item">
          <span className="shortcut-name">{t('shortcutShowHide')}</span>
          <div className="shortcut-keys">
                <span className="cmd-key">{modKey}</span>
            <span className="shortcut-key">\</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">{t('shortcutAskAnything')}</span>
          <div className="shortcut-keys">
                <span className="cmd-key">{modKey}</span>
            <span className="shortcut-key">↵</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">{t('shortcutScrollUp')}</span>
          <div className="shortcut-keys">
                <span className="cmd-key">{modKey}</span>
                <span className="cmd-key">{shiftKey}</span>
            <span className="shortcut-key">↑</span>
          </div>
        </div>
        <div className="shortcut-item">
          <span className="shortcut-name">{t('shortcutScrollDown')}</span>
          <div className="shortcut-keys">
                <span className="cmd-key">{modKey}</span>
                <span className="cmd-key">{shiftKey}</span>
            <span className="shortcut-key">↓</span>
          </div>
        </div>
      </div>
        );
      })()}

      {/* My Presets Section */}
      <div className="preset-section">
        <div className="preset-header">
          <div>
            <span className="preset-title">{t('myPresets')}</span>
            <span className="preset-count">({presets.filter(p => !p.is_default).length})</span>
            {isSessionActive && (
              <svg className="preset-header-lock" width="10" height="12" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 5.5V3.5C8 1.84315 6.65685 0.5 5 0.5C3.34315 0.5 2 1.84315 2 3.5V5.5M2.5 5.5H7.5C8.05228 5.5 8.5 5.94772 8.5 6.5V10.5C8.5 11.0523 8.05228 11.5 7.5 11.5H2.5C1.94772 11.5 1.5 11.0523 1.5 10.5V6.5C1.5 5.94772 1.94772 5.5 2.5 5.5Z" stroke="rgba(255,255,255,0.6)" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            )}
          </div>
          <span className="preset-toggle" onClick={() => setShowPresets(!showPresets)}>
            {/* SF Symbol style chevrons */}
            {showPresets ? (
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="6" height="10" viewBox="0 0 6 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
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
                className={`preset-item ${preset.is_active ? 'active' : ''} ${selectedPreset?.id === preset.id ? 'selected' : ''} ${isSessionActive ? 'disabled' : ''}`}
                onClick={() => handlePresetSelect(preset)}
                title={isSessionActive ? 'Cannot change preset during active recording' : ''}
              >
                <span className="preset-name">{preset.name || preset.title}</span>
                {preset.is_active && <span className="preset-status">Active</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Action Buttons - Move buttons and Auto Updates removed per Mac parity */}
      <div className="buttons-section">
        <button className="settings-button full-width" onClick={handlePersonalize}>
          <span>{t('personalizeButton')}</span>
        </button>

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
              eviaWindows?.openExternal?.(`${WEB_APP_URL}/login?source=desktop`);
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
