import React, { useState, useEffect } from 'react';
import { X, Globe, Mic, Volume2, Shield, Info } from 'lucide-react';

interface SettingsViewProps {
  language: 'de' | 'en';
  onLanguageChange: (lang: 'de' | 'en') => void;
  onClose: () => void;
}

interface UserSettings {
  language: 'de' | 'en';
  mic_sensitivity: number;
  aec_enabled: boolean;
  diarization_enabled: boolean;
  system_audio_enabled: boolean;
  consent_training: boolean;
  consent_analytics: boolean;
  consent_storage: boolean;
}

const SettingsView: React.FC<SettingsViewProps> = ({
  language,
  onLanguageChange,
  onClose
}) => {
  const [settings, setSettings] = useState<UserSettings>({
    language: 'de',
    mic_sensitivity: 0.7,
    aec_enabled: false,
    diarization_enabled: false,
    system_audio_enabled: false,
    consent_training: true,
    consent_analytics: true,
    consent_storage: true
  });

  const [activeTab, setActiveTab] = useState<'general' | 'audio' | 'privacy' | 'about'>('general');

  useEffect(() => {
    setSettings(prev => ({ ...prev, language }));
  }, [language]);

  const handleSettingChange = (key: keyof UserSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    
    // Save to localStorage
    localStorage.setItem('evia-settings', JSON.stringify({
      ...settings,
      [key]: value
    }));
  };

  const handleLanguageChange = (newLang: 'de' | 'en') => {
    handleSettingChange('language', newLang);
    onLanguageChange(newLang);
  };

  const tabs = [
    { id: 'general', label: language === 'de' ? 'Allgemein' : 'General', icon: Globe },
    { id: 'audio', label: language === 'de' ? 'Audio' : 'Audio', icon: Mic },
    { id: 'privacy', label: language === 'de' ? 'Datenschutz' : 'Privacy', icon: Shield },
    { id: 'about', label: language === 'de' ? 'Info' : 'About', icon: Info }
  ];

  return (
    <div
      style={{
        width: '450px',
        height: '600px',
        background: 'rgba(0, 0, 0, 0.1)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span style={{ color: 'white', fontWeight: '600' }}>
          {language === 'de' ? 'Einstellungen' : 'Settings'}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            padding: '4px'
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                flex: 1,
                padding: '12px',
                background: activeTab === tab.id ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '12px'
              }}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {activeTab === 'general' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ color: 'white', fontSize: '14px', marginBottom: '8px', display: 'block' }}>
                {language === 'de' ? 'Sprache' : 'Language'}
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleLanguageChange('de')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: settings.language === 'de' ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Deutsch
                </button>
                <button
                  onClick={() => handleLanguageChange('en')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: settings.language === 'en' ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  English
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ color: 'white', fontSize: '14px', marginBottom: '8px', display: 'block' }}>
                {language === 'de' ? 'Mikrofon-Empfindlichkeit' : 'Microphone Sensitivity'}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.mic_sensitivity}
                onChange={(e) => handleSettingChange('mic_sensitivity', parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '12px', marginTop: '4px' }}>
                {Math.round(settings.mic_sensitivity * 100)}%
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ color: 'white', fontSize: '14px' }}>
                {language === 'de' ? 'Audio-Features' : 'Audio Features'}
              </label>
              
              {[
                { key: 'aec_enabled', label: language === 'de' ? 'Echo-Kompensation (AEC)' : 'Echo Cancellation (AEC)' },
                { key: 'diarization_enabled', label: language === 'de' ? 'Sprecher-Erkennung' : 'Speaker Diarization' },
                { key: 'system_audio_enabled', label: language === 'de' ? 'System-Audio' : 'System Audio' }
              ].map((feature) => (
                <div key={feature.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: 'white', fontSize: '12px' }}>{feature.label}</span>
                  <button
                    onClick={() => handleSettingChange(feature.key as keyof UserSettings, !settings[feature.key as keyof UserSettings])}
                    style={{
                      width: '40px',
                      height: '20px',
                      borderRadius: '10px',
                      border: 'none',
                      background: settings[feature.key as keyof UserSettings] ? '#3b82f6' : 'rgba(255, 255, 255, 0.2)',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: 'white',
                        position: 'absolute',
                        top: '2px',
                        left: settings[feature.key as keyof UserSettings] ? '22px' : '2px',
                        transition: 'all 0.2s ease'
                      }}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ color: 'white', fontSize: '14px', marginBottom: '12px', display: 'block' }}>
                {language === 'de' ? 'Datenschutz-Einstellungen' : 'Privacy Settings'}
              </label>
              
              {[
                { key: 'consent_training', label: language === 'de' ? 'Training-Daten verwenden' : 'Use training data' },
                { key: 'consent_analytics', label: language === 'de' ? 'Analytics erlauben' : 'Allow analytics' },
                { key: 'consent_storage', label: language === 'de' ? 'Lokale Speicherung' : 'Local storage' }
              ].map((consent) => (
                <div key={consent.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ color: 'white', fontSize: '12px' }}>{consent.label}</span>
                  <button
                    onClick={() => handleSettingChange(consent.key as keyof UserSettings, !settings[consent.key as keyof UserSettings])}
                    style={{
                      width: '40px',
                      height: '20px',
                      borderRadius: '10px',
                      border: 'none',
                      background: settings[consent.key as keyof UserSettings] ? '#3b82f6' : 'rgba(255, 255, 255, 0.2)',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: 'white',
                        position: 'absolute',
                        top: '2px',
                        left: settings[consent.key as keyof UserSettings] ? '22px' : '2px',
                        transition: 'all 0.2s ease'
                      }}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h3 style={{ color: 'white', fontSize: '16px', marginBottom: '8px' }}>EVIA Desktop</h3>
              <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px', lineHeight: '1.5' }}>
                {language === 'de' 
                  ? 'EVIA Desktop Overlay - Intelligente Audio-Transkription und KI-Assistenz'
                  : 'EVIA Desktop Overlay - Intelligent audio transcription and AI assistance'
                }
              </p>
            </div>
            
            <div>
              <h4 style={{ color: 'white', fontSize: '14px', marginBottom: '8px' }}>
                {language === 'de' ? 'Version' : 'Version'}
              </h4>
              <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}>1.0.0-dev</p>
            </div>

            <div>
              <h4 style={{ color: 'white', fontSize: '14px', marginBottom: '8px' }}>
                {language === 'de' ? 'Tastenkürzel' : 'Keyboard Shortcuts'}
              </h4>
              <div style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px', lineHeight: '1.5' }}>
                <div>⌘ + \ - {language === 'de' ? 'Ein-/Ausblenden' : 'Show/Hide'}</div>
                <div>⌘ + Enter - {language === 'de' ? 'Ask View öffnen' : 'Open Ask View'}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export { SettingsView };
export default SettingsView;
