import React, { useState } from 'react';

/**
 * DraggableHandle – Right-side semicircular drag-only handle for EviaBar.
 * Visuals: frosted segment with subtle cut-out border and a three-bar grip.
 * Behavior: only this element uses app-region: drag; scales/highlights on drag.
 */
const DraggableHandle: React.FC = () => {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`evia-drag-handle ${dragging ? 'evia-drag-handle--active' : ''}`}
      onMouseDown={() => setDragging(true)}
      onMouseUp={() => setDragging(false)}
      onMouseLeave={() => setDragging(false)}
      title="Drag"
      aria-label="Drag handle"
      role="button"
    >
      {/* Grip icon: three small horizontal bars */}
      <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="3" y="4" width="8" height="1.4" rx="0.7" fill="white" opacity="0.95" />
        <rect x="3" y="6.8" width="8" height="1.4" rx="0.7" fill="white" opacity="0.9" />
        <rect x="3" y="9.6" width="8" height="1.4" rx="0.7" fill="white" opacity="0.85" />
      </svg>
    </div>
  );
};

export default DraggableHandle;