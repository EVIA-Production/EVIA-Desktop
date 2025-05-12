
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

  // Process the transcript to concatenate messages from the same speaker
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
    
    // For each speaker, filter out sentences that are substrings of later sentences
    const cleanedMap = new Map<string, string[]>();
    
    speakerMap.forEach((utterances, speaker) => {
      if (speaker === 'unknown') {
        cleanedMap.set(speaker, utterances);
        return;
      }
      
      // Sort utterances by length (longest first)
      const sortedUtterances = [...utterances].sort((a, b) => b.length - a.length);
      const finalUtterances: string[] = [];
      
      // Keep only utterances that aren't contained in any other utterance
      sortedUtterances.forEach(current => {
        // Check if this utterance is a substring of any other utterance we've already kept
        const isSubstring = finalUtterances.some(final => 
          final.includes(current) && final !== current
        );
        
        if (!isSubstring) {
          finalUtterances.push(current);
        }
      });
      
      // Sort final utterances back to original order
      // by finding their index in the original array
      finalUtterances.sort((a, b) => {
        const indexA = utterances.findIndex(u => u === a);
        const indexB = utterances.findIndex(u => u === b);
        return indexA - indexB;
      });
      
      // Now we have only one entry per speaker with the most complete sentence
      cleanedMap.set(speaker, finalUtterances);
    });
    
    // Convert the cleaned map back to a string with concatenated messages per speaker
    return Array.from(cleanedMap.entries())
      .map(([speaker, texts]) => {
        if (speaker === 'unknown') return texts.join(' ');
        
        // Concatenate all texts from the same speaker with a space
        return `${speaker}: ${texts.join(' ')}`;
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
