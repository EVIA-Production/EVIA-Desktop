import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  MessageSquare, 
  Sparkles, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  Loader2,
  RefreshCw,
  Settings
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { glassUIService, AIAnswer } from '@/services/glassUIService';

interface Insight {
  id: string;
  type: 'summary' | 'followup' | 'action';
  text: string;
  timestamp: string;
  index: number;
}

// AIAnswer interface wird jetzt aus dem Service importiert

interface AskViewProps {
  insights: Insight[];
  onOpenSettings: () => void;
  language: 'de' | 'en';
  chatId: number;
}

const AskView: React.FC<AskViewProps> = ({
  insights,
  onOpenSettings,
  language,
  chatId
}) => {
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [aiAnswer, setAiAnswer] = useState<AIAnswer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'summary':
        return <MessageSquare className="h-4 w-4" />;
      case 'followup':
        return <Sparkles className="h-4 w-4" />;
      case 'action':
        return <CheckCircle className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  const getInsightColor = (type: string) => {
    switch (type) {
      case 'summary':
        return 'bg-blue-600';
      case 'followup':
        return 'bg-purple-600';
      case 'action':
        return 'bg-green-600';
      default:
        return 'bg-gray-600';
    }
  };

  const getInsightLabel = (type: string) => {
    switch (type) {
      case 'summary':
        return language === 'de' ? 'Zusammenfassung' : 'Summary';
      case 'followup':
        return language === 'de' ? 'Nachfrage' : 'Follow-up';
      case 'action':
        return language === 'de' ? 'Aktion' : 'Action';
      default:
        return type;
    }
  };

  const handleInsightClick = async (insight: Insight) => {
    setSelectedInsight(insight);
    setAiAnswer(null);
    setError(null);
    setIsLoading(true);

    try {
      // Verwende Glass UI Service für POST /ask
      const data = await glassUIService.askAI(chatId, insight.text, language);
      setAiAnswer(data);

      // Fire insight-click event (best-effort)
      try {
        await glassUIService.trackInsightClick({
          chat_id: chatId,
          type: insight.type,
          index: insight.index,
          timestamp: new Date().toISOString()
        });
      } catch (eventError) {
        console.warn('Failed to send insight-click event:', eventError);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get AI answer');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = () => {
    setSelectedInsight(null);
    setAiAnswer(null);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full bg-black/20 backdrop-blur-md rounded-lg border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">
            {language === 'de' ? 'KI-Insights & Antworten' : 'AI Insights & Answers'}
          </h2>
          <Badge variant="outline" className="border-white/20 text-white/80">
            {language.toUpperCase()}
          </Badge>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            className="text-white/80 hover:text-white"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            {language === 'de' ? 'Zurücksetzen' : 'Reset'}
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="text-white/80 hover:text-white"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
          {/* Insights Panel */}
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-lg">
                {language === 'de' ? 'Verfügbare Insights' : 'Available Insights'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-64">
                <div className="space-y-2 p-4">
                  {insights.length === 0 ? (
                    <div className="text-center text-white/60 py-8">
                      <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>{language === 'de' ? 'Keine Insights verfügbar' : 'No insights available'}</p>
                      <p className="text-sm">
                        {language === 'de' 
                          ? 'Starten Sie eine Aufnahme, um Insights zu generieren' 
                          : 'Start recording to generate insights'
                        }
                      </p>
                    </div>
                  ) : (
                    insights.map((insight) => (
                      <div
                        key={insight.id}
                        className={`p-3 rounded-lg cursor-pointer transition-all hover:bg-white/10 ${
                          selectedInsight?.id === insight.id ? 'bg-white/20 ring-2 ring-white/30' : 'bg-white/5'
                        }`}
                        onClick={() => handleInsightClick(insight)}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center ${getInsightColor(insight.type)}`}>
                            {getInsightIcon(insight.type)}
                          </div>
                          <Badge variant="outline" className="border-white/20 text-white/80 text-xs">
                            {getInsightLabel(insight.type)}
                          </Badge>
                        </div>
                        <p className="text-white text-sm mb-2">{insight.text}</p>
                        <div className="flex items-center gap-2 text-xs text-white/50">
                          <Clock className="h-3 w-3" />
                          {new Date(insight.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* AI Answer Panel */}
          <Card className="bg-black/30 border-white/10 text-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-lg">
                {language === 'de' ? 'KI-Antwort' : 'AI Answer'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="p-4 h-64">
                {!selectedInsight ? (
                  <div className="text-center text-white/60 py-8">
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>
                      {language === 'de' 
                        ? 'Wählen Sie einen Insight aus, um eine KI-Antwort zu erhalten' 
                        : 'Select an insight to get an AI answer'
                      }
                    </p>
                  </div>
                ) : isLoading ? (
                  <div className="text-center text-white/60 py-8">
                    <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin opacity-50" />
                    <p>
                      {language === 'de' 
                        ? 'KI generiert Antwort...' 
                        : 'AI generating answer...'
                      }
                    </p>
                  </div>
                ) : error ? (
                  <div className="text-center text-red-400 py-8">
                    <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-red-400 mb-2">Error</p>
                    <p className="text-sm text-red-300">{error}</p>
                  </div>
                ) : aiAnswer ? (
                  <div className="space-y-4">
                    <div className="bg-white/10 rounded-lg p-3">
                      <p className="text-white text-sm">{aiAnswer.answer}</p>
                    </div>
                    
                    {aiAnswer.citations && aiAnswer.citations.length > 0 && (
                      <div>
                        <h4 className="text-white/80 text-sm font-medium mb-2">
                          {language === 'de' ? 'Quellen' : 'Sources'}
                        </h4>
                        <div className="space-y-1">
                          {aiAnswer.citations.map((citation, index) => (
                            <div key={index} className="text-xs text-white/60 bg-white/5 rounded p-2">
                              {citation}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between text-xs text-white/50">
                      <span>
                        {language === 'de' ? 'Latenz' : 'Latency'}: {aiAnswer.latency_ms}ms
                      </span>
                      <span>
                        {new Date(aiAnswer.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AskView;
