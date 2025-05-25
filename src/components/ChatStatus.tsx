import React from 'react';

interface ChatStatusProps {
  isConnected: boolean;
}

const ChatStatus: React.FC<ChatStatusProps> = ({ isConnected }) => {
  return (
    <div className="flex items-center justify-end p-2 bg-gray-800">
      <div className="flex items-center space-x-2">
        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-sm text-gray-300">
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
    </div>
  );
};

export default ChatStatus;
