// Vitest setup: jsdom polyfills and global stubs

// Polyfill ResizeObserver used by Radix UI
class ResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-ignore
global.ResizeObserver = ResizeObserver as any;

// Ensure localStorage exists in test environment
if (!(global as any).localStorage) {
  (global as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    length: 0,
    key: () => null,
  } as unknown as Storage;
}


