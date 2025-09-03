import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Shield, 
  Lock, 
  Eye, 
  Download, 
  CheckCircle, 
  AlertTriangle,
  Globe,
  Zap,
  Users,
  Database,
  Mic,
  MessageSquare
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Label } from '@/components/ui/label';
import { glassUIService } from '@/services/glassUIService';

const Welcome: React.FC = () => {
  const [consentTraining, setConsentTraining] = useState(false);
  const [consentAnalytics, setConsentAnalytics] = useState(true);
  const [consentStorage, setConsentStorage] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleContinue = async () => {
    setIsLoading(true);
    
    try {
      // Update user settings with consent preferences using Glass UI Service
      const result = await glassUIService.updateSettings({
        consent_training: consentTraining,
        consent_analytics: consentAnalytics,
        consent_storage: consentStorage
      });

      if (result.success) {
        // Navigate to main application
        navigate('/desktop');
      } else {
        throw new Error('Failed to save consent preferences');
      }
    } catch (error) {
      console.error('Error saving consent:', error);
      // Continue anyway for now
      navigate('/desktop');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadDesktop = () => {
    // This would typically open the download page
    window.open('/download', '_blank');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-black to-purple-950/20 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
              <Zap className="h-12 w-12 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-4">
            Willkommen bei EVIA
          </h1>
          <p className="text-xl text-white/80 max-w-2xl mx-auto">
            Ihr intelligenter Sprachassistent für professionelle Kommunikation
          </p>
          <Badge variant="outline" className="mt-4 border-white/20 text-white/80">
            Version 1.0.0
          </Badge>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column - Features */}
            <div className="space-y-6">
              <Card className="bg-black/30 border-white/10 text-white">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Zap className="h-5 w-5 text-blue-400" />
                    Was EVIA kann
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Mic className="h-5 w-5 text-green-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium">Live-Transkription</h4>
                      <p className="text-sm text-white/60">
                        Echtzeit-Transkription von Meetings und Gesprächen
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <MessageSquare className="h-5 w-5 text-purple-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium">KI-Insights</h4>
                      <p className="text-sm text-white/60">
                        Automatische Zusammenfassungen und Aktionspunkte
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <Globe className="h-5 w-5 text-orange-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium">Mehrsprachig</h4>
                      <p className="text-sm text-white/60">
                        Optimiert für Deutsch und Englisch
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <Users className="h-5 w-5 text-pink-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium">Team-Kollaboration</h4>
                      <p className="text-sm text-white/60">
                        Gemeinsame Nutzung von Transkripten und Insights
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-black/30 border-white/10 text-white">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Download className="h-5 w-5 text-green-400" />
                    Desktop-App herunterladen
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-white/60 mb-4">
                    Für die beste Erfahrung laden Sie die EVIA Desktop-App herunter
                  </p>
                  <Button 
                    onClick={handleDownloadDesktop}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Für macOS herunterladen
                  </Button>
                  <p className="text-xs text-white/50 mt-2 text-center">
                    Windows-Version in Kürze verfügbar
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Privacy & Consent */}
            <div className="space-y-6">
              <Card className="bg-black/30 border-white/10 text-white">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Shield className="h-5 w-5 text-green-400" />
                    Datenschutz & Einverständnis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Training Consent */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="training-consent"
                        checked={consentTraining}
                        onCheckedChange={(checked) => setConsentTraining(checked as boolean)}
                        className="mt-1"
                      />
                      <div className="space-y-2">
                        <Label htmlFor="training-consent" className="text-white font-medium">
                          KI-Training (Standardmäßig deaktiviert)
                        </Label>
                        <p className="text-sm text-white/60">
                          Erlauben Sie EVIA, Ihre Daten zur Verbesserung der KI-Modelle zu verwenden.
                          <span className="text-orange-400 font-medium"> Standardmäßig deaktiviert</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-white/20" />

                  {/* Analytics Consent */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="analytics-consent"
                        checked={consentAnalytics}
                        onCheckedChange={(checked) => setConsentAnalytics(checked as boolean)}
                        className="mt-1"
                      />
                      <div className="space-y-2">
                        <Label htmlFor="analytics-consent" className="text-white font-medium">
                          Nutzungsanalyse
                        </Label>
                        <p className="text-sm text-white/60">
                          Anonyme Daten zur Verbesserung der App-Funktionalität sammeln
                        </p>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-white/20" />

                  {/* Storage Consent */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="storage-consent"
                        checked={consentStorage}
                        onCheckedChange={(checked) => setConsentStorage(checked as boolean)}
                        className="mt-1"
                      />
                      <div className="space-y-2">
                        <Label htmlFor="storage-consent" className="text-white font-medium">
                          Datenspeicherung
                        </Label>
                        <p className="text-sm text-white/60">
                          Ihre Transkripte und Insights sicher auf EVIA-Servern speichern
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-black/30 border-white/10 text-white">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Lock className="h-5 w-5 text-blue-400" />
                    Sicherheitsgarantien
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium">Ende-zu-Ende Verschlüsselung</h4>
                      <p className="text-sm text-white/60">
                        Alle Daten werden verschlüsselt übertragen und gespeichert
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <Database className="h-5 w-5 text-green-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium">EU-Datenschutz</h4>
                      <p className="text-sm text-white/60">
                        Vollständige DSGVO-Compliance und lokale Datenspeicherung
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <Eye className="h-5 w-5 text-green-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium">Transparenz</h4>
                      <p className="text-sm text-white/60">
                        Sie haben jederzeit Zugriff auf Ihre gespeicherten Daten
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Continue Button */}
              <Button
                onClick={handleContinue}
                disabled={isLoading}
                className="w-full bg-green-600 hover:bg-green-700 text-lg py-6"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                    Wird geladen...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-5 w-5 mr-2" />
                    Mit EVIA beginnen
                  </>
                )}
              </Button>

              <p className="text-xs text-white/50 text-center">
                Durch das Fortfahren stimmen Sie unseren{' '}
                <a href="/privacy" className="text-blue-400 hover:underline">
                  Datenschutzrichtlinien
                </a>{' '}
                zu
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-16 text-white/40">
          <p className="text-sm">
            EVIA Voice Assistant • Sichere, intelligente Sprachverarbeitung
          </p>
          <p className="text-xs mt-2">
            Powered by Groq • Made in Germany
          </p>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
