
import React from 'react';

interface StatusIndicatorProps {
  isConnected: boolean;
  hasAccessToken: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ isConnected, hasAccessToken }) => {
  return (
    <div className="text-center mb-6">
      <div className={`inline-block px-3 py-1 rounded-md ${isConnected ? 'bg-evia-green bg-opacity-20' : 'bg-evia-red bg-opacity-20'}`}>
        {isConnected ? 'Connected' : 'Disconnected'}
      </div>
      {hasAccessToken && (
        <div className="mt-3 border border-gray-700 rounded-md p-1 px-2 inline-block">
          Access Token Present (Inherited)
        </div>
      )}
    </div>
  );
};

export default StatusIndicator;
