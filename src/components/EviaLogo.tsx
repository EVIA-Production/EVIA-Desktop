
import React from 'react';

interface EviaLogoProps {
  className?: string;
}

const EviaLogo: React.FC<EviaLogoProps> = ({ className }) => {
  return (
    <div className={`font-bold text-2xl tracking-widest flex items-center ${className}`}>
      <span className="bg-clip-text text-transparent bg-gradient-to-r from-evia-pink to-pink-300">EV</span>
      <span className="mx-0.5 text-gray-300">/</span>
      <span className="bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-evia-pink">A</span>
    </div>
  );
};

export default EviaLogo;
