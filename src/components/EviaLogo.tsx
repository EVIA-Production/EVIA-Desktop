import React from 'react';
import eviaLogoImage from '@/assets/evia-white.png';

interface EviaLogoProps {
  className?: string;
  width?: number | string; // Optional width prop
  height?: number | string; // Optional height prop
}

const EviaLogo: React.FC<EviaLogoProps> = ({ className, width = 100, height = 50 }) => { // Added width and height props with defaults
  return (
    <img 
      src={eviaLogoImage} 
      alt="EVIA Logo" 
      className={className} 
      style={{ width, height }} // Apply width and height
    />
  );
};

export default EviaLogo;
