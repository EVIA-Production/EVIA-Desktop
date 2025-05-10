
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
    <div className={`recording-area h-full flex flex-col ${className}`}>
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <div className="flex-1 p-4 bg-black bg-opacity-50 rounded-md overflow-y-auto">
        {content ? <p>{content}</p> : <p className="text-gray-400">{placeholder}</p>}
      </div>
    </div>
  );
};

export default TranscriptPanel;
