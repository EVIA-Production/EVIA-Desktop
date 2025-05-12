
import React from 'react';

interface StatusIndicatorProps {
  isConnected: boolean;
  hasAccessToken: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = () => {
  return (
    <div className="text-center mb-6">
      <div className="inline-flex items-center px-3 py-1 rounded-md bg-yellow-600 bg-opacity-20 text-yellow-500">
        <div className="w-2 h-2 rounded-full mr-2 bg-yellow-500"></div>
        WebSocket functionality disabled
      </div>
      <div className="text-sm text-gray-400 mt-1">
        Real-time features are currently unavailable
      </div>
    </div>
  );
};

export default StatusIndicator;
