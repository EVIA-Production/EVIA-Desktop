# 🔴 CRITICAL: Ask Window Resize Fix

## Problem
When moving EVIA with arrow commands, Ask window shrinks to minimum size (just input bar), hiding all Groq output.

## Root Cause
```
User presses arrow key
  ↓
nudgeHeader() moves header
  ↓
layoutChildWindows() recalculates ALL window positions
  ↓
Ask window bounds set to DEFAULT SMALL SIZE (100px height)
  ↓
ResizeObserver fires in AskView
  ↓
Previous fix: "Skip if content unchanged"
  ↓
Result: Ask stays at small 100px ❌
```

## Solution
AskView must **store** the content-based height and **actively restore** it when window is moved (not when content changes).

### Implementation

**File**: `src/renderer/overlay/AskView.tsx`

**Add state to track stored height**:
```typescript
const [storedContentHeight, setStoredContentHeight] = useState<number | null>(null);
```

**Modified ResizeObserver logic**:
```typescript
useEffect(() => {
  const responseContainer = responseContainerRef.current;
  if (!responseContainer) return;

  const observer = new ResizeObserver(() => {
    const eviaWindow = (window as any).evia?.window;
    if (!eviaWindow?.setBounds || !eviaWindow?.getBounds) return;

    // Get current window bounds
    const currentBounds = eviaWindow.getBounds();

    // CASE 1: Content is streaming or just changed
    if (isStreaming || response !== lastResponseRef.current) {
      // Calculate new height based on content
      requestAnimationFrame(() => {
        const contentHeight = responseContainer.scrollHeight;
        const windowHeight = Math.max(100, Math.min(contentHeight + 120, 600));
        
        // Store this height for later restoration
        setStoredContentHeight(windowHeight);
        
        eviaWindow.setBounds({
          ...currentBounds,
          height: windowHeight
        });
        
        console.log('[AskView] 📏 Content-based resize:', windowHeight, 'px');
      });
    }
    // CASE 2: Content hasn't changed, but window was resized externally (arrow key movement)
    else if (storedContentHeight && currentBounds.height !== storedContentHeight) {
      // Restore the stored content-based height
      console.log('[AskView] 🔧 Restoring height:', storedContentHeight, 'px (was', currentBounds.height, ')');
      eviaWindow.setBounds({
        ...currentBounds,
        height: storedContentHeight
      });
    }
  });

  observer.observe(responseContainer);
  return () => observer.disconnect();
}, [response, isStreaming, storedContentHeight]);
```

## Key Changes

1. **Store content height**: `storedContentHeight` state tracks the last calculated height
2. **Detect external resize**: Compare `currentBounds.height` with `storedContentHeight`
3. **Restore immediately**: If heights don't match and content unchanged → restore stored height

## Testing

1. Open Ask (Cmd+Enter)
2. Ask "What is 2+2?" → See full response
3. Press arrow keys to move EVIA
4. **✅ VERIFY**: Ask window maintains full height (response still visible)

## Expected Console Logs

**On content change**:
```
[AskView] 📏 Content-based resize: 350 px
```

**On arrow key movement**:
```
[AskView] 🔧 Restoring height: 350 px (was 100)
```

---

**Status**: Ready to implement
**Risk**: Low (defensive logic, only affects Ask window sizing)
**Impact**: Critical UX fix

