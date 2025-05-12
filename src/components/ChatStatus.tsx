
import React from 'react';

interface ChatStatusProps {
  chatId: string | null;
}

const ChatStatus: React.FC<ChatStatusProps> = ({ chatId }) => {
  if (!chatId || typeof chatId !== 'string') {
    return null;
  }

  return (
    <div className="mb-4 text-center">
      <p className="text-green-400">Connected to chat session: {chatId.substring(0, 8)}...</p>
    </div>
  );
};

export default ChatStatus;
