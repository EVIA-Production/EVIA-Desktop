import React, { useRef, useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface TranscriptPanelProps {
  title: string;
  content?: string;
  lines?: { label: string; text: string; lineIndex: number; speaker: number; isInterim: boolean }[];
  onRenameLabel?: (mode: 'current' | 'all', lineIndex: number, speaker: number, newLabel: string) => void;
  followLive?: boolean;
  onToggleFollow?: (value: boolean) => void;
  className?: string;
  placeholder?: string;
  isSuggestion?: boolean;
  defaultCollapsed?: boolean;
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({ 
  title, 
  content, 
  lines,
  onRenameLabel,
  followLive = false,
  onToggleFollow,
  className = '',
  placeholder = "Waiting for input...",
  isSuggestion = false,
  defaultCollapsed = false
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const jumpToBottom = () => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  };
  
  useEffect(() => {
    if (content) console.log(`TranscriptPanel (${title}) content updated:`, content);
    if (lines) console.log(`TranscriptPanel (${title}) lines updated:`, lines.length);
  }, [content, lines, title]);
  
  // Auto-scroll to the bottom when content changes
  useEffect(() => {
    if (viewportRef.current && !isCollapsed && followLive) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [content, lines, isCollapsed, followLive]);

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

  // Render structured lines with editable labels
  const renderLines = () => {
    if ((!lines || lines.length === 0) && !content) {
      return <p className="text-gray-400 italic">{placeholder}</p>;
    }
    if (isSuggestion) {
      const processed = processContent();
      return <div className="mb-2 last:mb-0 whitespace-pre-wrap break-words">{processed}</div>;
    }
    if (lines && lines.length) {
      return lines.map((ln) => {
        const isHovered = hoveredIndex === ln.lineIndex;
        const isEditing = editingIndex === ln.lineIndex;
        const labelEl = isEditing ? (
          <input
            className="bg-transparent border-b border-evia-pink focus:outline-none mr-2"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onRenameLabel) {
                const applyAll = window.confirm('Apply this change to all occurrences of this speaker?');
                onRenameLabel(applyAll ? 'all' : 'current', ln.lineIndex, ln.speaker, editValue.trim());
                setEditingIndex(null);
              }
              if (e.key === 'Escape') setEditingIndex(null);
            }}
            autoFocus
          />
        ) : (
          <span
            className={`font-semibold mr-2 cursor-pointer ${isHovered ? 'text-purple-300 drop-shadow-[0_0_6px_rgba(168,85,247,0.9)]' : ''}`}
            onMouseEnter={() => setHoveredIndex(ln.lineIndex)}
            onMouseLeave={() => setHoveredIndex((i) => (i === ln.lineIndex ? null : i))}
            onClick={() => {
              setEditingIndex(ln.lineIndex);
              setEditValue(ln.label);
            }}
            title="Click to rename label"
          >
            {ln.label}:
          </span>
        );
        return (
          <div key={`line-${ln.lineIndex}`} className="mb-2 last:mb-0 whitespace-pre-wrap break-words">
            {labelEl}
            <span className="align-middle">
              {ln.text}
              {ln.isInterim ? ' ▌' : ''}
            </span>
          </div>
        );
      });
    }
    const processed = processContent();
    return <div className="mb-2 last:mb-0 whitespace-pre-wrap break-words">{processed}</div>;
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
        <div className="flex items-center gap-3">
          {onToggleFollow && (
            <label className="text-sm text-gray-300 flex items-center gap-1 cursor-pointer select-none">
              <input type="checkbox" checked={followLive} onChange={(e) => onToggleFollow(e.target.checked)} />
              Follow live
            </label>
          )}
          {!followLive && (
            <button
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
              onClick={() => {
                if (viewportRef.current) {
                  viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
                }
              }}
              title="Jump to latest"
            >
              Jump to latest
            </button>
          )}
          <button 
            onClick={toggleCollapse} 
            className="p-1 rounded-full hover:bg-gray-700 transition-colors"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
      </div>
      
      {!isCollapsed && (
        <ScrollArea viewportRef={viewportRef} className="h-[400px] p-4 backdrop-blur-md bg-black bg-opacity-40 rounded-xl border border-gray-800 shadow-inner">
          <div className="text-white leading-relaxed whitespace-pre-wrap">
            {renderLines()}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

export default TranscriptPanel;
