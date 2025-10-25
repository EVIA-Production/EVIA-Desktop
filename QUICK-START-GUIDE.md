# 🚀 EVIA Desktop - Quick Start Guide

## **Issue: Backend Not Running + Stale Chat ID**

### **✅ STEPS TO FIX**

#### **1. Start Backend** (Required for Ask/Insights)

```bash
cd /Users/benekroetz/EVIA/EVIA-Backend

# Start backend in background
nohup python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 > backend.log 2>&1 &

# Verify it's running
curl http://localhost:8000/health
# Should return: {"status":"healthy","version":"..."}
```

**OR** use Docker Compose:
```bash
cd /Users/benekroetz/EVIA/EVIA-Backend
docker-compose up -d
```

---

#### **2. Clear Stale Chat ID** (Fix 404 errors)

**Option A: Browser DevTools (Recommended)**
1. Open Desktop app
2. Press `Cmd + Option + I` (macOS) to open DevTools
3. Go to **Console** tab
4. Run:
   ```javascript
   localStorage.removeItem('current_chat_id');
   location.reload();
   ```

**Option B: Manually Delete**
```bash
# macOS: Clear all app data
rm -rf ~/Library/Application\ Support/evia/
```

---

#### **3. Restart Desktop App**

**If running via `npm run dev`**:
1. Stop the dev server (`Ctrl+C` in terminal)
2. Rebuild main process:
   ```bash
   npm run build:main
   ```
3. Restart:
   ```bash
   npm run dev
   ```

**The app will**:
- Auto-create new chat ID on first recording
- Load settings correctly (auto-update, shortcuts)
- Ask endpoint will work (backend running)

---

## **🔧 What Was Fixed**

### **Issue #1: Backend 404 Errors**
- **Root Cause**: Backend not running on port 8000
- **Fix**: Start backend with uvicorn or docker-compose
- **Verification**: `curl http://localhost:8000/health`

### **Issue #2: Settings IPC Broken**
- **Root Cause**: `window.evia.ipc.invoke` was missing
- **Fix**: Added `invoke` method to preload.ts IPC bridge
- **Code Changed**: `src/main/preload.ts` (lines 121-125)

### **Issue #3: Stale Chat ID**
- **Root Cause**: localStorage had chat_id=3, but backend DB reset
- **Fix**: Clear localStorage or let app auto-create new chat
- **Manual**: `localStorage.removeItem('current_chat_id');`

---

## **🧪 Testing After Fix**

### **Test 1: Settings Load**
1. Click Settings icon in header
2. Check console for:
   ```
   [SettingsView] ✅ Loaded auto-update setting: true
   ```
3. Toggle "Automatic Updates" → verify no errors

### **Test 2: Ask Endpoint**
1. Click Ask icon (💬)
2. Type "Hi" and press Enter
3. Verify:
   - No 404 errors in console
   - Response streams in
   - Window sizes correctly

### **Test 3: Transcripts**
1. Click "Listen" (Start recording)
2. Speak something
3. Check console:
   ```
   [Transcripts] ✅ Fetched N transcripts
   ```
4. Ask a question → should have transcript context

---

## **📊 Backend Status Check**

```bash
# Check if backend is running
ps aux | grep uvicorn | grep -v grep

# Check backend logs
tail -f /Users/benekroetz/EVIA/EVIA-Backend/backend.log

# Test endpoints
curl http://localhost:8000/health
curl -X POST http://localhost:8000/chat/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

---

## **🚨 Still Having Issues?**

### **"Connection refused" errors**
- Backend not running → Start it (step 1)
- Wrong port → Check backend runs on port 8000

### **"404 Not Found" for /ask**
- Backend not running → Start it
- Wrong backend URL → Check `EVIA_BACKEND_URL` env var

### **"eviaIpc?.invoke is not a function"**
- Preload not rebuilt → Run `npm run build:main`
- Desktop not restarted → Restart dev server

### **"Chat not found (404)" for transcripts**
- Stale chat_id → Clear localStorage (step 2)
- Backend DB reset → Let app create new chat

---

## **✅ Success Checklist**

- ✅ Backend running (port 8000)
- ✅ Health endpoint responds
- ✅ Desktop app started (`npm run dev`)
- ✅ No IPC errors in console
- ✅ Settings toggle works
- ✅ Ask endpoint works (no 404)
- ✅ Transcripts load (or gracefully handle no-chat)

---

**All fixed! Ready to use EVIA Desktop 🚀**

