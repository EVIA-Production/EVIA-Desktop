import React from 'react';
import whiteLogoImage from '@/assets/evia-white.png';
import blackLogoImage from '@/assets/evia-black.png';

interface EviaLogoProps {
  className?: string;
  width?: number | string; // Optional width prop
  height?: number | string; // Optional height prop
  variant?: 'white' | 'black'; // Theme variant
}

const EviaLogo: React.FC<EviaLogoProps> = ({ 
  className, 
  width = 100, 
  height = 50,
  variant = 'white' // Default to white logo
}) => {
  const logoSrc = variant === 'white' ? whiteLogoImage : blackLogoImage;
  
  return (
    <img 
      src={logoSrc} 
      alt="EVIA Logo" 
      className={className} 
      style={{ width, height }} // Apply width and height
    />
  );
};

export default EviaLogo;