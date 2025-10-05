# 🔐 Auth Fix Applied - Testing Guide

## What Was Fixed

✅ **Vite Dev Server Integration** - Listen window now loads fresh code  
✅ **Auth Token Retrieval** - Overlay now gets JWT from secure keytar storage

---

## Testing Steps

### 1. Restart Electron

In the terminal running Electron, press `Ctrl+C`, then restart:

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
EVIA_DEV=1 npm run dev:main
```

Keep the Vite dev server running in the other terminal!

---

### 2. Login via DevTools

Open **Header Window DevTools** (Right-click → Inspect), then run:

```javascript
// Replace with your actual credentials
await window.evia.auth.login("admin", "your-password")
```

Expected response:
```javascript
{ success: true }
```

If you get an error, check:
- Backend is running: `curl http://localhost:8000/health`
- Credentials are correct (default user: `admin` / check backend logs for test users)

---

### 3. Test Transcription Flow

1. Click the **"Zuhören"** button in the header
2. **Check Header Console** - you should see:
   ```
   [OverlayEntry] 🔍 Getting auth token from keytar...
   [OverlayEntry] ✅ Got auth token (length: 137 chars)
   [Chat] Created chat id 123
   [OverlayEntry] Using chat_id: 123
   [OverlayEntry] Audio capture started successfully
   ```

3. **Check Listen Window** - it should open and show:
   ```
   [ListenView] 🔍🔍🔍 COMPONENT FUNCTION EXECUTING
   [ListenView] ✅ Valid chat_id found: 123
   [ListenView] WebSocket useEffect STARTED
   ```

4. **Speak into microphone** - transcripts should appear!

---

## Troubleshooting

### "No auth token found"
```
Run in DevTools: await window.evia.auth.login("admin", "password")
```

### Backend 401 Error
Check backend logs for valid test users:
```bash
cd /Users/benekroetz/EVIA/EVIA-Backend
docker compose logs backend | grep "User" | tail -20
```

### "Failed to create chat"
Ensure:
1. Backend is running: `curl http://localhost:8000/health`
2. Login was successful
3. Token is stored: `await window.evia.auth.getToken()` returns a string

---

## What Changed

### Before (BROKEN)
```typescript
// Read token from localStorage (not secure, often empty)
const token = localStorage.getItem('auth_token') || ''
```

### After (FIXED)
```typescript
// Get token from keytar (secure credential storage)
const token = await window.evia.auth.getToken()
```

---

## Next Steps After Successful Test

Once transcription works:
1. Implement proper login UI (instead of console commands)
2. Add token refresh logic
3. Handle 401 errors gracefully with re-login prompt
4. Test with German language toggle

---

## Debug Commands

Check if logged in:
```javascript
const token = await window.evia.auth.getToken()
console.log('Token exists:', !!token, 'Length:', token?.length)
```

Check chat_id:
```javascript
const chatId = localStorage.getItem('current_chat_id')
console.log('Current chat:', chatId)
```

Manual chat creation (if needed):
```javascript
const token = await window.evia.auth.getToken()
const res = await fetch('http://localhost:8000/chat/', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
const chat = await res.json()
console.log('Created chat:', chat)
localStorage.setItem('current_chat_id', String(chat.id))
```

---

**Ready to test! Restart Electron and login via DevTools.** 🚀

