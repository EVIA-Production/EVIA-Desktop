import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
// Temporär deaktiviert für Testing ohne Anmeldung
// import { useAuth } from '@/contexts/AuthContext';

interface EviaBarProps {
  isListening: boolean;
  onToggleListening: () => void;
  onOpenAsk: () => void;
  onOpenSettings: () => void;
  onToggleVisibility: () => void;
  isVisible: boolean;
  isConnected: boolean;
  language: 'de' | 'en';
  hasNewInsights: boolean;
}

const EviaBar: React.FC<EviaBarProps> = ({
  isListening,
  onToggleListening,
  onOpenAsk,
  onOpenSettings,
  onToggleVisibility,
  isVisible,
  isConnected,
  language,
  hasNewInsights
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  // Temporär deaktiviert für Testing ohne Anmeldung
  // const { user } = useAuth();
  const user = { id: 'demo', username: 'demo', email: 'demo@evia.com' }; // Mock user

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

  const getStatusColor = () => {
    if (!isConnected) return 'bg-red-600';
    if (isListening) return 'bg-green-600';
    return 'bg-blue-600';
  };

  const getStatusText = () => {
    if (!isConnected) return language === 'de' ? 'Offline' : 'Offline';
    if (isListening) return language === 'de' ? 'Höre zu' : 'Listening';
    return language === 'de' ? 'Bereit' : 'Ready';
  };

  const getLanguageLabel = (lang: string) => {
    switch (lang) {
      case 'de':
        return 'DE';
      case 'en':
        return 'EN';
      default:
        return lang.toUpperCase();
    }
  };

  return (
    <div
      className={`fixed z-50 transition-all duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(0, 0)'
      }}
    >
      {/* Main Bar */}
      <div className="flex flex-col items-center">
        {/* Expand/Collapse Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-8 h-8 p-0 bg-black/80 hover:bg-black/90 text-white rounded-full mb-2 shadow-lg"
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>

        {/* Main Bar */}
        <div className="bg-black/90 backdrop-blur-md rounded-full p-2 shadow-2xl border border-white/20">
          <div className="flex flex-col items-center gap-2">
            {/* Status Indicator */}
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()} mb-1`} />
              <span className="text-xs text-white/80 font-medium">
                {getStatusText()}
              </span>
            </div>

            {/* Language Badge */}
            <Badge variant="outline" className="border-white/20 text-white/80 text-xs px-2 py-1">
              {getLanguageLabel(language)}
            </Badge>

            {/* Main Controls */}
            <div className="flex flex-col gap-2">
              {/* Listen Button */}
              <Button
                onClick={onToggleListening}
                variant="ghost"
                size="sm"
                className={`w-12 h-12 p-0 rounded-full transition-all ${
                  isListening 
                    ? 'bg-red-600 hover:bg-red-700 text-white' 
                    : 'bg-green-600 hover:bg-green-700 text-white'
                } shadow-lg`}
                disabled={!isConnected}
              >
                {isListening ? (
                  <MicOff className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </Button>

              {/* Ask Button */}
              <Button
                onClick={onOpenAsk}
                variant="ghost"
                size="sm"
                className="w-12 h-12 p-0 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg relative"
                disabled={!isConnected}
              >
                <MessageSquare className="h-5 w-5" />
                {hasNewInsights && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
                )}
              </Button>

              {/* Settings Button */}
              <Button
                onClick={onOpenSettings}
                variant="ghost"
                size="sm"
                className="w-12 h-12 p-0 bg-gray-600 hover:bg-gray-700 text-white rounded-full shadow-lg"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </div>

            {/* Hide Button */}
            <Button
              onClick={onToggleVisibility}
              variant="ghost"
              size="sm"
              className="w-8 h-8 p-0 bg-white/10 hover:bg-white/20 text-white/80 rounded-full"
            >
              <EyeOff className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Expanded Info Panel */}
        {isExpanded && (
          <div className="mt-4 bg-black/90 backdrop-blur-md rounded-lg p-4 shadow-2xl border border-white/20 min-w-48">
            <div className="space-y-3 text-white">
              {/* User Info */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-medium">
                  {user?.full_name?.charAt(0) || 'U'}
                </div>
                <div>
                  <p className="font-medium text-sm">{user?.full_name || 'User'}</p>
                  <p className="text-xs text-white/60">{user?.email}</p>
                </div>
              </div>

              <div className="border-t border-white/20 pt-2">
                {/* Connection Status */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/80">
                    {language === 'de' ? 'Verbindung' : 'Connection'}
                  </span>
                  <Badge variant={isConnected ? "default" : "destructive"} className="text-xs">
                    {isConnected ? 'Online' : 'Offline'}
                  </Badge>
                </div>

                {/* Language */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/80">
                    {language === 'de' ? 'Sprache' : 'Language'}
                  </span>
                  <span className="text-white">{getLanguageLabel(language)}</span>
                </div>

                {/* Recording Status */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/80">
                    {language === 'de' ? 'Aufnahme' : 'Recording'}
                  </span>
                  <Badge variant={isListening ? "destructive" : "secondary"} className="text-xs">
                    {isListening 
                      ? (language === 'de' ? 'Aktiv' : 'Active')
                      : (language === 'de' ? 'Gestoppt' : 'Stopped')
                    }
                  </Badge>
                </div>

                {/* New Insights */}
                {hasNewInsights && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/80">
                      {language === 'de' ? 'Neue Insights' : 'New Insights'}
                    </span>
                    <Badge variant="default" className="bg-orange-600 text-xs">
                      <Zap className="h-3 w-3 mr-1" />
                      {language === 'de' ? 'Verfügbar' : 'Available'}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Quick Actions */}
              <div className="border-t border-white/20 pt-2">
                <p className="text-xs text-white/60 mb-2">
                  {language === 'de' ? 'Schnellzugriff' : 'Quick Access'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenAsk}
                    className="text-xs border-white/20 text-white hover:bg-white/10"
                    disabled={!isConnected}
                  >
                    {language === 'de' ? 'Insights' : 'Insights'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenSettings}
                    className="text-xs border-white/20 text-white hover:bg-white/10"
                  >
                    {language === 'de' ? 'Einstellungen' : 'Settings'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drag Handle */}
      <div
        className="absolute inset-0 cursor-move"
        onMouseDown={handleMouseDown}
        style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
      />
    </div>
  );
};

export default EviaBar;
