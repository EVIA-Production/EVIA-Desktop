import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { 
  Globe, 
  Mic, 
  Volume2, 
  Settings as SettingsIcon,
  Shield,
  User,
  Monitor,
  Zap
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { glassUIService, UserSettings } from '@/services/glassUIService';

interface SettingsViewProps {
  onClose: () => void;
  language: 'de' | 'en';
  onLanguageChange: (language: 'de' | 'en') => void;
}

// UserSettings interface wird jetzt aus dem Service importiert

const SettingsView: React.FC<SettingsViewProps> = ({
  onClose,
  language,
  onLanguageChange
}) => {
  const [settings, setSettings] = useState<UserSettings>({
    language: 'de',
    providers: {},
    profile: { name: 'sales' }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  // Feature flags (as per requirements)
  const [featureFlags, setFeatureFlags] = useState({
    AEC_ENABLED: false,
    DIARIZATION_ENABLED: false,
    SYSTEM_AUDIO_ENABLED: false,
    WEB_SEARCH_ENABLED: false
  });

  useEffect(() => {
    loadUserSettings();
  }, []);

  const loadUserSettings = async () => {
    try {
      const data = await glassUIService.getSettings();
      setSettings(data);
      onLanguageChange(data.language);
    } catch (error) {
      console.warn('Failed to load user settings:', error);
      // Use defaults if API fails
    }
  };

  const updateLanguage = async (newLanguage: 'de' | 'en') => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await glassUIService.updateSettings({
        language: newLanguage
      });

      if (result.success) {
        setSettings(prev => ({ ...prev, language: newLanguage }));
        onLanguageChange(newLanguage);
      } else {
        throw new Error('Failed to update language');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update language');
    } finally {
      setIsLoading(false);
    }
  };

  const getLanguageLabel = (lang: string) => {
    switch (lang) {
      case 'de':
        return 'Deutsch';
      case 'en':
        return 'English';
      default:
        return lang;
    }
  };

  const getProfileLabel = (profile: string) => {
    switch (profile) {
      case 'sales':
        return language === 'de' ? 'Vertrieb' : 'Sales';
      case 'support':
        return language === 'de' ? 'Support' : 'Support';
      case 'general':
        return language === 'de' ? 'Allgemein' : 'General';
      default:
        return profile;
    }
  };

  return (
    <div className="flex flex-col h-full bg-black/20 backdrop-blur-md rounded-lg border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-white" />
          <h2 className="text-lg font-semibold text-white">
            {language === 'de' ? 'Einstellungen' : 'Settings'}
          </h2>
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-white/80 hover:text-white"
        >
          ✕
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-6">
          {/* Language Settings */}
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Globe className="h-5 w-5" />
                {language === 'de' ? 'Sprache' : 'Language'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white/80">
                  {language === 'de' ? 'Transkriptionssprache' : 'Transcription Language'}
                </Label>
                <Select value={settings.language} onValueChange={updateLanguage}>
                  <SelectTrigger className="bg-white/10 border-white/20 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black/90 border-white/20 text-white">
                    <SelectItem value="de">Deutsch (Standard)</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-white/60">
                  {language === 'de' 
                    ? 'Diese Sprache wird für alle neuen Aufnahmen verwendet' 
                    : 'This language will be used for all new recordings'
                  }
                </p>
              </div>
              
              {error && (
                <div className="text-red-400 text-sm bg-red-400/10 p-2 rounded">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Audio Settings */}
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Mic className="h-5 w-5" />
                {language === 'de' ? 'Audio-Einstellungen' : 'Audio Settings'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-white/80">
                    {language === 'de' ? 'Mikrofon' : 'Microphone'}
                  </Label>
                  <p className="text-xs text-white/60">
                    {language === 'de' 
                      ? 'Live-Transkription über Mikrofon' 
                      : 'Live transcription via microphone'
                    }
                  </p>
                </div>
                <Badge variant="default" className="bg-green-600">
                  {language === 'de' ? 'Aktiviert' : 'Enabled'}
                </Badge>
              </div>

              <Separator className="bg-white/20" />

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-white/80">
                    {language === 'de' ? 'System-Audio' : 'System Audio'}
                  </Label>
                  <p className="text-xs text-white/60">
                    {language === 'de' 
                      ? 'Aufnahme von System-Audio (macOS)' 
                      : 'System audio capture (macOS)'
                    }
                  </p>
                </div>
                <Switch
                  checked={featureFlags.SYSTEM_AUDIO_ENABLED}
                  onCheckedChange={(checked) => 
                    setFeatureFlags(prev => ({ ...prev, SYSTEM_AUDIO_ENABLED: checked }))
                  }
                  className="data-[state=checked]:bg-green-600"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-white/80">
                    {language === 'de' ? 'AEC (Echo-Cancellation)' : 'AEC (Echo Cancellation)'}
                  </Label>
                  <p className="text-xs text-white/60">
                    {language === 'de' 
                      ? 'Automatische Echo-Unterdrückung' 
                      : 'Automatic echo cancellation'
                    }
                  </p>
                </div>
                <Switch
                  checked={featureFlags.AEC_ENABLED}
                  onCheckedChange={(checked) => 
                    setFeatureFlags(prev => ({ ...prev, AEC_ENABLED: checked }))
                  }
                  className="data-[state=checked]:bg-green-600"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-white/80">
                    {language === 'de' ? 'Sprecher-Erkennung' : 'Speaker Diarization'}
                  </Label>
                  <p className="text-xs text-white/60">
                    {language === 'de' 
                      ? 'Unterscheidung zwischen verschiedenen Sprechern' 
                      : 'Distinguish between different speakers'
                    }
                  </p>
                </div>
                <Switch
                  checked={featureFlags.DIARIZATION_ENABLED}
                  onCheckedChange={(checked) => 
                    setFeatureFlags(prev => ({ ...prev, DIARIZATION_ENABLED: checked }))
                  }
                  className="data-[state=checked]:bg-green-600"
                />
              </div>
            </CardContent>
          </Card>

          {/* Profile Settings */}
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <User className="h-5 w-5" />
                {language === 'de' ? 'Profil' : 'Profile'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-white/80">
                  {language === 'de' ? 'Aktuelles Profil' : 'Current Profile'}
                </Label>
                <Badge variant="outline" className="border-white/20 text-white/80">
                  {getProfileLabel(settings.profile.name)}
                </Badge>
                <p className="text-xs text-white/60">
                  {language === 'de' 
                    ? 'Das Profil bestimmt die KI-Prompts und Antworten' 
                    : 'Profile determines AI prompts and responses'
                  }
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Privacy & Security */}
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {language === 'de' ? 'Datenschutz & Sicherheit' : 'Privacy & Security'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white/80">
                  {language === 'de' ? 'Datenverarbeitung' : 'Data Processing'}
                </Label>
                <p className="text-xs text-white/60">
                  {language === 'de' 
                    ? 'Alle Daten werden verschlüsselt übertragen und sicher gespeichert' 
                    : 'All data is encrypted in transit and securely stored'
                  }
                </p>
              </div>
              
              <div className="space-y-2">
                <Label className="text-white/80">
                  {language === 'de' ? 'Training' : 'Training'}
                </Label>
                <p className="text-xs text-white/60">
                  {language === 'de' 
                    ? 'Ihre Daten werden nicht für KI-Training verwendet' 
                    : 'Your data is not used for AI training'
                  }
                </p>
              </div>
            </CardContent>
          </Card>

          {/* System Info */}
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Monitor className="h-5 w-5" />
                {language === 'de' ? 'System-Informationen' : 'System Information'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/60">EVIA Version:</span>
                <span className="text-white">1.0.0</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Backend:</span>
                <span className="text-white">Connected</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Language:</span>
                <span className="text-white">{getLanguageLabel(settings.language)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center justify-between">
          <div className="text-xs text-white/50">
            {language === 'de' 
              ? 'Einstellungen werden automatisch gespeichert' 
              : 'Settings are saved automatically'
            }
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-white/20 text-white hover:bg-white/10"
          >
            {language === 'de' ? 'Schließen' : 'Close'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
