-# 📋 PRESETS INTEGRATION GUIDE

**For**: Backend + Desktop integration to display user presets in Settings

---

## 🎯 GOAL

Allow users to see and select their custom presets from EVIA-Desktop Settings window.

**Current State**: User has presets in backend, but they don't appear in Desktop Settings.

---

## 🔧 WHAT NEEDS TO BE DONE

### BACKEND CHANGES (EVIA-Backend)

#### 1. Add GET `/api/presets` Endpoint

**File**: `EVIA-Backend/api/routes/preset_routes.py` (or similar)

```python
@router.get("/presets", response_model=List[PresetResponse])
async def get_user_presets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all presets for the current user (default + custom).
    Glass parity: Returns both default presets and user-created presets.
    """
    try:
        # Fetch default presets (is_default=true, available to all users)
        default_presets_result = await db.execute(
            select(Preset).where(Preset.is_default == True).order_by(Preset.title)
        )
        default_presets = default_presets_result.scalars().all()
        
        # Fetch user's custom presets (is_default=false, uid=current_user.id)
        user_presets_result = await db.execute(
            select(Preset)
            .where(Preset.uid == current_user.id, Preset.is_default == False)
            .order_by(Preset.title)
        )
        user_presets = user_presets_result.scalars().all()
        
        # Combine: defaults first, then user presets
        all_presets = list(default_presets) + list(user_presets)
        
        return all_presets
    except Exception as e:
        logger.error(f"Error fetching presets for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch presets")
```

#### 2. Preset Model/Schema

**File**: `EVIA-Backend/api/models/preset.py` (or schema file)

```python
from pydantic import BaseModel
from typing import Optional

class PresetResponse(BaseModel):
    id: int
    title: str
    prompt: str
    is_default: bool
    uid: Optional[int] = None  # None for default presets, user ID for custom
    
    class Config:
        from_attributes = True
```

#### 3. Database Table

Ensure `presets` table exists with:
```sql
CREATE TABLE presets (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    uid INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### 4. Seed Default Presets (Optional)

Add some default presets for all users:
```python
default_presets = [
    {"title": "Summarize", "prompt": "Provide a concise summary of the conversation.", "is_default": True},
    {"title": "Action Items", "prompt": "List all action items mentioned.", "is_default": True},
    {"title": "Key Insights", "prompt": "What are the key insights from this discussion?", "is_default": True},
]
```

---

### DESKTOP CHANGES (EVIA-Desktop)

#### 1. Add IPC Handler for Presets

**File**: `src/main/main.ts`

```typescript
// 📋 Presets: Fetch user presets from backend
ipcMain.handle('presets:get', async (_event) => {
  try {
    const token = await getStoredToken();
    if (!token) {
      console.error('[Presets] No auth token found');
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch('http://localhost:8000/api/presets', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch presets: ${response.statusText}`);
    }

    const presets = await response.json();
    console.log('[Presets] ✅ Fetched', presets.length, 'presets');
    return { success: true, presets };
  } catch (err: unknown) {
    console.error('[Presets] ❌ Failed to fetch:', err);
    return { success: false, error: (err as Error).message };
  }
});
```

#### 2. Expose Presets API in Preload

**File**: `src/main/preload.ts`

```typescript
// Add to existing evia object:
presets: {
  get: () => ipcRenderer.invoke('presets:get'),
},
```

#### 3. Update SettingsView to Fetch and Display Presets

**File**: `src/renderer/overlay/SettingsView.tsx`

```typescript
// Add to existing component:

const [presets, setPresets] = useState<any[]>([]);
const [isLoadingPresets, setIsLoadingPresets] = useState(false);

// Fetch presets on mount
useEffect(() => {
  const fetchPresets = async () => {
    setIsLoadingPresets(true);
    try {
      const eviaPresets = (window as any).evia?.presets;
      if (eviaPresets?.get) {
        const result = await eviaPresets.get();
        if (result.success) {
          setPresets(result.presets || []);
          console.log('[SettingsView] ✅ Loaded', result.presets?.length || 0, 'presets');
        } else {
          console.error('[SettingsView] Failed to load presets:', result.error);
        }
      }
    } catch (error) {
      console.error('[SettingsView] Error fetching presets:', error);
    } finally {
      setIsLoadingPresets(false);
    }
  };
  
  fetchPresets();
}, []);

// In render, update the presets list:
<div className={`preset-list ${showPresets ? '' : 'hidden'}`}>
  {isLoadingPresets ? (
    <div className="preset-loading">Loading presets...</div>
  ) : presets.filter(p => !p.is_default).length === 0 ? (
    <div className="no-presets-message">
      {t('noPresetsMessage')}<br />
      <span className="web-link" onClick={handleCreatePreset}>
        {t('createFirstPreset')}
      </span>
    </div>
  ) : (
    presets.filter(p => !p.is_default).map(preset => (
      <div
        key={preset.id}
        className={`preset-item ${selectedPreset?.id === preset.id ? 'selected' : ''}`}
        onClick={() => setSelectedPreset(preset)}
      >
        <span className="preset-name">{preset.title}</span>
        {selectedPreset?.id === preset.id && <span className="preset-status">✓</span>}
      </div>
    ))
  )}
</div>
```

---

## 📊 INTEGRATION FLOW

```
1. User creates preset in EVIA-Frontend (/personalize)
   ↓
2. Preset saved to backend database (POST /api/presets)
   ↓
3. User opens EVIA-Desktop Settings
   ↓
4. SettingsView calls evia.presets.get()
   ↓
5. Desktop IPC → Backend GET /api/presets (with auth token)
   ↓
6. Backend returns user's presets (default + custom)
   ↓
7. SettingsView displays presets in "My Presets" section
   ↓
8. User can select a preset (future: apply to Ask queries)
```

---

## 🧪 TESTING

### Backend Test:
```bash
# Get auth token first
TOKEN=$(curl -s -X POST "http://localhost:8000/login/" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"Test123!"}' \
  | jq -r '.access_token')

# Fetch presets
curl -X GET "http://localhost:8000/api/presets" \
  -H "Authorization: Bearer $TOKEN"

# Expected response:
[
  {
    "id": 1,
    "title": "Summarize",
    "prompt": "Provide a concise summary...",
    "is_default": true,
    "uid": null
  },
  {
    "id": 5,
    "title": "My Custom Preset",
    "prompt": "Custom prompt text...",
    "is_default": false,
    "uid": 1
  }
]
```

### Desktop Test:
1. Run `npm run dev`
2. Open Settings (click ⋯)
3. Scroll to "My Presets"
4. Click "Show" (▶)
5. ✅ VERIFY: User's custom presets appear
6. ✅ VERIFY: Can select a preset (checkmark appears)

---

## 🔑 KEY POINTS

1. **Authentication**: Backend endpoint MUST require authentication (`Depends(get_current_user)`)
2. **Separation**: Default presets (`is_default=true`) vs User presets (`is_default=false, uid=user_id`)
3. **Glass Parity**: Glass shows defaults + user presets in one list (defaults first)
4. **Error Handling**: Desktop should gracefully handle missing presets (show "No presets yet")

---

## 🚀 IMPLEMENTATION ORDER

1. **Backend first** (30 min):
   - Add `/api/presets` endpoint
   - Test with curl
   
2. **Desktop second** (20 min):
   - Add IPC handler
   - Update preload
   - Test in DevTools console: `await window.evia.presets.get()`
   
3. **UI last** (15 min):
   - Fetch presets in SettingsView
   - Display in list
   - Test in actual UI

**Total**: ~1 hour

---

## 📚 GLASS REFERENCES

- `settingsService.js:258-266` - `getPresets()` function
- `SettingsView.js:616-642` - Loading presets on mount
- `firebase.repository.js:26-45` - Fetching defaults + user presets

---

**STATUS**: Ready to implement  
**Priority**: Medium (nice-to-have, not blocking)  
**Complexity**: Low (standard CRUD endpoint + IPC)

