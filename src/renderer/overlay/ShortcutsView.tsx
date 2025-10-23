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

const ShortcutsView: React.FC<ShortcutsViewProps> = ({ language, onClose }) => {
  const [shortcuts, setShortcuts] = useState<ShortcutConfig[]>([
    { id: 'toggle-visibility', name: i18n.t('overlay.settings.shortcutShowHide'), accelerator: 'Cmd+\\', category: 'window' },
    { id: 'open-ask', name: i18n.t('overlay.settings.shortcutAskAnything'), accelerator: 'Cmd+Enter', category: 'window' },
    { id: 'scroll-up', name: i18n.t('overlay.settings.shortcutScrollUp'), accelerator: 'Cmd+Shift+Up', category: 'navigation' },
    { id: 'scroll-down', name: i18n.t('overlay.settings.shortcutScrollDown'), accelerator: 'Cmd+Shift+Down', category: 'navigation' },
  ]);
  
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

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
        const key = e.key === ' ' ? 'Space' : e.key;
        keys.push(key.toUpperCase());
      }
      
      setRecordedKeys(keys);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (recordedKeys.length >= 2) {
        // Valid shortcut (at least one modifier + one key)
        const accelerator = recordedKeys.join('+');
        setShortcuts(prev =>
          prev.map(s =>
            s.id === editingShortcut ? { ...s, accelerator } : s
          )
        );
        setHasChanges(true);
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
  }, [editingShortcut, recordedKeys]);

  const handleSave = async () => {
    console.log('[ShortcutsView] 💾 Saving shortcuts:', shortcuts);
    // TODO: Implement IPC call to save shortcuts to main process
    // await (window as any).evia?.prefs?.set({ shortcuts });
    setHasChanges(false);
    if (onClose) onClose();
  };

  const handleCancel = () => {
    console.log('[ShortcutsView] ❌ Cancel clicked');
    if (onClose) onClose();
  };

  const handleReset = () => {
    console.log('[ShortcutsView] 🔄 Reset to defaults');
    // Reset to default shortcuts
    setShortcuts([
      { id: 'toggle-visibility', name: i18n.t('overlay.settings.shortcutShowHide'), accelerator: 'Cmd+\\', category: 'window' },
      { id: 'open-ask', name: i18n.t('overlay.settings.shortcutAskAnything'), accelerator: 'Cmd+Enter', category: 'window' },
      { id: 'scroll-up', name: i18n.t('overlay.settings.shortcutScrollUp'), accelerator: 'Cmd+Shift+Up', category: 'navigation' },
      { id: 'scroll-down', name: i18n.t('overlay.settings.shortcutScrollDown'), accelerator: 'Cmd+Shift+Down', category: 'navigation' },
    ]);
    setHasChanges(true);
  };

  const renderShortcutKey = (accelerator: string) => {
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
      <div className="shortcuts-header">
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </div>

      <div className="shortcuts-list">
        {shortcuts.map(shortcut => (
          <div key={shortcut.id} className="shortcut-row">
            <span className="shortcut-name">{shortcut.name}</span>
            <div
              className={`shortcut-value ${editingShortcut === shortcut.id ? 'editing' : ''}`}
              onClick={() => {
                setEditingShortcut(shortcut.id);
                setRecordedKeys([]);
              }}
            >
              {editingShortcut === shortcut.id ? (
                <span className="recording-indicator">
                  {recordedKeys.length > 0 ? recordedKeys.join('+') : 'Press keys...'}
                </span>
              ) : (
                renderShortcutKey(shortcut.accelerator)
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="shortcuts-actions">
        <button className="settings-button" onClick={handleReset}>
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

