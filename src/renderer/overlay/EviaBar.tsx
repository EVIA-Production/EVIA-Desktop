import React, { useState, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  MessageSquare, 
  Settings, 
  Eye, 
  EyeOff,
  ChevronUp,
  ChevronDown,
  Zap
} from 'lucide-react';

interface EviaBarProps {
  currentView: 'listen' | 'ask' | 'settings' | null;
  onViewChange: (view: 'listen' | 'ask' | 'settings' | null) => void;
  isListening: boolean;
  onListeningChange: (listening: boolean) => void;
  language: 'de' | 'en';
  onLanguageChange: (lang: 'de' | 'en') => void;
  onToggleVisibility: () => void;
}

const EviaBar: React.FC<EviaBarProps> = ({
  currentView,
  onViewChange,
  isListening,
  onListeningChange,
  language,
  onLanguageChange,
  onToggleVisibility
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isConnected, setIsConnected] = useState(true);
  const [hasNewInsights, setHasNewInsights] = useState(false);

  // Handle drag and drop
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  const handleToggleListening = () => {
    onListeningChange(!isListening);
  };

  const handleOpenAsk = () => {
    onViewChange(currentView === 'ask' ? null : 'ask');
  };

  const handleOpenSettings = () => {
    onViewChange(currentView === 'settings' ? null : 'settings');
  };

  const handleToggleLanguage = () => {
    const newLang = language === 'de' ? 'en' : 'de';
    onLanguageChange(newLang);
  };

  return (
    <div 
      className="evia-bar glass-overlay"
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        zIndex: 1000,
        padding: '12px',
        borderRadius: '12px',
        background: 'rgba(0, 0, 0, 0.1)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: '60px',
        transition: 'all 0.2s ease'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Main Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Listen Button */}
        <button
          onClick={handleToggleListening}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '8px',
            border: 'none',
            background: isListening ? '#ef4444' : 'rgba(255, 255, 255, 0.1)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          title={isListening ? 'Stop Listening' : 'Start Listening'}
        >
          {isListening ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {/* Ask Button */}
        <button
          onClick={handleOpenAsk}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '8px',
            border: 'none',
            background: currentView === 'ask' ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
          title="Ask EVIA"
        >
          <MessageSquare size={20} />
          {hasNewInsights && (
            <div
              style={{
                position: 'absolute',
                top: '-2px',
                right: '-2px',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#ef4444'
              }}
            />
          )}
        </button>

        {/* Settings Button */}
        <button
          onClick={handleOpenSettings}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '8px',
            border: 'none',
            background: currentView === 'settings' ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          title="Settings"
        >
          <Settings size={20} />
        </button>

        {/* Hide Button */}
        <button
          onClick={onToggleVisibility}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '8px',
            border: 'none',
            background: 'rgba(255, 255, 255, 0.1)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          title="Hide EVIA"
        >
          <EyeOff size={20} />
        </button>
      </div>

      {/* Expanded Info */}
      {isExpanded && (
        <div style={{ 
          marginTop: '8px', 
          padding: '8px', 
          background: 'rgba(0, 0, 0, 0.2)',
          borderRadius: '8px',
          fontSize: '12px',
          color: 'white'
        }}>
          <div>Status: {isConnected ? 'Connected' : 'Disconnected'}</div>
          <div>Language: {language.toUpperCase()}</div>
          <div>Listening: {isListening ? 'Yes' : 'No'}</div>
        </div>
      )}

      {/* Expand/Collapse Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '44px',
          height: '24px',
          borderRadius: '4px',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.1)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: '12px'
        }}
      >
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
    </div>
  );
};

export { EviaBar };
export default EviaBar;
