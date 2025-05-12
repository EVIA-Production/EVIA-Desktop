
import React, { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TranscriptPanelProps {
  title: string;
  content: string;
  className?: string;
  placeholder?: string;
  isSuggestion?: boolean;
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({ 
  title, 
  content, 
  className = '',
  placeholder = "Waiting for input...",
  isSuggestion = false
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Log when content changes
    console.log(`TranscriptPanel (${title}) content updated:`, content);
  }, [content, title]);
  
  // Auto-scroll to the bottom when content changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  // Process suggestion content to extract the text after </think> tag
  const processContent = () => {
    if (!content) {
      return '';
    }
    
    if (isSuggestion) {
      const thinkEndTagPattern = /<\/think>\s*(.*)/s;
      const matches = content.match(thinkEndTagPattern);
      return matches ? matches[1].trim() : content;
    }
    
    return content;
  };

  // Render content with clean line breaks between speakers
  const renderContent = () => {
    if (!content) {
      return <p className="text-gray-400 italic">{placeholder}</p>;
    }
    
    const processedContent = processContent();
    
    return processedContent.split('\n').map((line, lineIndex) => (
      <div key={`line-${lineIndex}`} className="mb-2 last:mb-0">
        <span className="animate-fadeIn">{line}</span>
      </div>
    ));
  };

  return (
    <div className={`recording-area h-full flex flex-col ${className} rounded-xl transition-all duration-300`}>
      <h2 className="text-xl font-semibold mb-2 flex items-center">
        <span className="mr-2 w-2 h-2 rounded-full bg-evia-pink animate-pulse"></span>
        {title}
      </h2>
      <ScrollArea className="flex-1 p-4 backdrop-blur-md bg-black bg-opacity-40 rounded-xl border border-gray-800 shadow-inner">
        <div className="text-white leading-relaxed whitespace-pre-wrap" ref={scrollRef}>
          {renderContent()}
        </div>
      </ScrollArea>
    </div>
  );
};

export default TranscriptPanel;
