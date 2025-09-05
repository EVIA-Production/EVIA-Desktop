import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { 
  Mic, 
  MicOff, 
  MessageSquare, 
  Settings, 
  X,
  Minimize2,
  Maximize2,
  Square
} from 'lucide-react';
// Temporär deaktiviert für Testing ohne Anmeldung
// import { useAuth } from '@/contexts/AuthContext';
import EviaBar from '../components/GlassUI/EviaBar';
import ListenView from '../components/GlassUI/ListenView';
import AskView from '../components/GlassUI/AskView';
import SettingsView from '../components/GlassUI/SettingsView';
import { glassUIService } from '../services/glassUIService';

// Mock data for development
const mockTranscript = [
  {
    id: '1',
    text: 'Willkommen zum EVIA Meeting. Heute besprechen wir die Q4-Strategie.',
    speaker: 0,
    is_final: true,
    timestamp: new Date(Date.now() - 300000).toISOString()
  },
  {
    id: '2',
    text: 'Danke für die Einladung. Ich denke, wir sollten uns auf die wichtigsten KPIs konzentrieren.',
    speaker: 1,
    is_final: true,
    timestamp: new Date(Date.now() - 240000).toISOString()
  },
  {
    id: '3',
    text: 'Absolut. Die Umsatzziele für Q4 sind sehr ambitioniert.',
    speaker: 0,
    is_final: true,
    timestamp: new Date(Date.now() - 180000).toISOString()
  }
];

const mockInsights = [
  {
    id: '1',
    type: 'summary' as const,
    text: 'Q4-Strategie Meeting mit Fokus auf KPIs und Umsatzziele',
    timestamp: new Date(Date.now() - 120000).toISOString(),
    index: 0
  },
  {
    id: '2',
    type: 'action' as const,
    text: 'Umsatzziele für Q4 definieren und priorisieren',
    timestamp: new Date(Date.now() - 60000).toISOString(),
    index: 1
  },
  {
    id: '3',
    type: 'followup' as const,
    text: 'Nächste Schritte: KPIs analysieren und Aktionsplan erstellen',
    timestamp: new Date(Date.now() - 30000).toISOString(),
    index: 2
  }
];

const Desktop: React.FC = () => {
  // Temporär deaktiviert für Testing ohne Anmeldung
  // const { user } = useAuth();
  const user = { id: 'demo', username: 'demo', email: 'demo@evia.com' }; // Mock user
  const [currentView, setCurrentView] = useState<'listen' | 'ask' | 'settings' | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [language, setLanguage] = useState<'de' | 'en'>('de');
  const [transcript, setTranscript] = useState(mockTranscript);
  const [insights, setInsights] = useState(mockInsights);
  const [hasNewInsights, setHasNewInsights] = useState(true);
  const [isVisible, setIsVisible] = useState(true);

  // Simulate WebSocket connection with Glass UI Service
  useEffect(() => {
    const interval = setInterval(() => {
      if (isListening && isConnected) {
        // Verwende Glass UI Service für neue Transkript-Segmente
        const newSegment = glassUIService.generateMockTranscriptSegment();
        setTranscript(prev => [...prev, newSegment]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isListening, isConnected]);

  // Simulate insights generation with Glass UI Service
  useEffect(() => {
    if (transcript.length > 5 && !hasNewInsights) {
      // Verwende Glass UI Service für neue Insights
      const newInsight = glassUIService.generateMockInsight();
      setInsights(prev => [...prev, newInsight]);
      setHasNewInsights(true);
    }
  }, [transcript.length, hasNewInsights]);

  const handleToggleListening = useCallback(() => {
    setIsListening(prev => !prev);
    if (!isListening) {
      // Start listening - would connect to WebSocket here
      console.log('Starting transcription...');
    } else {
      // Stop listening
      console.log('Stopping transcription...');
    }
  }, [isListening]);

  const handleOpenAsk = useCallback(() => {
    setCurrentView('ask');
    setHasNewInsights(false);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setCurrentView('settings');
  }, []);

  const handleToggleVisibility = useCallback(() => {
    setIsVisible(prev => !prev);
  }, []);

  const handleLanguageChange = useCallback((newLanguage: 'de' | 'en') => {
    setLanguage(newLanguage);
    // Here you would notify the audio pipeline to use the new language
    console.log('Language changed to:', newLanguage);
  }, []);

  const handleCloseView = useCallback(() => {
    setCurrentView(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + \ to show/hide
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        console.log('Keyboard shortcut: Toggle visibility');
        handleToggleVisibility();
      }
      
      // Ctrl/Cmd + Enter to open Ask view
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        console.log('Keyboard shortcut: Open Ask view');
        handleOpenAsk();
      }
    };

    // Add event listener to window instead of document
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleVisibility, handleOpenAsk]);

  if (!user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <h1 className="text-2xl mb-4">Nicht angemeldet</h1>
          <p>Bitte melden Sie sich an, um EVIA zu verwenden.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* EVIA Bar - Always visible when app is running */}
      <EviaBar
        isListening={isListening}
        onToggleListening={handleToggleListening}
        onOpenAsk={handleOpenAsk}
        onOpenSettings={handleOpenSettings}
        onToggleVisibility={handleToggleVisibility}
        isVisible={isVisible}
        isConnected={isConnected}
        language={language}
        hasNewInsights={hasNewInsights}
      />

      {/* Main Views - Only shown when EVIA Bar is visible */}
      {isVisible && currentView && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-8">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseView}
          />
          
          {/* View Container */}
          <div className="relative w-full max-w-6xl h-full max-h-[90vh] bg-transparent">
            {/* Window Controls */}
            <div className="absolute top-4 right-4 flex items-center gap-2 z-50">
              <Button
                variant="ghost"
                size="sm"
                className="w-8 h-8 p-0 bg-white/10 hover:bg-white/20 text-white rounded-full"
                onClick={() => {/* Minimize */}}
              >
                <Minimize2 className="h-4 w-4" />
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                className="w-8 h-8 p-0 bg-white/10 hover:bg-white/20 text-white rounded-full"
                onClick={() => {/* Maximize */}}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                className="w-8 h-8 p-0 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-full"
                onClick={handleCloseView}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* View Content */}
            <div className="w-full h-full">
              {currentView === 'listen' && (
                <ListenView
                  isListening={isListening}
                  onToggleListening={handleToggleListening}
                  onOpenSettings={handleOpenSettings}
                  transcript={transcript}
                  isConnected={isConnected}
                  language={language}
                />
              )}
              
              {currentView === 'ask' && (
                <AskView
                  insights={insights}
                  onOpenSettings={handleOpenSettings}
                  language={language}
                  chatId={1} // Mock chat ID
                />
              )}
              
              {currentView === 'settings' && (
                <SettingsView
                  onClose={handleCloseView}
                  language={language}
                  onLanguageChange={handleLanguageChange}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Access Buttons - When no view is open */}
      {isVisible && !currentView && (
        <div className="fixed bottom-8 right-8 z-30">
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => setCurrentView('listen')}
              className="w-16 h-16 rounded-full bg-green-600 hover:bg-green-700 text-white shadow-2xl"
              title="Transkription starten"
            >
              <Mic className="h-6 w-6" />
            </Button>
            
            <Button
              onClick={handleOpenAsk}
              className="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-2xl"
              title="Insights anzeigen"
            >
              <MessageSquare className="h-6 w-6" />
            </Button>
            
            <Button
              onClick={handleOpenSettings}
              className="w-16 h-16 rounded-full bg-gray-600 hover:bg-gray-700 text-white shadow-2xl"
              title="Einstellungen"
            >
              <Settings className="h-6 w-6" />
            </Button>
          </div>
        </div>
      )}

      {/* Status Bar */}
      {isVisible && (
        <div className="fixed bottom-4 left-4 z-30">
          <div className="flex items-center gap-3 bg-black/80 backdrop-blur-md rounded-full px-4 py-2 border border-white/20">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-white/80 text-sm">
              {isConnected ? 'Verbunden' : 'Nicht verbunden'}
            </span>
            
            <div className="w-px h-4 bg-white/20" />
            
            <Badge variant="outline" className="border-white/20 text-white/80 text-xs">
              {language.toUpperCase()}
            </Badge>
            
            {isListening && (
              <>
                <div className="w-px h-4 bg-white/20" />
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                  <span className="text-red-400 text-sm">Aufnahme läuft</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}


      {/* Welcome Message - When no view is open */}
      {isVisible && !currentView && (
        <div className="fixed inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="text-center text-white/40">
            <h1 className="text-6xl font-bold mb-4">EVIA</h1>
            <p className="text-xl">
              Drücken Sie <kbd className="px-2 py-1 bg-white/10 rounded text-sm">⌘ + \</kbd> um die EVIA Bar zu verstecken
            </p>
            <p className="text-lg mt-2">
              Drücken Sie <kbd className="px-2 py-1 bg-white/10 rounded text-sm">⌘ + Enter</kbd> für KI-Insights
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Desktop;
