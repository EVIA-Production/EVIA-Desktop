
import React, { useRef, useEffect, useMemo } from 'react';
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

  // Process the transcript to show only the latest line from each speaker
  const processedContent = useMemo(() => {
    if (!content || title !== "Live Transcript") return content;
    
    const lines = content.split('\n').filter(line => line.trim());
    const speakerMap = new Map<string, string>();
    
    // Keep only the most recent line for each speaker
    lines.forEach(line => {
      const match = line.match(/^(Speaker\d+):(.*)/);
      if (match) {
        const [, speaker, text] = match;
        speakerMap.set(speaker, text.trim());
      } else if (line.trim()) {
        // For lines without a speaker prefix, keep them as is
        speakerMap.set(`unknown-${line}`, line);
      }
    });
    
    // Convert the map back to a string
    return Array.from(speakerMap.entries())
      .map(([speaker, text]) => {
        if (speaker.startsWith('unknown-')) return text;
        return `${speaker}: ${text}`;
      })
      .join('\n');
  }, [content, title]);

  const contentToDisplay = title === "Live Transcript" ? processedContent : content;

  // Function to render text with animation
  const renderAnimatedText = (text: string, lineIndex: number) => {
    return (
      <div key={`line-${lineIndex}`}>
        {lineIndex > 0 && <br />}
        {text.split(' ').map((word, wordIndex) => (
          <span 
            key={`word-${lineIndex}-${wordIndex}`} 
            className="inline-block mr-1 animate-fadeIn"
          >
            {word}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className={`recording-area h-full flex flex-col ${className} rounded-xl transition-all duration-300`}>
      <h2 className="text-xl font-semibold mb-2 flex items-center">
        <span className="mr-2 w-2 h-2 rounded-full bg-evia-pink animate-pulse"></span>
        {title}
      </h2>
      <ScrollArea className="flex-1 p-4 backdrop-blur-md bg-black bg-opacity-40 rounded-xl border border-gray-800 shadow-inner">
        <div className="text-white leading-relaxed whitespace-pre-wrap" ref={scrollRef}>
          {contentToDisplay ? 
            contentToDisplay.split('\n').map((line, lineIndex) => 
              renderAnimatedText(line, lineIndex)
            ) : 
            <p className="text-gray-400 italic">{placeholder}</p>
          }
        </div>
      </ScrollArea>
    </div>
  );
};

export default TranscriptPanel;
