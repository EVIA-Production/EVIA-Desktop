# ✅ **DYNAMIC HEADER WIDTH - IMPLEMENTED**

## **Problem Solved**

**Issue**: Settings button invisible because Electron window width (900px) was a hard limit, even with `width: max-content` CSS.

**Root Cause**: CSS `max-content` only controls the DOM element's width, but the Electron `BrowserWindow` itself clips any content beyond its initial width.

---

## **Solution Implemented**

### **1. Main Process (overlay-windows.ts)**

Added IPC handlers to dynamically resize the window based on content:

```typescript
// After window loads, listen for resize requests from renderer
ipcMain.handle('header:set-window-width', async (_event, contentWidth: number) => {
  const bounds = headerWindow.getBounds()
  const newWidth = Math.max(contentWidth + 20, 400) // Add padding, min 400px
  
  headerWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: newWidth,  // ← Resize to fit content!
    height: bounds.height
  })
  
  saveState({ headerBounds: headerWindow.getBounds() })
})
```

### **2. Renderer Process (EviaBar.tsx)**

Added `useEffect` to measure content width and request window resize:

```typescript
useEffect(() => {
  const measureAndResize = async () => {
    if (!headerRef.current) return;
    
    // Wait for DOM/fonts to settle
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Measure actual rendered width
    const rect = headerRef.current.getBoundingClientRect();
    const contentWidth = Math.ceil(rect.width);
    
    // Request window resize via IPC
    await window.electron?.ipcRenderer.invoke(
      'header:set-window-width',
      contentWidth
    );
  };
  
  measureAndResize();
}, [language]); // Re-measure when language changes (German words longer!)
```

### **3. Preload Bridge (preload.ts)**

Exposed `electron.ipcRenderer` to renderer:

```typescript
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, listener),
  },
})
```

### **4. Type Definitions (types.d.ts)**

Added TypeScript types for `window.electron`:

```typescript
electron?: {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => Promise<any>;
    send: (channel: string, ...args: any[]) => void;
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
  };
};
```

---

## **How It Works**

1. **Initial Load**: Window starts at 900px width (fallback)
2. **Content Rendered**: React component mounts, buttons render
3. **Measure Width**: `useEffect` waits 100ms, then measures `.evia-main-header` width
4. **Request Resize**: Sends `contentWidth` to main process via IPC
5. **Window Resizes**: Main process calls `setBounds()` with new width
6. **Persist**: New bounds saved to disk for next launch

**Language Changes**: When user switches German ↔ English, `useEffect` dependency triggers re-measurement (German words are longer!)

---

## **Expected Behavior**

### **German (Longer Words)**

```
┌────────────────────────────────────────────────────┐
│ 🔊 Zuhören │ 💬 Fragen │ 👁 Anzeigen/Ausblenden │ ⚙️ │
└────────────────────────────────────────────────────┘
         Window auto-sizes to ~600px
```

### **English (Shorter Words)**

```
┌──────────────────────────────────────┐
│ 🔊 Listen │ 💬 Ask │ 👁 Show/Hide │ ⚙️ │
└──────────────────────────────────────┘
      Window auto-sizes to ~450px
```

---

## **Files Modified**

1. `src/main/overlay-windows.ts` - IPC handlers for dynamic resize
2. `src/renderer/overlay/EviaBar.tsx` - Content measurement + resize request
3. `src/main/preload.ts` - Expose `electron.ipcRenderer`
4. `src/renderer/types.d.ts` - TypeScript types for `window.electron`

---

## **Testing**

### **Manual Test**

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Terminal 1: Renderer
npm run dev:renderer

# Terminal 2: Electron (with DevTools)
EVIA_DEV=1 npm run dev:main
```

**Check Console**:
- Should see: `[EviaBar] Content width measured: XXXpx`
- Should see: `[overlay-windows] Resizing header: 900px → XXXpx (content: XXXpx)`

**Visual Check**:
- All buttons visible (including ⚙️ Settings)
- No cutoff on right edge
- Header fits content exactly (no wasted space)

### **Test Language Switch**

1. Open Settings
2. Click "English"
3. Window should shrink (English words shorter)
4. Click "Deutsch"
5. Window should expand (German words longer)

---

## **Advantages**

✅ **Dynamic**: Works for any language, any button text
✅ **Automatic**: No manual width calculations needed
✅ **Responsive**: Adjusts on language change
✅ **Persistent**: Saves new width to disk
✅ **Fallback**: Starts at 900px if measurement fails

---

## **Alternative Approaches Considered**

### **Option A: Pre-calculate Based on Language** ❌

```typescript
const HEADER_SIZE = { 
  width: language === 'de' ? 600 : 450,
  height: 47 
}
```

**Rejected**: Hardcoded values, breaks if button text changes.

### **Option B: Use `BrowserWindow` without fixed width** ❌

```typescript
headerWindow = new BrowserWindow({
  // No width/height specified
  frame: false,
  transparent: true,
})
```

**Rejected**: Electron requires initial bounds; window would be zero-sized.

### **Option C: CSS-only with `max-content`** ❌

```css
.evia-main-header {
  width: max-content;
}
```

**Rejected**: CSS doesn't affect BrowserWindow size, only DOM layout.

---

## **Commit Message**

```
fix: Dynamic header width for Settings button visibility

- Add IPC handlers for measuring content width
- Resize BrowserWindow to fit content exactly
- Re-measure on language change (German words longer)
- Persist new bounds across sessions

Fixes: Settings button cut off in German (even at 900px)
```

---

## **Status**

- ✅ TypeScript build passes
- ✅ No linter errors
- ✅ IPC handlers registered
- ✅ Types defined
- ⏳ **Awaiting user test**: Check if Settings button now visible!

---

**Next**: Test with `EVIA_DEV=1 npm run dev:main` and verify Settings button is fully visible in both German and English.

