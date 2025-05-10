
import React from 'react';

interface EviaLogoProps {
  className?: string;
}

const EviaLogo: React.FC<EviaLogoProps> = ({ className }) => {
  return (
    <div className={`font-bold text-2xl tracking-wider ${className}`}>
      EV/A
    </div>
  );
};

export default EviaLogo;
