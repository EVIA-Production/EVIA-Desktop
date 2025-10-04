# 🚨 START HERE - Transcription Bug Quick Start

**Date**: 2025-10-04  
**Status**: ⚠️ CRITICAL - Transcription display completely broken  
**Full Details**: See `COMPLETE_DESKTOP_HANDOFF.md` (1,362 lines)

---

## 🔴 THE PROBLEM IN 30 SECONDS

**What happens**:
1. User clicks "Zuhören" (Listen) button
2. Listen window opens (appears on screen)
3. User speaks into microphone
4. Backend receives audio and transcribes it successfully ✅
5. **BUT**: Listen window shows NOTHING (no transcripts, timer stays at 00:00) ❌

**The smoking gun**:
```javascript
// Expected logs in Listen DevTools:
[ListenView] 🔍 WebSocket useEffect STARTED
[ListenView] 🔍 Retrieved chat_id: 76
[ListenView] ✅ WebSocket connected successfully

// Actual logs (only 3 lines):
[WS] Closed: code=1001 reason=
Reconnecting attempt 1...
[Chat] Reusing existing chat id 76
```

**Zero React component logs appear** - useEffect never runs (or build is stale).

---

## 🎯 MOST LIKELY CAUSE (70% probability)

**Stale build / cache issue**

The diagnostic logs we added in commit `f0ae7f4` don't appear in the console, suggesting:
- Vite dev server cached the old bundle
- Browser cached the old JavaScript
- `dist-electron` has stale compiled code

---

## ⚡ IMMEDIATE ACTIONS (Try These First)

### Step 1: Hard Reset Everything
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Clean all caches
rm -rf dist-electron node_modules/.vite

# Rebuild main process
npm run build:main

# Start Vite dev server (Terminal 1)
npm run dev:renderer
# Wait for "ready in X ms" message

# Start Electron (Terminal 2)
EVIA_DEV=1 npm run dev:main
```

### Step 2: Force Browser Hard Refresh
- Open Listen window DevTools
- Press **Cmd+Shift+R** (macOS) or **Ctrl+Shift+R** (others)
- Check console for `[ListenView]` logs

### Step 3: Verify Build Is Fresh
1. Open Listen DevTools
2. Go to **Sources** tab
3. Find `overlay-<hash>.js` in the file tree
4. **Search** (Cmd+F) for: `"WebSocket useEffect STARTED"`
5. **If NOT FOUND**: Build is stale, repeat Step 1
6. **If FOUND**: Component isn't mounting (routing issue)

---

## 🔬 DEBUGGING PATH (If Hard Reset Doesn't Work)

### Add Component-Level Log
**File**: `src/renderer/overlay/ListenView.tsx`  
**Line 30** (inside component function, BEFORE any hooks):

```typescript
export default function ListenView({ lines, followLive, onToggleFollow, onClose }: ListenViewProps) {
  console.log('[ListenView] 🔍 COMPONENT FUNCTION EXECUTING - PROOF OF MOUNT');
  console.log('[ListenView] 🔍 Props:', { lines, followLive });
  console.log('[ListenView] 🔍 Window:', window.location.href);
  
  // ... existing state declarations ...
```

**Save**, then rebuild and hard refresh. If this log appears, the component IS mounting and the issue is in useEffect timing.

### Add Routing Log
**File**: `src/renderer/overlay/overlay-entry.tsx`  
**Line 84**:

```typescript
console.log('[OverlayEntry] 🔍 Routing to view:', view);

switch (view) {
  case 'listen':
    console.log('[OverlayEntry] 🔍 Rendering ListenView NOW');
    return <ListenView ... />
```

This verifies the routing is working correctly.

---

## 📚 FILES TO CHECK

1. **ListenView.tsx** (Lines 115-191) - useEffect that never runs
2. **overlay-entry.tsx** (Line 84) - Routes URL param to components
3. **websocketService.ts** - WebSocket code (this IS working, logs appear)
4. **vite.config.ts** - Build config (might affect caching)

---

## ✅ SUCCESS CRITERIA

After fix, Listen DevTools should show:
```
[OverlayEntry] 🔍 Routing to view: listen
[ListenView] 🔍 COMPONENT FUNCTION EXECUTING
[ListenView] 🔍 WebSocket useEffect STARTED
[ListenView] 🔍 Retrieved chat_id: 76
[WS Instance] Getting for key: 76:mic
ChatWebSocket initialized with chatId: 76
[ListenView] ✅ WebSocket connected successfully
[ListenView] ✅ Deepgram connection OPEN - starting timer
[ListenView] ✅ Adding transcript from echo_text: Hello...
```

And user sees:
- ✅ Transcripts appearing as speech bubbles
- ✅ Timer incrementing: 00:01, 00:02, 00:03...
- ✅ Auto-scroll to latest transcript

---

## 📖 FULL DOCUMENTATION

For complete system architecture, all attempts made, alternative theories, backend protocol details, file-by-file analysis, and 12 sections of comprehensive context:

👉 **Read `COMPLETE_DESKTOP_HANDOFF.md`** 👈

---

## 🆘 IF STUCK

Try these in order:
1. Check main terminal for renderer errors (might not show in DevTools)
2. Test URL manually: Open `http://localhost:5174/?view=listen` in Chrome
3. Compare with working Glass implementation: `glass/src/ui/listen/ListenView.js`
4. Disable React StrictMode temporarily (might cause double-mount issues)
5. Try a minimal repro: Comment out all ListenView code except one `console.log`

---

**Good luck! 🍀**

