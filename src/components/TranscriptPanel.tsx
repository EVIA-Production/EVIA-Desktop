import React, { useRef, useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface TranscriptPanelProps {
  title: string;
  content: string;
  className?: string;
  placeholder?: string;
  isSuggestion?: boolean;
  defaultCollapsed?: boolean;
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({ 
  title, 
  content, 
  className = '',
  placeholder = "Waiting for input...",
  isSuggestion = false,
  defaultCollapsed = false
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Log when content changes
    console.log(`TranscriptPanel (${title}) content updated:`, content);
  }, [content, title]);
  
  // Auto-scroll to the bottom when content changes
  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isCollapsed]);

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
    
    // Only apply formatting for non-suggestion content
    const formattedContent = isSuggestion ? processedContent : processedContent
      .replace(/([.,!?])([^\s])/g, '$1 $2')  // Add space after punctuation if not followed by space
      .replace(/\s+/g, ' ')  // Normalize multiple spaces to single space
      .replace(/(Speaker \d+:)/g, '\n$1')  // Add line break before each Speaker
      .trim();  // Remove any leading/trailing whitespace
    
    return formattedContent.split('\n').map((line, lineIndex) => (
      <div key={`line-${lineIndex}`} className="mb-2 last:mb-0">
        <span className="animate-fadeIn">{line}</span>
      </div>
    ));
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div className={`recording-area h-full flex flex-col ${className} rounded-xl transition-all duration-300`}>
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-semibold flex items-center">
          <span className="mr-2 w-2 h-2 rounded-full bg-evia-pink animate-pulse"></span>
          {title}
        </h2>
        <button 
          onClick={toggleCollapse} 
          className="p-1 rounded-full hover:bg-gray-700 transition-colors"
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      </div>
      
      {!isCollapsed && (
        <ScrollArea className="h-[400px] p-4 backdrop-blur-md bg-black bg-opacity-40 rounded-xl border border-gray-800 shadow-inner">
          <div className="text-white leading-relaxed whitespace-pre-wrap" ref={scrollRef}>
            {renderContent()}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

export default TranscriptPanel;
