
import React, { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TranscriptPanelProps {
  title: string;
  content: string;
  className?: string;
  placeholder?: string;
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({ 
  title, 
  content, 
  className = '',
  placeholder = "Waiting for input..."
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to the bottom when content changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div className={`recording-area h-full flex flex-col ${className} rounded-xl transition-all duration-300`}>
      <h2 className="text-xl font-semibold mb-2 flex items-center">
        <span className="mr-2 w-2 h-2 rounded-full bg-evia-pink animate-pulse"></span>
        {title}
      </h2>
      <ScrollArea className="flex-1 p-4 backdrop-blur-md bg-black bg-opacity-40 rounded-xl border border-gray-800 shadow-inner">
        <div className="text-white leading-relaxed whitespace-pre-wrap" ref={scrollRef}>
          {content ? 
            content.split(' ').map((word, index) => (
              <span 
                key={index} 
                className="inline-block mr-1 animate-fadeIn"
              >
                {word}
              </span>
            )) : 
            <p className="text-gray-400 italic">{placeholder}</p>
          }
        </div>
      </ScrollArea>
    </div>
  );
};

export default TranscriptPanel;
