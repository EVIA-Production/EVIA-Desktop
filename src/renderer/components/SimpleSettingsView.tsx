import React, { useState } from 'react';

interface SimpleSettingsViewProps {
  language: 'de' | 'en';
  onLanguageChange: (language: 'de' | 'en') => void;
  onClose: () => void;
}

export const SimpleSettingsView: React.FC<SimpleSettingsViewProps> = ({
  language,
  onLanguageChange,
  onClose
}) => {
  const [settings, setSettings] = useState({
    language: language,
    autoScroll: true,
    systemAudio: false,
    aec: false,
    diarization: false
  });

  // Load settings on mount
  useEffect(() => {
    if (window.evia?.settings) {
      window.evia.settings.get().then((loadedSettings: any) => {
        setSettings(loadedSettings);
        onLanguageChange(loadedSettings.language);
      });
    }
  }, []);

  const updateLanguage = (newLanguage: 'de' | 'en') => {
    const newSettings = { ...settings, language: newLanguage };
    setSettings(newSettings);
    onLanguageChange(newLanguage);
    saveSettings(newSettings);
  };

  const toggleSetting = (key: keyof typeof settings) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const saveSettings = async (newSettings: any) => {
    if (window.evia?.settings) {
      try {
        await window.evia.settings.set(newSettings);
      } catch (error) {
        console.error('Error saving settings:', error);
      }
    }
  };

  return (
    <div className="glass-window glass-overlay w-96 h-80 p-4 rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">
          {language === 'de' ? 'Einstellungen' : 'Settings'}
        </h2>
        <button
          onClick={onClose}
          className="text-white/60 hover:text-white text-xl"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Language Settings */}
        <div className="p-3 rounded-lg bg-white/10 border border-white/20">
          <h3 className="text-white font-medium mb-2 flex items-center gap-2">
            🌐 {language === 'de' ? 'Sprache' : 'Language'}
          </h3>
          <div className="space-y-2">
            <label className="text-white/80 text-sm">
              {language === 'de' ? 'Standardsprache:' : 'Default Language:'}
            </label>
            <select
              value={settings.language}
              onChange={(e) => updateLanguage(e.target.value as 'de' | 'en')}
              className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="de">🇩🇪 Deutsch (Standard)</option>
              <option value="en">🇺🇸 English</option>
            </select>
            <p className="text-xs text-white/60">
              {language === 'de' 
                ? 'Sprache für Transkription und KI-Antworten'
                : 'Language for transcription and AI responses'
              }
            </p>
          </div>
        </div>

        {/* Audio Settings */}
        <div className="p-3 rounded-lg bg-white/10 border border-white/20">
          <h3 className="text-white font-medium mb-2 flex items-center gap-2">
            🎤 {language === 'de' ? 'Audio-Einstellungen' : 'Audio Settings'}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-white/80 text-sm">
                  {language === 'de' ? 'Auto-Scroll' : 'Auto-Scroll'}
                </label>
                <p className="text-xs text-white/60">
                  {language === 'de' 
                    ? 'Automatisch zum neuesten Text scrollen'
                    : 'Automatically scroll to latest text'
                  }
                </p>
              </div>
              <button
                onClick={() => toggleSetting('autoScroll')}
                className={`w-12 h-6 rounded-full transition-colors ${
                  settings.autoScroll ? 'bg-green-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.autoScroll ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-white/80 text-sm">
                  {language === 'de' ? 'System-Audio' : 'System Audio'}
                </label>
                <p className="text-xs text-white/60">
                  {language === 'de' 
                    ? 'System-Audio erfassen (Beta)'
                    : 'Capture system audio (Beta)'
                  }
                </p>
              </div>
              <button
                onClick={() => toggleSetting('systemAudio')}
                className={`w-12 h-6 rounded-full transition-colors ${
                  settings.systemAudio ? 'bg-green-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.systemAudio ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-white/80 text-sm">
                  {language === 'de' ? 'Echo-Kompensation' : 'Echo Cancellation'}
                </label>
                <p className="text-xs text-white/60">
                  {language === 'de' 
                    ? 'Verbesserte Audioqualität'
                    : 'Improved audio quality'
                  }
                </p>
              </div>
              <button
                onClick={() => toggleSetting('aec')}
                className={`w-12 h-6 rounded-full transition-colors ${
                  settings.aec ? 'bg-green-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.aec ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-white/80 text-sm">
                  {language === 'de' ? 'Sprecher-Erkennung' : 'Speaker Recognition'}
                </label>
                <p className="text-xs text-white/60">
                  {language === 'de' 
                    ? 'Verschiedene Sprecher unterscheiden'
                    : 'Distinguish different speakers'
                  }
                </p>
              </div>
              <button
                onClick={() => toggleSetting('diarization')}
                className={`w-12 h-6 rounded-full transition-colors ${
                  settings.diarization ? 'bg-green-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.diarization ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </div>
        </div>

        {/* System Info */}
        <div className="p-3 rounded-lg bg-white/10 border border-white/20">
          <h3 className="text-white font-medium mb-2 flex items-center gap-2">
            💻 {language === 'de' ? 'System-Info' : 'System Info'}
          </h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-white/60">EVIA Version:</span>
              <span className="text-white">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Backend:</span>
              <span className="text-white">Connected</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Sprache:</span>
              <span className="text-white">{language === 'de' ? '🇩🇪 Deutsch' : '🇺🇸 English'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-white/20">
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>
            {language === 'de' ? 'Einstellungen werden automatisch gespeichert' : 'Settings are automatically saved'}
          </span>
          <span>EVIA Desktop</span>
        </div>
      </div>
    </div>
  );
};

export default SimpleSettingsView;
