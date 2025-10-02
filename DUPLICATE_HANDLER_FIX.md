# Duplicate IPC Handler Fix (2025-10-02)

## Problem
Runtime error during `EVIA_DEV=1 npm run dev:main`:
```
Error: Attempted to register a second handler for 'capture:screenshot'
```

Stack trace pointed to `dist/main/main.js:123` with duplicate `ipcMain.handle` registrations.

## Root Cause
**Duplicate IPC handler registrations** across two files:
- `src/main/main.ts` - Lines 101-142
- `src/main/overlay-windows.ts` - Lines 435-460

Specifically, these handlers were registered in BOTH files:
1. `capture:screenshot` (screenshot capture via desktopCapturer)
2. `header:toggle-visibility` (show/hide overlay)
3. `header:nudge` (arrow key movement)
4. `header:open-ask` (Cmd+Enter Ask window)

## Solution Applied
Removed duplicate handlers from `src/main/main.ts` since `overlay-windows.ts` is the authoritative source for window management.

### Changes to `src/main/main.ts`
1. **Removed duplicate IPC handlers** (lines 101-142):
   - `capture:screenshot` ❌ (kept in overlay-windows.ts ✅)
   - `header:toggle-visibility` ❌
   - `header:nudge` ❌
   - `header:open-ask` ❌

2. **Removed unused imports**:
   - `globalShortcut`, `desktopCapturer` from electron
   - `path`, `fs` modules
   - `nudgeHeader`, `openAskWindow`, `hideAllChildWindows` from overlay-windows

3. **Removed duplicate global shortcut registrations** from `app.whenReady()`:
   - `Cmd+\` toggle
   - `Cmd+Enter` ask
   - Arrow keys nudge

4. **Added clarifying comments** to prevent future duplicates

### Files Modified
- ✅ `src/main/main.ts` - Removed duplicates, kept only auth handlers
- ✅ `src/main/overlay-windows.ts` - Unchanged (authoritative source)
- ✅ `src/main/preload.ts` - Unchanged (correct renderer bridge)

## Verification

### Build Test
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run build
```
**Result**: ✅ Success (exit code 0)
- TypeScript compilation passed
- Vite build completed (605ms)
- electron-builder produced DMG artifact
- No duplicate handler errors

### Expected Runtime Behavior
With this fix:
1. ✅ No "Attempted to register a second handler" errors
2. ✅ Overlay loads successfully in dev mode
3. ✅ Global shortcuts work (`Cmd+\`, `Cmd+Enter`, arrows)
4. ✅ Screenshot capture on `Cmd+Enter` functional
5. ✅ All IPC handlers registered exactly once

## Testing Checklist
- [x] `npm run build` succeeds
- [ ] `npm run dev:main` launches without errors
- [ ] `npm run dev:renderer` + overlay visible
- [ ] `Cmd+\` toggles visibility
- [ ] `Cmd+Enter` opens Ask + captures screenshot
- [ ] Arrow keys nudge header
- [ ] No console errors in dev tools

## Pattern for Future Development
To prevent duplicate handlers:

```typescript
// ❌ BAD - Don't register the same handler in multiple files
// main.ts
ipcMain.handle('my-handler', () => { ... })

// overlay-windows.ts
ipcMain.handle('my-handler', () => { ... })  // ERROR!

// ✅ GOOD - Register once in the most appropriate module
// overlay-windows.ts (for window-related handlers)
ipcMain.handle('my-handler', () => { ... })

// main.ts - just use it via imports if needed
import { someFunction } from './overlay-windows'
```

### Glass Reference Pattern
Glass uses conditional registration in some cases:
```javascript
if (!ipcMain.listenerCount('channel-name')) {
  ipcMain.handle('channel-name', handler)
}
```

For EVIA, we use **single source of truth** approach:
- Window/overlay handlers → `overlay-windows.ts`
- Auth handlers → `main.ts`
- Audio handlers → `main.ts`

## Next Steps
1. ✅ Build verified
2. Test in dev mode (runtime verification)
3. Commit to `evia-glass-complete-desktop-fix`
4. Provide runtime logs + screenshots to coordinator

## Files Reference
- Fix commit: `src/main/main.ts` (removed lines 101-142)
- Authoritative handlers: `src/main/overlay-windows.ts` (lines 387-473)
- Renderer bridge: `src/main/preload.ts` (unchanged)

