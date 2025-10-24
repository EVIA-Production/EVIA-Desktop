import React, { useState, useEffect } from 'react';
import './overlay-tokens.css';
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

// Glass parity: All 12 shortcuts from DEFAULT_KEYBINDS
const DEFAULT_SHORTCUTS: ShortcutConfig[] = [
  { id: 'toggleVisibility', name: 'Show / Hide', accelerator: 'Cmd+\\', category: 'window' },
  { id: 'nextStep', name: 'Ask Anything', accelerator: 'Cmd+Enter', category: 'action' },
  { id: 'moveUp', name: 'Move Up Window', accelerator: 'Cmd+Up', category: 'navigation' },
  { id: 'moveDown', name: 'Move Down Window', accelerator: 'Cmd+Down', category: 'navigation' },
  { id: 'moveLeft', name: 'Move Left Window', accelerator: 'Cmd+Left', category: 'navigation' },
  { id: 'moveRight', name: 'Move Right Window', accelerator: 'Cmd+Right', category: 'navigation' },
  { id: 'scrollUp', name: 'Scroll Up Response', accelerator: 'Cmd+Shift+Up', category: 'navigation' },
  { id: 'scrollDown', name: 'Scroll Down Response', accelerator: 'Cmd+Shift+Down', category: 'navigation' },
  { id: 'toggleClickThrough', name: 'Toggle Click Through', accelerator: 'Cmd+M', category: 'action' },
  { id: 'manualScreenshot', name: 'Manual Screenshot', accelerator: 'Cmd+Shift+S', category: 'action' },
  { id: 'previousResponse', name: 'Previous Response', accelerator: 'Cmd+[', category: 'navigation' },
  { id: 'nextResponse', name: 'Next Response', accelerator: 'Cmd+]', category: 'navigation' },
];

const ShortcutsView: React.FC<ShortcutsViewProps> = ({ language, onClose }) => {
  const [shortcuts, setShortcuts] = useState<ShortcutConfig[]>(DEFAULT_SHORTCUTS);
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [feedback, setFeedback] = useState<{ [key: string]: { type: 'error' | 'success'; msg: string } }>({});

  // Handle keyboard input when recording a new shortcut
  useEffect(() => {
    if (!editingShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      
      const keys: string[] = [];
      if (e.metaKey) keys.push('Cmd');
      if (e.ctrlKey) keys.push('Ctrl');
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

  const handleSave = async () => {
    console.log('[ShortcutsView] 💾 Saving shortcuts:', shortcuts);
    // TODO: Implement IPC call to save shortcuts to main process
    // await (window as any).evia?.prefs?.set({ shortcuts });
    setHasChanges(false);
    if (onClose) onClose();
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

  const handleReset = () => {
    console.log('[ShortcutsView] 🔄 Reset to defaults');
    setShortcuts(DEFAULT_SHORTCUTS);
    setHasChanges(true);
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

  const renderShortcutKey = (accelerator: string) => {
    if (!accelerator) return <span className="shortcut-key">N/A</span>;
    const keys = accelerator.split('+');
    return keys.map((key, index) => (
      <span key={index} className="shortcut-key">
        {key === 'Cmd' ? '⌘' : key === 'Shift' ? '⇧' : key === 'Alt' ? '⌥' : key === 'Ctrl' ? '⌃' : key}
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
              <span className="shortcut-name">{shortcut.name}</span>
              
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
