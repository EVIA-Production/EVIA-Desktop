
import React from 'react';

interface StatusIndicatorProps {
  isConnected: boolean;
  hasAccessToken: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ isConnected, hasAccessToken }) => {
  let statusMessage = isConnected ? 'Connected to server' : 'Disconnected';
  let statusDetails = '';
  
  if (!hasAccessToken) {
    statusMessage = 'Authentication required';
    statusDetails = 'Please log in to use WebSocket features';
  } else if (!isConnected) {
    statusDetails = 'Attempting to connect via cookie authentication. Check console for details.';
  }
  
  return (
    <div className="text-center mb-6">
      <div className={`inline-flex items-center px-3 py-1 rounded-md ${
        isConnected 
          ? 'bg-evia-green bg-opacity-20 text-evia-green' 
          : 'bg-evia-red bg-opacity-20 text-evia-red'
      }`}>
        <div className={`w-2 h-2 rounded-full mr-2 ${
          isConnected ? 'bg-evia-green' : 'bg-evia-red'
        }`}></div>
        {statusMessage}
      </div>
      {statusDetails && (
        <div className="text-sm text-gray-400 mt-1">
          {statusDetails}
        </div>
      )}
    </div>
  );
};

export default StatusIndicator;
