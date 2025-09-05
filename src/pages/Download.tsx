import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Download as DownloadIcon, 
  Apple, 
  Monitor, 
  CheckCircle, 
  AlertTriangle,
  Zap,
  Shield,
  Globe,
  Mic,
  MessageSquare,
  Settings,
  ArrowRight
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const Download: React.FC = () => {
  const { user } = useAuth();
  const [selectedPlatform, setSelectedPlatform] = useState<'mac' | 'windows'>('mac');

  const handleDownload = (platform: 'mac' | 'windows') => {
    if (platform === 'mac') {
      // For now, this would be a placeholder download link
      // In production, this would point to the actual macOS installer
      window.open('#', '_blank');
    } else {
      // Windows version not available yet
      alert('Windows-Version wird in Kürze verfügbar sein!');
    }
  };

  const getSystemRequirements = (platform: 'mac' | 'windows') => {
    if (platform === 'mac') {
      return {
        os: 'macOS 12.0 (Monterey) oder höher',
        processor: 'Apple Silicon (M1/M2) oder Intel Core i5',
        memory: '8 GB RAM',
        storage: '500 MB freier Speicherplatz',
        features: ['Mikrofon-Zugriff', 'Screen Recording (optional)', 'Benachrichtigungen']
      };
    } else {
      return {
        os: 'Windows 10 (Version 1903) oder höher',
        processor: 'Intel Core i5 oder AMD Ryzen 5',
        memory: '8 GB RAM',
        storage: '500 MB freier Speicherplatz',
        features: ['Mikrofon-Zugriff', 'Audio Loopback (optional)', 'Benachrichtigungen']
      };
    }
  };

  const requirements = getSystemRequirements(selectedPlatform);

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-black to-purple-950/20 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
              <DownloadIcon className="h-12 w-12 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-4">
            EVIA Desktop herunterladen
          </h1>
          <p className="text-xl text-white/80 max-w-2xl mx-auto">
            Laden Sie die EVIA Desktop-App herunter und nutzen Sie alle Funktionen direkt auf Ihrem Computer
          </p>
        </div>

        {/* Platform Selection */}
        <div className="max-w-4xl mx-auto mb-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* macOS */}
            <Card 
              className={`cursor-pointer transition-all ${
                selectedPlatform === 'mac' 
                  ? 'bg-blue-600/20 border-blue-500/50' 
                  : 'bg-black/30 border-white/10 hover:bg-black/40'
              } text-white`}
              onClick={() => setSelectedPlatform('mac')}
            >
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <Apple className="h-16 w-16 text-blue-400" />
                </div>
                <CardTitle className="text-white text-2xl">macOS</CardTitle>
                <Badge variant="default" className="bg-green-600">
                  Verfügbar
                </Badge>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-white/80 mb-4">
                  Optimiert für Apple Silicon und Intel Macs
                </p>
                <ul className="text-sm text-white/60 space-y-1">
                  <li>• Native macOS Integration</li>
                  <li>• ScreenCaptureKit Support</li>
                  <li>• Optimierte Performance</li>
                </ul>
              </CardContent>
            </Card>

            {/* Windows */}
            <Card 
              className={`cursor-pointer transition-all ${
                selectedPlatform === 'windows' 
                  ? 'bg-blue-600/20 border-blue-500/50' 
                  : 'bg-black/30 border-white/10 hover:bg-black/40'
              } text-white`}
              onClick={() => setSelectedPlatform('windows')}
            >
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <Monitor className="h-16 w-16 text-blue-400" />
                </div>
                <CardTitle className="text-white text-2xl">Windows</CardTitle>
                <Badge variant="outline" className="border-orange-400 text-orange-400">
                  Bald verfügbar
                </Badge>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-white/80 mb-4">
                  Windows 10/11 Support in Entwicklung
                </p>
                <ul className="text-sm text-white/60 space-y-1">
                  <li>• Windows Audio Stack</li>
                  <li>• DirectX Integration</li>
                  <li>• Windows 11 Optimized</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Download Section */}
        <div className="max-w-4xl mx-auto mb-12">
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader className="text-center">
              <CardTitle className="text-white text-2xl">
                {selectedPlatform === 'mac' ? 'macOS Version herunterladen' : 'Windows Version'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {selectedPlatform === 'mac' ? (
                <div className="text-center">
                  <div className="mb-6">
                    <Badge variant="outline" className="border-green-400 text-green-400 text-lg px-4 py-2">
                      Version 1.0.0
                    </Badge>
                  </div>
                  
                  <Button
                    onClick={() => handleDownload('mac')}
                    className="bg-green-600 hover:bg-green-700 text-white text-lg px-8 py-4"
                    size="lg"
                  >
                    <DownloadIcon className="h-6 w-6 mr-2" />
                    Für macOS herunterladen
                  </Button>
                  
                  <p className="text-sm text-white/60 mt-4">
                    Dateigröße: ~45 MB • Entwickler-signiert
                  </p>
                  
                  <div className="mt-6 p-4 bg-green-600/20 rounded-lg border border-green-500/30">
                    <div className="flex items-center gap-2 text-green-400 mb-2">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Sicherer Download</span>
                    </div>
                    <p className="text-sm text-green-300">
                      Diese App ist von EVIA signiert und wurde von Apple verifiziert. 
                      Keine Warnungen beim ersten Start.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="mb-6">
                    <Badge variant="outline" className="border-orange-400 text-orange-400 text-lg px-4 py-2">
                      In Entwicklung
                    </Badge>
                  </div>
                  
                  <div className="p-6 bg-orange-600/20 rounded-lg border border-orange-500/30">
                    <div className="flex items-center gap-2 text-orange-400 mb-2">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="font-medium">Windows-Version in Arbeit</span>
                    </div>
                    <p className="text-sm text-orange-300 mb-4">
                      Wir arbeiten hart daran, EVIA für Windows verfügbar zu machen. 
                      Die Beta-Version wird in den nächsten Wochen veröffentlicht.
                    </p>
                    
                    <Button
                      variant="outline"
                      className="border-orange-400 text-orange-400 hover:bg-orange-400/20"
                    >
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Auf Warteliste setzen
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* System Requirements */}
        <div className="max-w-4xl mx-auto mb-12">
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Monitor className="h-5 w-5 text-blue-400" />
                Systemanforderungen - {selectedPlatform === 'mac' ? 'macOS' : 'Windows'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-white mb-2">Betriebssystem</h4>
                    <p className="text-white/60">{requirements.os}</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-white mb-2">Prozessor</h4>
                    <p className="text-white/60">{requirements.processor}</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-white mb-2">Arbeitsspeicher</h4>
                    <p className="text-white/60">{requirements.memory}</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-white mb-2">Speicherplatz</h4>
                    <p className="text-white/60">{requirements.storage}</p>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-white mb-2">Erforderliche Berechtigungen</h4>
                  <ul className="space-y-2">
                    {requirements.features.map((feature, index) => (
                      <li key={index} className="flex items-center gap-2 text-white/60">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Features */}
        <div className="max-w-4xl mx-auto mb-12">
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white text-center">
                Was Sie mit der Desktop-App erwartet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Mic className="h-8 w-8 text-green-400" />
                  </div>
                  <h4 className="font-medium text-white mb-2">Live-Transkription</h4>
                  <p className="text-sm text-white/60">
                    Echtzeit-Transkription von Meetings und Gesprächen direkt auf Ihrem Computer
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="h-8 w-8 text-blue-400" />
                  </div>
                  <h4 className="font-medium text-white mb-2">KI-Insights</h4>
                  <p className="text-sm text-white/60">
                    Automatische Zusammenfassungen und Aktionspunkte aus Ihren Gesprächen
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="w-16 h-16 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Settings className="h-8 w-8 text-purple-400" />
                  </div>
                  <h4 className="font-medium text-white mb-2">Vollständige Kontrolle</h4>
                  <p className="text-sm text-white/60">
                    Alle Einstellungen und Funktionen direkt in der Desktop-App
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Installation Instructions */}
        <div className="max-w-4xl mx-auto mb-12">
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-400" />
                Installationsanleitung
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedPlatform === 'mac' ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      1
                    </div>
                    <div>
                      <h4 className="font-medium text-white">Download starten</h4>
                      <p className="text-sm text-white/60">
                        Klicken Sie auf den Download-Button oben und warten Sie, bis der Download abgeschlossen ist.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      2
                    </div>
                    <div>
                      <h4 className="font-medium text-white">App installieren</h4>
                      <p className="text-sm text-white/60">
                        Öffnen Sie die heruntergeladene .dmg-Datei und ziehen Sie EVIA in den Applications-Ordner.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      3
                    </div>
                    <div>
                      <h4 className="font-medium text-white">Erste Schritte</h4>
                      <p className="text-sm text-white/60">
                        Öffnen Sie EVIA aus dem Applications-Ordner und folgen Sie dem Setup-Assistenten.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      4
                    </div>
                    <div>
                      <h4 className="font-medium text-white">Berechtigungen erteilen</h4>
                      <p className="text-sm text-white/60">
                        Erlauben Sie EVIA den Zugriff auf Mikrofon und Benachrichtigungen.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertTriangle className="h-16 w-16 text-orange-400 mx-auto mb-4" />
                  <h4 className="font-medium text-white mb-2">Windows-Installation</h4>
                  <p className="text-white/60">
                    Detaillierte Installationsanleitung wird verfügbar sein, sobald die Windows-Version veröffentlicht wird.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center text-white/40">
          <p className="text-sm">
            EVIA Desktop • Sichere, intelligente Sprachverarbeitung direkt auf Ihrem Computer
          </p>
          <p className="text-xs mt-2">
            Powered by Groq • Made in Germany • Open Source
          </p>
        </div>
      </div>
    </div>
  );
};

export default Download;
