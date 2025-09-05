import React, { useState } from 'react';

interface SimpleAskViewProps {
  language: 'de' | 'en';
  onClose: () => void;
}

interface AIAnswer {
  id: string;
  question: string;
  answer: string;
  timestamp: number;
  language: 'de' | 'en';
}

export const SimpleAskView: React.FC<SimpleAskViewProps> = ({
  language,
  onClose
}) => {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<AIAnswer[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleAsk = async () => {
    if (!question.trim()) return;

    setIsLoading(true);
    
    try {
      // Try real API call first
      if (window.evia?.api) {
        const response = await window.evia.api.ask(question, language);
        const newAnswer: AIAnswer = {
          id: Date.now().toString(),
          question: question,
          answer: response.answer,
          timestamp: response.timestamp || Date.now(),
          language: language
        };
        
        setAnswers(prev => [newAnswer, ...prev]);
        setQuestion('');
        setIsLoading(false);
        return;
      }
    } catch (error) {
      console.error('API call failed, falling back to mock:', error);
    }
    
    // Fallback to mock response
    setTimeout(() => {
      const newAnswer: AIAnswer = {
        id: Date.now().toString(),
        question: question,
        answer: language === 'de' 
          ? 'Das ist eine Beispiel-Antwort auf Deutsch. Die KI hat Ihre Frage verstanden und gibt eine hilfreiche Antwort.'
          : 'This is a sample answer in English. The AI has understood your question and provides a helpful response.',
        timestamp: Date.now(),
        language: language
      };
      
      setAnswers(prev => [newAnswer, ...prev]);
      setQuestion('');
      setIsLoading(false);
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <div className="glass-window glass-overlay w-96 h-80 p-4 rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">
          {language === 'de' ? 'KI-Assistent' : 'AI Assistant'}
        </h2>
        <button
          onClick={onClose}
          className="text-white/60 hover:text-white text-xl"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mb-4 space-y-3">
        {answers.length === 0 ? (
          <div className="text-center text-white/60 py-8">
            <p>💡 {language === 'de' ? 'Stelle eine Frage' : 'Ask a question'}</p>
            <p className="text-sm">
              {language === 'de' 
                ? 'Der KI-Assistent hilft dir bei deinen Fragen'
                : 'The AI assistant helps you with your questions'
              }
            </p>
          </div>
        ) : (
          answers.map((answer) => (
            <div
              key={answer.id}
              className="p-3 rounded-lg bg-white/10 border border-white/20"
            >
              <div className="mb-2">
                <p className="text-sm text-white/80 font-medium">
                  {language === 'de' ? 'Frage:' : 'Question:'}
                </p>
                <p className="text-white">{answer.question}</p>
              </div>
              <div>
                <p className="text-sm text-white/80 font-medium">
                  {language === 'de' ? 'Antwort:' : 'Answer:'}
                </p>
                <p className="text-white">{answer.answer}</p>
              </div>
              <span className="text-xs text-white/50 mt-2 block">
                {new Date(answer.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={language === 'de' ? 'Stelle eine Frage...' : 'Ask a question...'}
            className="flex-1 px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            onClick={handleAsk}
            disabled={!question.trim() || isLoading}
            className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '⏳' : '💡'}
          </button>
        </div>
        
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>
            {language === 'de' ? 'Drücke Enter zum Senden' : 'Press Enter to send'}
          </span>
          <span>
            {language === 'de' ? 'Sprache:' : 'Language:'} {language === 'de' ? '🇩🇪' : '🇺🇸'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SimpleAskView;
