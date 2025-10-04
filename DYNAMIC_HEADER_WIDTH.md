# Dynamic Header Width Implementation Guide

## Problem Statement

Fixed header widths (380px → 520px → 560px → 700px) are fundamentally flawed because:
1. Different languages have different text lengths (German longer than English)
2. Different fonts render at different widths
3. Different OS/display settings affect text rendering
4. Adding/removing buttons requires manual width updates

**Current situation**: Header is 700px (temporary fix) which:
- ✅ Prevents overflow for most scenarios
- ❌ Wastes screen space when not needed
- ❌ Doesn't adapt to content changes
- ❌ Round edges are at fixed positions

## Glass Implementation (Reference)

Glass uses dynamic window sizing as shown in logs:
```
[Layout Debug] adjustWindowHeight: targetHeight=223
[Layout Debug] Listen Window Bounds: height=223, width=400
```

Glass calculates window dimensions **at runtime** based on content.

## Proper Solution: Dynamic Width Calculation

### Architecture

```
┌─────────────────────────────────────────┐
│  Renderer Process (EviaBar.tsx)         │
│  1. Measure button widths after render  │
│  2. Calculate total width needed        │
│  3. Send to main process via IPC        │
└──────────────┬──────────────────────────┘
               │ IPC: header:set-width
               ▼
┌─────────────────────────────────────────┐
│  Main Process (overlay-windows.ts)      │
│  4. Resize header window                │
│  5. Update round edge positions         │
│  6. Reposition child windows            │
└─────────────────────────────────────────┘
```

### Implementation Steps

#### Step 1: Measure Button Widths in Renderer

```tsx
// EviaBar.tsx
import { useEffect, useRef } from 'react'

function EviaBar({ ... }) {
  const containerRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (!containerRef.current) return
    
    // Wait for fonts to load and DOM to settle
    requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return
      
      // Measure actual rendered width
      const buttons = container.querySelectorAll('button')
      let totalWidth = 0
      
      buttons.forEach(button => {
        const rect = button.getBoundingClientRect()
        totalWidth += rect.width
      })
      
      // Add padding (16px per side + gaps between buttons)
      const gaps = (buttons.length - 1) * 8 // 8px gap between each button
      const padding = 32 // 16px left + 16px right
      const finalWidth = Math.ceil(totalWidth + gaps + padding)
      
      // Send to main process
      window.api.header.setWidth(finalWidth)
    })
  }, [/* dependencies: language, button visibility, etc */])
  
  return (
    <div ref={containerRef} style={{ ... }}>
      {/* buttons */}
    </div>
  )
}
```

#### Step 2: Add IPC Handler in Preload

```typescript
// preload.ts
const api = {
  header: {
    setWidth: (width: number) => ipcRenderer.send('header:set-width', width),
    // ... other methods
  },
  // ... other API methods
}
```

#### Step 3: Handle Resize in Main Process

```typescript
// overlay-windows.ts
ipcMain.on('header:set-width', (event, width: number) => {
  if (!headerWindow) return
  
  // Clamp to reasonable bounds
  const minWidth = 300
  const maxWidth = 1000
  const safeWidth = Math.max(minWidth, Math.min(maxWidth, width))
  
  // Get current bounds
  const [x, y] = headerWindow.getPosition()
  const [_, height] = headerWindow.getSize()
  
  // Resize header window
  headerWindow.setBounds({
    x,
    y,
    width: safeWidth,
    height,
  }, true) // animate: true for smooth transition
  
  // Update HEADER_SIZE for child window positioning
  HEADER_SIZE.width = safeWidth
  
  // Reposition child windows if visible
  const vis = getVisibility()
  if (Object.keys(vis).length > 0) {
    updateWindows(vis) // This will recalculate positions based on new header width
  }
  
  console.log(`[overlay-windows] Header resized to ${safeWidth}px`)
})
```

#### Step 4: Update Round Edges in CSS

The round edges are defined in CSS. With dynamic width, we need to ensure the edges stay rounded:

```css
/* overlay-glass.css */
.evia-bar-container {
  border-radius: 24px; /* This applies to all corners */
  overflow: hidden;
  /* The container will resize, edges stay round */
}
```

**Note**: CSS border-radius works automatically with dynamic widths!

### Testing Dynamic Width

1. **Language Switch Test**:
   ```
   - Switch from English → German
   - Verify header expands to fit "Anzeigen/Ausblenden"
   - Switch back to English
   - Verify header shrinks to fit "Show/Hide"
   ```

2. **Button Visibility Test**:
   ```
   - Start with all buttons visible
   - Hide "Ask" button via settings
   - Verify header shrinks
   - Show "Ask" button again
   - Verify header expands
   ```

3. **Font Size Test**:
   ```
   - Increase system font size (macOS: Accessibility settings)
   - Verify header expands to accommodate larger text
   ```

### Edge Cases to Handle

1. **Initial Load**: Header should measure width after fonts load
2. **Font Loading**: Use `document.fonts.ready` to wait for web fonts
3. **Language Change**: Re-measure when i18n language changes
4. **Window Resizing**: Handle screen bounds (don't exceed screen width)
5. **Animation**: Smooth transition when width changes (CSS transition)

### Performance Considerations

- **Debounce measurements**: Don't measure on every render
- **Cache widths**: Store measurements per language/state
- **Batch updates**: Update once after multiple changes

### Fallback Strategy

Keep current approach as fallback:
```typescript
const HEADER_SIZE = { 
  width: 700,  // Fallback if dynamic calculation fails
  height: 47 
}
```

If dynamic width fails or takes too long, use fallback width.

## Implementation Priority

**Phase 1** (Current): Fixed width at 700px (done ✅)
- Quick fix to prevent overflow
- Allows continued testing/development

**Phase 2** (Next sprint): Dynamic width calculation
- Implement Steps 1-4 above
- Test across languages and scenarios
- Enable by default

**Phase 3** (Polish): Animations and edge cases
- Smooth width transitions
- Handle extreme cases (very long/short text)
- Optimize performance

## Alternative Approaches Considered

### Option A: Auto-fit with CSS

```css
.evia-bar-container {
  width: fit-content;
  max-width: 100vw;
}
```

**Why not used**: 
- Electron BrowserWindow requires explicit pixel dimensions
- Cannot use CSS-only auto-sizing for frameless windows
- Would need to measure rendered width anyway

### Option B: Fixed widths per language

```typescript
const HEADER_WIDTHS = {
  en: 480,
  de: 560,
  // etc.
}
```

**Why not used**:
- Doesn't handle dynamic content (button visibility)
- Requires manual updates for each language
- Doesn't adapt to font/OS differences

### Option C: Measure once at startup

**Why not used**:
- Doesn't handle runtime changes (language switch)
- Misses lazy-loaded content
- Not robust to font loading delays

## Verification Checklist

After implementing dynamic width:

- [ ] Header width changes when switching languages
- [ ] Settings button always visible
- [ ] Round edges always properly rounded
- [ ] No overflow in any language
- [ ] Smooth width transitions (no jarring jumps)
- [ ] Child windows reposition correctly when header resizes
- [ ] Performance: no jank/lag when resizing
- [ ] Works on different display scales (125%, 150%, etc.)
- [ ] Works with custom system fonts
- [ ] Fallback to 700px if measurement fails

## Timeline Estimate

- Renderer measurement logic: **2 hours**
- IPC plumbing: **1 hour**
- Main process resize logic: **2 hours**
- Testing across scenarios: **3 hours**
- **Total: ~8 hours** (1 dev day)

## Conclusion

Dynamic header width is the **correct** long-term solution. The current 700px fixed width is a pragmatic temporary fix that unblocks testing while we implement the proper solution.

**Priority**: Medium (after critical bugs fixed)
**Complexity**: Medium (requires IPC coordination)
**Impact**: High (eliminates entire class of layout bugs)

---

*Document created: 2025-10-04*  
*Status: Awaiting implementation*

