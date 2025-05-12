
import React from 'react';

interface StatusIndicatorProps {
  isConnected: boolean;
  hasAccessToken: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ isConnected, hasAccessToken }) => {
  return (
    <div className="text-center mb-6">
      {isConnected ? (
        <div className="inline-flex items-center px-3 py-1 rounded-md bg-green-600 bg-opacity-20 text-green-500">
          <div className="w-2 h-2 rounded-full mr-2 bg-green-500 animate-pulse"></div>
          WebSocket Connected
        </div>
      ) : (
        <div className="inline-flex items-center px-3 py-1 rounded-md bg-yellow-600 bg-opacity-20 text-yellow-500">
          <div className="w-2 h-2 rounded-full mr-2 bg-yellow-500"></div>
          WebSocket Disconnected
        </div>
      )}
      
      <div className="text-sm text-gray-400 mt-1">
        {isConnected 
          ? "Live transcription is ready" 
          : hasAccessToken 
            ? "WebSocket will connect when recording starts" 
            : "Authentication issue - please check your access token"}
      </div>
    </div>
  );
};

export default StatusIndicator;
