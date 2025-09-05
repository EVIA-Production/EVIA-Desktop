import React from 'react';

interface SimpleEviaBarProps {
  currentView: 'listen' | 'ask' | 'settings' | null;
  onViewChange: (view: 'listen' | 'ask' | 'settings' | null) => void;
  isListening: boolean;
  onListeningChange: (listening: boolean) => void;
  language: 'de' | 'en';
  onLanguageChange: (language: 'de' | 'en') => void;
  onToggleVisibility: () => void;
}

export const SimpleEviaBar: React.FC<SimpleEviaBarProps> = ({
  currentView,
  onViewChange,
  isListening,
  onListeningChange,
  language,
  onLanguageChange,
  onToggleVisibility
}) => {
  return (
    <div className="evia-bar glass-overlay p-3 rounded-lg shadow-lg">
      <div className="flex items-center gap-3">
        {/* Listen Button */}
        <button
          onClick={() => onViewChange(currentView === 'listen' ? null : 'listen')}
          className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            currentView === 'listen'
              ? 'bg-blue-600 text-white'
              : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          {isListening ? '🎤 Listening' : '🎤 Listen'}
        </button>

        {/* Ask Button */}
        <button
          onClick={() => onViewChange(currentView === 'ask' ? null : 'ask')}
          className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            currentView === 'ask'
              ? 'bg-green-600 text-white'
              : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          💡 Ask
        </button>

        {/* Settings Button */}
        <button
          onClick={() => onViewChange(currentView === 'settings' ? null : 'settings')}
          className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            currentView === 'settings'
              ? 'bg-gray-600 text-white'
              : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          ⚙️ Settings
        </button>

        {/* Language Toggle */}
        <button
          onClick={() => onLanguageChange(language === 'de' ? 'en' : 'de')}
          className="px-3 py-2 rounded-md text-sm font-medium bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          {language === 'de' ? '🇩🇪' : '🇺🇸'}
        </button>

        {/* Hide Button */}
        <button
          onClick={onToggleVisibility}
          className="px-3 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          ✕ Hide
        </button>
      </div>
    </div>
  );
};

export default SimpleEviaBar;
