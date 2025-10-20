// Type definitions for movement managers (SmoothMovementManager, WindowLayoutManager)
// These classes are implemented in CommonJS JavaScript and used from the Electron main process.

import type { BrowserWindow, Rectangle, Display } from "electron";

export type FeatureName = "ask" | "listen" | "settings" | "shortcuts";

export interface WindowVisibility {
  ask?: boolean;
  listen?: boolean;
  settings?: boolean;
  shortcuts?: boolean;
}

export interface LayoutStrategy {
  name: "below" | "above" | "right-side" | "left-side" | "adaptive";
  primary: "below" | "above" | "right" | "left";
  secondary: "below" | "above" | "right" | "left";
}

export type BoundsMap = Record<string, Rectangle>;

export interface SmoothAnimateOptions {
  sizeOverride?: { width: number; height: number };
  onComplete?: () => void;
  duration?: number;
}

declare class SmoothMovementManager {
  constructor(windowPool: Map<string, BrowserWindow>);

  stepSize: number;
  animationDuration: number;
  isAnimating: boolean;

  // Optional reference if wired by the host to trigger relayout after animations
  layoutManager?: WindowLayoutManager & { updateLayout?: () => void };

  animateWindow(
    win: BrowserWindow,
    targetX: number,
    targetY: number,
    options?: SmoothAnimateOptions
  ): void;

  fade(
    win: BrowserWindow,
    opts: {
      from?: number;
      to: number;
      duration?: number;
      onComplete?: () => void;
    }
  ): void;

  animateWindowBounds(
    win: BrowserWindow,
    targetBounds: Partial<Rectangle> & Pick<Rectangle, "x" | "y">,
    options?: { duration?: number; onComplete?: () => void }
  ): void;

  animateWindowPosition(
    win: BrowserWindow,
    targetPosition: Pick<Rectangle, "x" | "y">,
    options?: { duration?: number; onComplete?: () => void }
  ): void;

  animateLayout(layout: BoundsMap, animated?: boolean): void;

  destroy(): void;
}

declare class WindowLayoutManager {
  constructor(windowPool: Map<string, BrowserWindow>);

  readonly PADDING: number;

  getHeaderPosition(): { x: number; y: number };

  determineLayoutStrategy(
    headerBounds: Rectangle,
    screenWidth: number,
    screenHeight: number,
    relativeX: number,
    relativeY: number,
    workAreaX: number,
    workAreaY: number
  ): LayoutStrategy;

  calculateSettingsWindowPosition(): { x: number; y: number } | null;

  calculateHeaderResize(
    header: BrowserWindow | null,
    size: { width: number; height: number }
  ): Rectangle | null;

  calculateClampedPosition(
    header: BrowserWindow | null,
    pos: { x: number; y: number }
  ): { x: number; y: number } | null;

  calculateWindowHeightAdjustment(
    senderWindow: BrowserWindow | null,
    targetHeight: number
  ): Rectangle | null;

  calculateFeatureWindowLayout(
    visibility: Pick<WindowVisibility, "ask" | "listen">,
    headerBoundsOverride?: Rectangle | null
  ): BoundsMap;

  calculateShortcutSettingsWindowPosition(): Rectangle | null;

  calculateStepMovePosition(
    header: BrowserWindow | null,
    direction: "left" | "right" | "up" | "down"
  ): { x: number; y: number } | null;

  calculateEdgePosition(
    header: BrowserWindow | null,
    direction: "left" | "right" | "up" | "down"
  ): { x: number; y: number } | null;

  calculateNewPositionForDisplay(
    window: BrowserWindow | null,
    targetDisplayId: number
  ): { x: number; y: number } | null;

  boundsOverlap(bounds1: Rectangle, bounds2: Rectangle): boolean;
}

// CommonJS default exports
declare module "./smoothMovementManager" {
  const SmoothMovementManagerExport: typeof SmoothMovementManager;
  export = SmoothMovementManagerExport;
}

declare module "./windowLayoutManager" {
  const WindowLayoutManagerExport: typeof WindowLayoutManager;
  export = WindowLayoutManagerExport;
}
