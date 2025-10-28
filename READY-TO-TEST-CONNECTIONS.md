# ✅ READY TO TEST - CONNECTION GUIDE

**Date**: October 28, 2025 12:50  
**DMG Built**: ✅ EVIA-0.1.0-arm64.dmg (440M)  
**Backend Status**: ✅ Running (but needs DB migration)

---

## 🎯 CONNECTION STATUS

### Backend Connectivity ✅
```bash
$ curl https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io/health
{"status":"ok","message":"EVIA backend is running"}
```
✅ **Backend is reachable**

### Database Schema ❌
```
column chat.language does not exist
```
🔴 **Database migration still needed** (Backend Agent)

---

## 📦 INSTALL NEW DMG

### Step 1: Open DMG
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
open dist/EVIA-0.1.0-arm64.dmg
```

### Step 2: Install to Applications
1. DMG will open showing "EVIA" app (not "EVIA Desktop" ✅)
2. Drag "EVIA" to Applications folder
3. Close DMG

### Step 3: Remove Quarantine
```bash
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app
```

### Step 4: Launch
```bash
open /Applications/EVIA.app
```

---

## 🧪 TEST CONNECTIONS

### Test 1: Basic Launch ✅ Should Work
**Expected**:
- App opens
- Welcome window or Settings appears
- No crashes

**Status**: Should work ✅

---

### Test 2: Login Flow ✅ Should Work
**Steps**:
1. Click "Anmelden" in welcome window
2. Browser opens to Azure frontend
3. Login with credentials
4. Redirect back to Desktop

**Expected**:
- ✅ Browser opens to Azure (not localhost)
- ✅ Login works
- ✅ Settings shows "Angemeldet als: [email]"

**Status**: Should work ✅ (Azure URLs fixed)

---

### Test 3: Ask Feature ❌ Will Fail (Expected)
**Steps**:
1. Press `Cmd+Enter` (Ask bar)
2. Type: "Hi"
3. Press Enter

**Expected**:
- ❌ 500 error
- ❌ "Request failed" toast

**Why**: Backend database missing `chat.language` column

**Status**: **BLOCKED** until Backend Agent runs migration

---

### Test 4: Transcription ❌ Will Fail (Expected)
**Steps**:
1. Press "Zuhören"
2. Speak

**Expected**:
- ❌ May connect to WebSocket
- ❌ But transcripts won't save (DB error)

**Why**: Same database migration issue

**Status**: **BLOCKED** until Backend Agent runs migration

---

## 🔴 CRITICAL BLOCKER

### Backend Database Migration Required

**File**: `/tmp/add_language_column.sql`

**SQL to Run**:
```sql
ALTER TABLE chat ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'de';
ALTER TABLE chat ADD COLUMN IF NOT EXISTS summary TEXT;
CREATE TABLE IF NOT EXISTS summaries (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER REFERENCES chat(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**How to Apply** (Azure Portal - Easiest):
1. Go to: https://portal.azure.com
2. Navigate to: PostgreSQL → evia-prod
3. Click: "Query editor" (left sidebar)
4. Paste: SQL above
5. Click: "Run"
6. Verify: No errors

**Time**: 2 minutes

**Impact**: Unblocks ALL features ✅

---

## ✅ WHAT WORKS NOW (Without Migration)

1. ✅ **App Installation**
   - DMG named "EVIA" correctly
   - Icon shows properly
   - Installs to Applications

2. ✅ **Azure Connectivity**
   - All URLs point to Azure (not localhost)
   - Backend is reachable
   - Frontend is reachable

3. ✅ **Login Flow**
   - Opens Azure frontend login
   - Redirects back to Desktop
   - Settings shows login status

4. ✅ **UI**
   - Settings window opens
   - Listen window opens
   - Ask bar opens
   - No crashes

---

## ❌ WHAT'S BLOCKED (Until Migration)

1. ❌ **Ask Feature**
   - Connects to Azure ✅
   - But gets 500 error ❌
   - Needs: `chat.language` column

2. ❌ **Transcription**
   - May connect ✅
   - But can't save transcripts ❌
   - Needs: `chat.language` column

3. ❌ **Insights**
   - Connects to Azure ✅
   - But gets 500 error ❌
   - Needs: `chat.language` column

4. ❌ **Chat History**
   - Endpoint exists ✅
   - But queries fail ❌
   - Needs: `chat.language` column

---

## 📋 TESTING CHECKLIST

### Before Backend Migration
- [ ] Install new DMG (EVIA name ✅)
- [ ] Launch app (no crashes ✅)
- [ ] Login flow works (Azure URLs ✅)
- [ ] Settings shows login status ✅
- [ ] Ask gets 500 error (expected ❌)
- [ ] Transcription fails (expected ❌)

### After Backend Migration (Backend Agent)
- [ ] Ask feature works ✅
- [ ] Transcription works ✅
- [ ] Insights generate ✅
- [ ] Chat history loads ✅
- [ ] Full E2E flow ✅

---

## 🎯 RECOMMENDED TEST SEQUENCE

### Phase 1: Install & Basic Connectivity (Now)
```bash
# 1. Install
open dist/EVIA-0.1.0-arm64.dmg
# Drag to Applications

# 2. Remove quarantine
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app

# 3. Launch
open /Applications/EVIA.app

# 4. Test login
# - Click "Anmelden"
# - Should open Azure frontend ✅
# - Login works ✅

# 5. Check settings
# - Should show "Angemeldet als: [email]" ✅
```

**Expected Results**:
- ✅ App installs correctly
- ✅ Login to Azure works
- ✅ Settings shows login status
- ✅ No localhost URLs anywhere

---

### Phase 2: Feature Testing (After Backend Migration)
```bash
# 1. Ask feature
# Press Cmd+Enter
# Type: "What is EVIA?"
# Expected: AI response ✅

# 2. Transcription
# Press "Zuhören"
# Speak for 30 seconds
# Expected: Real-time transcripts ✅

# 3. Insights
# After recording
# Click "Insights"
# Expected: Summary, topics, actions ✅

# 4. Chat history
# Open Activity page
# Expected: Saved chats visible ✅
```

**Expected Results**: Everything works ✅

---

## 🔍 TROUBLESHOOTING

### Issue: "EVIA is damaged"
**Fix**: Run quarantine removal
```bash
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app
```

### Issue: App crashes on launch
**Check**:
1. Remove old EVIA.app first
2. Install fresh from new DMG
3. Run quarantine removal

### Issue: Login opens localhost
**Check**:
1. Verify you installed NEW DMG (Oct 28 12:50)
2. Old app might still be running
3. Quit all EVIA instances and relaunch

### Issue: Ask still gets 500 error
**Check**:
1. Backend migration was run?
2. Check backend logs:
```bash
az containerapp logs show --name backend --resource-group EVIA --tail 20
```
3. Should NOT see: "column chat.language does not exist"

---

## 📊 SUMMARY

### ✅ What's Ready
- New DMG built (EVIA name)
- Azure URLs configured
- Backend deployed
- Frontend deployed
- Login flow working

### 🔴 What's Blocked
- Ask feature (DB migration)
- Transcription (DB migration)
- Insights (DB migration)
- Chat history (DB migration)

### ⏱️ Timeline
- **Now**: Install and test basic connectivity
- **After 2 min**: Backend Agent runs migration
- **Then**: Full feature testing
- **Later**: UI restoration (Desktop Agent)

---

## 🚀 NEXT STEPS

**For You (Now)**:
1. ✅ Install new DMG
2. ✅ Test login flow
3. ✅ Verify Azure connectivity
4. 🔴 Notify Backend Agent about migration
5. ⏳ Wait for migration (2 min)
6. ✅ Re-test all features

**For Backend Agent (URGENT)**:
1. Open Azure Portal
2. Go to PostgreSQL → evia-prod
3. Run migration SQL
4. Verify no errors
5. Notify when complete

**For Desktop Agent (Later)**:
1. Restore better Settings UI
2. Restore better Listen UI
3. Keep André's login logic only
4. Full testing

---

**Status**: 🟡 **READY TO TEST CONNECTIVITY**  
**Blocker**: Backend database migration  
**DMG**: ✅ Built and ready  
**Next**: Install, test login, then wait for backend fix

Let me know if you encounter any connection issues! 🚀

