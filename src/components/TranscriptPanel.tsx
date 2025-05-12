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
  // and remove incomplete utterances when they're contained in newer ones
  const processedContent = useMemo(() => {
    if (!content || title !== "Live Transcript") return content;
    
    const lines = content.split('\n').filter(line => line.trim());
    const speakerMap = new Map<string, string[]>();
    
    // Group all lines by speaker
    lines.forEach(line => {
      const match = line.match(/^(Speaker\d+):(.*)/);
      if (match) {
        const [, speaker, text] = match;
        if (!speakerMap.has(speaker)) {
          speakerMap.set(speaker, []);
        }
        speakerMap.get(speaker)?.push(text.trim());
      } else if (line.trim()) {
        // For lines without a speaker prefix, keep them as is
        if (!speakerMap.has('unknown')) {
          speakerMap.set('unknown', []);
        }
        speakerMap.get('unknown')?.push(line);
      }
    });
    
    // For each speaker, filter out sentences that are contained in later sentences
    const cleanedMap = new Map<string, string>();
    
    speakerMap.forEach((utterances, speaker) => {
      if (speaker === 'unknown') {
        cleanedMap.set(speaker, utterances.join('\n'));
        return;
      }
      
      // Process from newest to oldest to keep the most complete utterances
      const finalUtterances: string[] = [];
      
      for (let i = utterances.length - 1; i >= 0; i--) {
        const current = utterances[i];
        
        // Check if this utterance is already contained in any of our final utterances
        const isContained = finalUtterances.some(final => 
          final.includes(current) && final !== current
        );
        
        if (!isContained) {
          finalUtterances.unshift(current); // Add to the beginning to maintain original order
        }
      }
      
      cleanedMap.set(speaker, finalUtterances.join('\n'));
    });
    
    // Convert the cleaned map back to a string
    return Array.from(cleanedMap.entries())
      .map(([speaker, text]) => {
        if (speaker === 'unknown') return text;
        return text.split('\n')
          .map(line => `${speaker}: ${line}`)
          .join('\n');
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
