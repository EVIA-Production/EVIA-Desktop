import React, { useState, useEffect } from 'react';
import './overlay-glass.css';
import { i18n } from '../i18n/i18n';

interface ShortcutsViewProps {
  language: 'de' | 'en';
  onClose?: () => void;
}

interface ShortcutConfig {
  id: string;
  name: string;
  accelerator: string;
  category: 'window' | 'navigation' | 'action';
}

// Active shortcuts shown in editor
const DEFAULT_SHORTCUTS: ShortcutConfig[] = [
  { id: 'toggleVisibility', name: 'Show / Hide', accelerator: 'Cmd+\\', category: 'window' },
  { id: 'nextStep', name: 'Ask Anything', accelerator: 'Cmd+Enter', category: 'action' },
  { id: 'moveUp', name: 'Move Up Window', accelerator: 'Cmd+Up', category: 'navigation' },
  { id: 'moveDown', name: 'Move Down Window', accelerator: 'Cmd+Down', category: 'navigation' },
  { id: 'moveLeft', name: 'Move Left Window', accelerator: 'Cmd+Left', category: 'navigation' },
  { id: 'moveRight', name: 'Move Right Window', accelerator: 'Cmd+Right', category: 'navigation' },
  { id: 'toggleClickThrough', name: 'Toggle Click Through', accelerator: 'Cmd+M', category: 'action' },
  { id: 'previousResponse', name: 'Previous Response', accelerator: 'Cmd+[', category: 'navigation' },
  { id: 'nextResponse', name: 'Next Response', accelerator: 'Cmd+]', category: 'navigation' },
];

const ShortcutsView: React.FC<ShortcutsViewProps> = ({ language, onClose }) => {
  // FIX: Track language state to force re-render on language change
  const [currentLanguage, setCurrentLanguage] = useState<'de' | 'en'>(language);
  const [shortcuts, setShortcuts] = useState<ShortcutConfig[]>(DEFAULT_SHORTCUTS);
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [feedback, setFeedback] = useState<{ [key: string]: { type: 'error' | 'success'; msg: string } }>({});

  // Handle keyboard input when recording a new shortcut
  useEffect(() => {
    if (!editingShortcut) return;

    // WINDOWS FIX (2025-12-05): Normalize shortcuts to use "Cmd" prefix for cross-platform consistency
    // On Windows: Ctrl key is recorded as "Cmd" (converted back to Ctrl at registration)
    // On Mac: Cmd key is recorded as "Cmd" (used as-is)
    const isWindowsOS = Boolean((window as any)?.platformInfo?.isWindows);

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      
      const keys: string[] = [];
      
      // WINDOWS FIX: On Windows, record Ctrl as "Cmd" for consistent storage
      // The main process converts "Cmd" back to "Ctrl" when registering shortcuts
      if (isWindowsOS) {
        if (e.ctrlKey) keys.push('Cmd');  // Windows: Ctrl → Cmd (stored)
      } else {
        if (e.metaKey) keys.push('Cmd');  // Mac: Cmd → Cmd
        if (e.ctrlKey) keys.push('Ctrl'); // Mac: Ctrl stays as Ctrl
      }
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      
      // Add the actual key if it's not a modifier
      if (!['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) {
        let key = e.key;
        if (key === ' ') key = 'Space';
        else if (key === '\\') key = '\\';
        else if (key === '[') key = '[';
        else if (key === ']') key = ']';
        else if (key.length === 1) key = key.toUpperCase();
        keys.push(key);
      }
      
      setRecordedKeys(keys);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (recordedKeys.length >= 2) {
        // Valid shortcut (at least one modifier + one key)
        const accelerator = recordedKeys.join('+');
        
        // Check if already used
        const existing = shortcuts.find(s => s.accelerator === accelerator && s.id !== editingShortcut);
        if (existing) {
          setFeedback({
            ...feedback,
            [editingShortcut]: { type: 'error', msg: `Already used by ${existing.name}` }
          });
          setTimeout(() => {
            setFeedback(f => { const newF = { ...f }; delete newF[editingShortcut]; return newF; });
          }, 2000);
        } else {
          setShortcuts(prev =>
            prev.map(s =>
              s.id === editingShortcut ? { ...s, accelerator } : s
            )
          );
          setFeedback({
            ...feedback,
            [editingShortcut]: { type: 'success', msg: 'Shortcut updated!' }
          });
          setTimeout(() => {
            setFeedback(f => { const newF = { ...f }; delete newF[editingShortcut]; return newF; });
          }, 1500);
          setHasChanges(true);
        }
        setEditingShortcut(null);
        setRecordedKeys([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [editingShortcut, recordedKeys, shortcuts, feedback]);

  // FIX: Listen for language changes and update current language
  useEffect(() => {
    const handleLanguageChanged = (newLang: string) => {
      console.log('[ShortcutsView] 🌐 Language changed to:', newLang);
      setCurrentLanguage(newLang as 'de' | 'en');
    };
    
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.on('language-changed', handleLanguageChanged);
    }
    
    return () => {
      if (eviaIpc) {
        eviaIpc.off('language-changed', handleLanguageChanged);
      }
    };
  }, []);

  // GLASS PARITY: Load shortcuts from main process on mount
  useEffect(() => {
    const loadSavedShortcuts = async () => {
      try {
        const eviaIpc = (window as any).evia?.ipc;
        const result = await eviaIpc?.invoke('shortcuts:get');
        if (result?.ok && result.shortcuts) {
          // Convert from main process format to UI format
          const shortcutsArray = DEFAULT_SHORTCUTS.map(defaultShortcut => ({
            ...defaultShortcut,
            accelerator: result.shortcuts[defaultShortcut.id] || defaultShortcut.accelerator
          }));
          setShortcuts(shortcutsArray);
          console.log('[ShortcutsView] ✅ Loaded shortcuts from main process');
        }
      } catch (error) {
        console.error('[ShortcutsView] ❌ Failed to load shortcuts:', error);
      }
    };
    loadSavedShortcuts();
  }, []);

  const handleSave = async () => {
    console.log('[ShortcutsView] 💾 Saving shortcuts:', shortcuts);
    
    // GLASS PARITY: Convert to main process format and save via IPC
    try {
      const eviaIpc = (window as any).evia?.ipc;
      const shortcutsMap: { [key: string]: string } = {};
      shortcuts.forEach(s => {
        shortcutsMap[s.id] = s.accelerator;
      });
      
      await eviaIpc?.invoke('shortcuts:set', shortcutsMap);
      console.log('[ShortcutsView] ✅ Shortcuts saved and re-registered');
      setHasChanges(false);
      if (onClose) onClose();
    } catch (error) {
      console.error('[ShortcutsView] ❌ Failed to save shortcuts:', error);
    }
  };

  const handleCancel = () => {
    console.log('[ShortcutsView] ❌ Cancel clicked - closing window');
    // Glass parity: Close the shortcuts window via IPC
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.hide) {
      eviaWindows.hide('shortcuts');
    }
    if (onClose) onClose();
  };
  
  const handleClose = () => {
    console.log('[ShortcutsView] ✕ Close button clicked');
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.hide) {
      eviaWindows.hide('shortcuts');
    }
    if (onClose) onClose();
  };

  const handleReset = async () => {
    console.log('[ShortcutsView] 🔄 Reset to defaults');
    
    // GLASS PARITY: Reset via IPC (main process will save and re-register)
    try {
      const eviaIpc = (window as any).evia?.ipc;
      const result = await eviaIpc?.invoke('shortcuts:reset');
      if (result?.ok && result.shortcuts) {
        // Convert from main process format to UI format
        const shortcutsArray = DEFAULT_SHORTCUTS.map(defaultShortcut => ({
          ...defaultShortcut,
          accelerator: result.shortcuts[defaultShortcut.id] || defaultShortcut.accelerator
        }));
        setShortcuts(shortcutsArray);
        setHasChanges(false);  // No changes after reset (already saved)
        console.log('[ShortcutsView] ✅ Shortcuts reset to defaults');
      }
    } catch (error) {
      console.error('[ShortcutsView] ❌ Failed to reset shortcuts:', error);
      // Fallback to local reset if IPC fails
      setShortcuts(DEFAULT_SHORTCUTS);
      setHasChanges(true);
    }
  };

  const handleDisable = (id: string) => {
    setShortcuts(prev =>
      prev.map(s =>
        s.id === id ? { ...s, accelerator: '' } : s
      )
    );
    setHasChanges(true);
    setFeedback({
      ...feedback,
      [id]: { type: 'success', msg: 'Shortcut disabled' }
    });
    setTimeout(() => {
      setFeedback(f => { const newF = { ...f }; delete newF[id]; return newF; });
    }, 1500);
  };

  // FIX: Helper function to get translated shortcut name
  const getShortcutName = (shortcut: ShortcutConfig): string => {
    // Map shortcut IDs to i18n keys
    const i18nKeyMap: { [key: string]: string } = {
      'toggleVisibility': 'shortcutShowHide',
      'nextStep': 'shortcutAskAnything',
      'moveUp': 'shortcutMoveUp',
      'moveDown': 'shortcutMoveDown',
      'moveLeft': 'shortcutMoveLeft',
      'moveRight': 'shortcutMoveRight',
      'toggleClickThrough': 'shortcutToggleClickThrough',
      'previousResponse': 'shortcutPreviousResponse',
      'nextResponse': 'shortcutNextResponse',
    };
    
    const i18nKey = i18nKeyMap[shortcut.id];
    if (i18nKey) {
      return i18n.t(`overlay.settings.${i18nKey}`);
    }
    
    // Fallback to English name
    return shortcut.name;
  };

  // WINDOWS FIX (2025-12-05): Use platform-appropriate symbol mapping
  const isWindows = Boolean((window as any)?.platformInfo?.isWindows);

  // Glass parity: Symbol mapping for keyboard shortcuts
  // On Windows: Show "Ctrl" text instead of ⌃ symbol (which is confusing on Windows)
  // On Mac: Use standard Mac symbols
  const keyMap: { [key: string]: string } = isWindows ? {
    'Cmd': 'Ctrl',      // Windows: Map Cmd to Ctrl
    'Command': 'Ctrl',
    'Ctrl': 'Ctrl',
    'Control': 'Ctrl',
    'Alt': 'Alt',
    'Option': 'Alt',
    'Shift': 'Shift',
    'Enter': '↵',
    'Backspace': '⌫',
    'Delete': 'Del',
    'Tab': 'Tab',
    'Escape': 'Esc',
    'Up': '↑',
    'Down': '↓',
    'Left': '←',
    'Right': '→',
  } : {
    'Cmd': '⌘',
    'Command': '⌘',
    'Ctrl': '⌃',
    'Control': '⌃',
    'Alt': '⌥',
    'Option': '⌥',
    'Shift': '⇧',
    'Enter': '↵',
    'Backspace': '⌫',
    'Delete': '⌦',
    'Tab': '⇥',
    'Escape': '⎋',
    'Up': '↑',
    'Down': '↓',
    'Left': '←',
    'Right': '→',
  };

  const renderShortcutKey = (accelerator: string) => {
    if (!accelerator) return <span className="shortcut-key">N/A</span>;
    const keys = accelerator.split('+');
    return keys.map((key, index) => (
      <span key={index} className="shortcut-key">
        {keyMap[key] || key}
      </span>
    ));
  };

  const t = (key: string) => i18n.t(`overlay.shortcuts.${key}`);

  return (
    <div className="shortcuts-container">
      <button className="close-button" onClick={handleClose} title="Close">&times;</button>
      
      <div className="shortcuts-header">
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </div>

      <div className="shortcuts-list">
        {shortcuts.map(shortcut => (
          <div key={shortcut.id}>
            <div className="shortcut-row">
              <span className="shortcut-name">{getShortcutName(shortcut)}</span>
              
              <button className="action-btn" onClick={() => setEditingShortcut(shortcut.id)}>
                Edit
              </button>
              <button className="action-btn" onClick={() => handleDisable(shortcut.id)}>
                Disable
              </button>
              
              <div
                className={`shortcut-value ${editingShortcut === shortcut.id ? 'editing' : ''}`}
                onClick={() => {
                  setEditingShortcut(shortcut.id);
                  setRecordedKeys([]);
                }}
              >
                {editingShortcut === shortcut.id ? (
                  <span className="recording-indicator">
                    {recordedKeys.length > 0 ? recordedKeys.join('+') : 'Press new shortcut...'}
                  </span>
                ) : (
                  renderShortcutKey(shortcut.accelerator)
                )}
              </div>
            </div>
            
            {feedback[shortcut.id] && (
              <div className={`feedback ${feedback[shortcut.id].type}`}>
                {feedback[shortcut.id].msg}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="shortcuts-actions">
        <button className="settings-button danger" onClick={handleReset}>
          {t('reset')}
        </button>
        <div className="button-group">
          <button className="settings-button" onClick={handleCancel}>
            {t('cancel')}
          </button>
          <button
            className="settings-button primary"
            onClick={handleSave}
            disabled={!hasChanges}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShortcutsView;
