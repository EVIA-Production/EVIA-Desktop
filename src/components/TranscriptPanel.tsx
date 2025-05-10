
import React from 'react';

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
  return (
    <div className={`recording-area h-full flex flex-col ${className} rounded-xl transition-all duration-300`}>
      <h2 className="text-xl font-semibold mb-2 flex items-center">
        <span className="mr-2 w-2 h-2 rounded-full bg-evia-pink animate-pulse"></span>
        {title}
      </h2>
      <div className="flex-1 p-4 backdrop-blur-md bg-black bg-opacity-40 rounded-xl overflow-y-auto border border-gray-800 shadow-inner">
        {content ? 
          <p className="text-white leading-relaxed">{content}</p> : 
          <p className="text-gray-400 italic">{placeholder}</p>
        }
      </div>
    </div>
  );
};

export default TranscriptPanel;
