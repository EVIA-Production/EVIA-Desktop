import React, { useState, useEffect } from 'react';
import SimpleEviaBar from './SimpleEviaBar';
import SimpleListenView from './SimpleListenView';
import SimpleAskView from './SimpleAskView';
import SimpleSettingsView from './SimpleSettingsView';

export const EviaOverlay: React.FC = () => {
    const [currentView, setCurrentView] = useState<'listen' | 'ask' | 'settings' | null>(null);
    const [isVisible, setIsVisible] = useState(true);
    const [isListening, setIsListening] = useState(false);
    const [language, setLanguage] = useState<'de' | 'en'>('de');

    // Global shortcuts handling
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // ⌘ + \ = Toggle visibility
            if (e.metaKey && e.key === '\\') {
                e.preventDefault();
                setIsVisible(prev => !prev);
            }
            
            // ⌘ + Enter = Switch to Ask view
            if (e.metaKey && e.key === 'Enter') {
                e.preventDefault();
                setCurrentView('ask');
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    // IPC communication with main process
    useEffect(() => {
        // Listen for IPC messages from main process
        if (window.evia) {
            // Use existing EVIA bridge for communication
            console.log('EVIA bridge available');
        }

        // Listen for global shortcut events
        const handleShortcutAskView = () => {
            setCurrentView('ask');
        };

        // Add event listeners for IPC messages
        window.addEventListener('shortcut:ask-view', handleShortcutAskView);

        return () => {
            window.removeEventListener('shortcut:ask-view', handleShortcutAskView);
        };
    }, []);

    if (!isVisible) {
        return null;
    }

    return (
        <div className="evia-overlay">
            {/* EVIA Bar - Always visible */}
            <SimpleEviaBar
                currentView={currentView}
                onViewChange={setCurrentView}
                isListening={isListening}
                onListeningChange={setIsListening}
                language={language}
                onLanguageChange={setLanguage}
                onToggleVisibility={() => setIsVisible(false)}
            />

            {/* Glass Windows */}
            {currentView === 'listen' && (
                <SimpleListenView
                    isListening={isListening}
                    language={language}
                    onClose={() => setCurrentView(null)}
                />
            )}

            {currentView === 'ask' && (
                <SimpleAskView
                    language={language}
                    onClose={() => setCurrentView(null)}
                />
            )}

            {currentView === 'settings' && (
                <SimpleSettingsView
                    language={language}
                    onLanguageChange={setLanguage}
                    onClose={() => setCurrentView(null)}
                />
            )}
        </div>
    );
};
