
import React from 'react';

interface StatusIndicatorProps {
  isConnected: boolean;
  hasAccessToken: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ isConnected, hasAccessToken }) => {
  return (
    <div className="text-center mb-6">
      <div className={`inline-flex items-center px-3 py-1 rounded-md ${
        isConnected 
          ? 'bg-green-600 bg-opacity-20 text-green-500' 
          : 'bg-red-600 bg-opacity-20 text-red-500'
      }`}>
        <div className={`w-2 h-2 rounded-full mr-2 ${
          isConnected ? 'bg-green-500' : 'bg-red-500'
        }`}></div>
        {isConnected ? 'Connected' : 'Disconnected'}
      </div>
    </div>
  );
};

export default StatusIndicator;
