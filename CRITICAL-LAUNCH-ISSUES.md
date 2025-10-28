# 🚨 CRITICAL LAUNCH ISSUES - Master Tracking Document

**Date**: October 28, 2025  
**Status**: 🔴 **BLOCKING LAUNCH**  
**Reporter**: Bene Kroetz  
**Analysis**: Deployment Agent (Ultra-Deep Mode)

---

## 🎯 EXECUTIVE SUMMARY

**Total Issues**: 12 identified  
**Critical (Blocking)**: 6  
**High Priority**: 4  
**Medium Priority**: 2

**Est. Time to Fix All**: 4-6 hours across 3 agents

---

## 🔴 CRITICAL ISSUES (Blocking Launch)

### ISSUE #1: App Connects to Localhost Instead of Azure ⚡ MOST CRITICAL

**Severity**: 🔴 **BLOCKER**  
**Agent**: Deployment + Desktop  
**Status**: ❌ NOT FIXED  
**Est. Time**: 30 minutes

**Problem**:
- Production app tries to connect to `localhost:8000` instead of Azure backend
- Network errors: `ERR_CONNECTION_REFUSED`
- Console logs show: `localhost:8000/chats/2/transcripts` and `localhost:8000/ask`

**Root Cause**:
- Environment variables set in `preload.ts` but NOT used during Vite build
- Vite bundles renderer code at BUILD TIME with hardcoded fallbacks
- Found 5 instances of "localhost" in bundled `overlay-CcyaMIBx.js`
- `window.EVIA_BACKEND_URL` is exposed but code uses baked-in localhost fallback

**Evidence**:
```bash
$ grep -c "localhost" dist/renderer/assets/overlay-CcyaMIBx.js
5
```

**Fix Required**:
1. Use Vite environment variables (`import.meta.env.VITE_*`)
2. Create `.env.production` file with Azure URLs
3. Update all service files to use `import.meta.env.VITE_BACKEND_URL`
4. Rebuild with proper env vars

**Files to Change**:
- `.env.production` (create)
- `vite.config.ts` (configure env vars)
- `src/renderer/services/connectionMonitor.ts`
- `src/renderer/services/websocketService.ts`
- `src/renderer/services/insightsService.ts`
- `src/renderer/overlay/AskView.tsx`
- `src/renderer/overlay/EviaBar.tsx`
- `src/renderer/overlay/overlay-entry.tsx`
- `src/renderer/audio-processor-glass-parity.ts`

**Verification**:
```bash
# After rebuild, should show Azure URLs:
grep -o "livelydesert" dist/renderer/assets/*.js | wc -l
# Should be > 0
```

---

### ISSUE #2: Header Appears Before Welcome Window (Security Issue) 🔒

**Severity**: 🔴 **BLOCKER** (Security + UX)  
**Agent**: Desktop  
**Status**: ⚠️ André claims fixed (not verified)  
**Est. Time**: 30 minutes

**Problem**:
- Expected flow: Welcome → Permissions → Header (after login)
- Actual flow: Header → (login click) → Welcome → Permissions
- **Header visible WITHOUT login** = Security issue

**User Report**:
> "Fatal about this is that users see the header without being logged in. The header should only be visible after the user registered / logged in, and granted all permissions."

**André's Claim**:
> "The thing you called that eviabar appears without logging in" - "I fixed it already"

**Verification Needed**:
1. Check `header-controller.ts` - does it verify token before showing header?
2. Check state machine logic
3. Test fresh install flow

**Files to Check**:
- `src/main/header-controller.ts`
- `src/main/main.ts` (app startup logic)

**Test**:
1. Delete `/Applications/EVIA.app`
2. Fresh install from DMG
3. Open app
4. **Expected**: Welcome window appears FIRST
5. **Actual**: Header appears FIRST ❌

---

### ISSUE #3: Keychain Password Prompt Every Launch 🔑

**Severity**: 🔴 **BLOCKER** (UX)  
**Agent**: Desktop  
**Status**: ❌ NOT FIXED  
**Est. Time**: 1 hour

**Problem**:
- Every user gets prompted: "EVIA wants to access key 'evia' in your keychain"
- Requires password entry on every launch
- Should only happen ONCE (first launch)

**User Question**:
> "Does every user have to do this?"

**Answer**: NO - This is abnormal. Should only happen once.

**Likely Causes**:
1. **App unsigned** - macOS doesn't trust unsigned apps with keychain
2. **Keytar access rights** - Not set properly for first-time access
3. **App bundle ID changing** - If bundle ID changes, keychain access resets

**Root Cause Investigation Needed**:
```typescript
// Check keytar usage in:
- src/main/preload.ts (keytar import)
- src/main/header-controller.ts (token storage/retrieval)

// Verify bundle ID consistency:
- package.json: name
- electron-builder.yml: appId
```

**Possible Fixes**:
1. **Short-term**: Document that users must allow keychain access (accept password prompt once)
2. **Medium-term**: Code sign the app (requires Apple Developer ID)
3. **Long-term**: Use macOS Keychain with proper access control lists

**Test**:
1. Install app
2. Enter keychain password (allow access)
3. Quit app
4. Relaunch
5. **Expected**: No password prompt
6. **Actual**: Password prompt again ❌

---

### ISSUE #4: Settings Links Open Localhost Instead of Azure 🌐

**Severity**: 🔴 **BLOCKER** (UX)  
**Agent**: Deployment + Desktop  
**Status**: ⚠️ PARTIALLY FIXED (I fixed SettingsView, but need verification)  
**Est. Time**: 15 minutes

**Problem**:
- "Personalize / Meeting Notes" button opens `localhost:5173` instead of Azure frontend
- Other settings buttons also wrong

**User Report**:
> "when i press Personalize / Meeting Notes, it doesnt direct me to the azure frontend, but the localhost link (bad). Same with most other settings buttons."

**My Earlier Fix**:
- I updated `SettingsView.tsx` lines 84-96 to use dynamic URLs
- Uses `(window as any).EVIA_FRONTEND_URL || 'http://localhost:5173'`
- BUT if `window.EVIA_FRONTEND_URL` isn't set, falls back to localhost

**This is Related to ISSUE #1**:
- If environment variables aren't working, EVIA_FRONTEND_URL won't be set
- Fix Issue #1 first, then test this

**Files Changed** (by me earlier):
- `src/renderer/overlay/SettingsView.tsx` (lines 84-96) ✅

**Verification**:
```javascript
// In DevTools console when app is running:
window.EVIA_FRONTEND_URL
// Should show: https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io
// If shows: undefined → Issue #1 not fixed
```

---

### ISSUE #5: Database Schemas Not Updated in Production 🗄️

**Severity**: 🔴 **BLOCKER** (Backend)  
**Agent**: Backend  
**Status**: ❌ NOT FIXED  
**Est. Time**: 1-2 hours

**Problem**:
- Production database may be missing tables/columns
- André mentioned needing to match with `models.py`
- Potential data loss if migrations run without backup

**User Question**:
> "dont we have to add db tables/schemas/or else to the prod database? We havent updated it yet."

**André's Response**:
> "Im gonna match it with current models.py"  
> "for that database refactor, im probably going to delete (flush) the data in them, only if that refactor is incompatible with current data"

**User's Concern**:
> "Don't delete the data. Can't you do a backup?/ check what schemas/tables are to be added?"

**Required Actions**:
1. **FIRST**: Backup Azure production database
   ```bash
   az postgres flexible-server backup create \
     --resource-group EVIA \
     --name evia-prod \
     --backup-name pre-migration-backup-2025-10-28
   ```

2. **Compare schemas**:
   - Local `models.py` vs Production database
   - Identify missing tables/columns
   - Generate Alembic migration

3. **Test migration locally**:
   - Restore production backup to local PostgreSQL
   - Run migration
   - Verify no data loss

4. **Apply to production**:
   - Run migration during maintenance window
   - Verify all tables exist

**Critical Tables to Check**:
- `users`
- `chats`
- `transcripts`
- `summaries` (may be new)
- `qa_messages` or `ai_messages` (for Ask history)

**Verification**:
```sql
-- Connect to production database
-- Check if summaries table exists:
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'summaries';

-- Check Chat model has language column:
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'chat' AND column_name = 'language';
```

---

### ISSUE #6: Default Language is English (Should be German) 🇩🇪

**Severity**: 🟠 **HIGH** (UX)  
**Agent**: Desktop  
**Status**: ⚠️ André claims to be fixing  
**Est. Time**: 15 minutes

**Problem**:
- App defaults to English
- Should default to German (primary market)

**User Report**:
> "I have it set to english by default (default should be german)."

**André's Response**:
> "i can do the german-first language... before going to sleep"

**Fix Required**:
Check these files for language initialization:
- `src/renderer/i18n/i18n.js` or similar
- `src/renderer/overlay/overlay-entry.tsx`
- `src/main/main.ts`

**Look for**:
```typescript
// BAD:
const defaultLanguage = 'en';

// GOOD:
const defaultLanguage = 'de';
```

**Verification**:
1. Fresh install
2. Open app
3. Check UI language
4. **Expected**: German
5. **Actual**: English ❌

---

## 🟠 HIGH PRIORITY ISSUES

### ISSUE #7: Ask Input Not Auto-Focused ⌨️

**Severity**: 🟠 **HIGH** (UX)  
**Agent**: Desktop  
**Status**: ❌ NOT FIXED  
**Est. Time**: 15 minutes

**Problem**:
- When Ask window opens, input is not focused
- User must click input box before typing
- Should auto-focus for immediate typing

**User Report**:
> "i try to ask something... (have to press ask bar input box first, it doesnt automatically focus on the input box)"

**Code Location**:
- `src/renderer/overlay/AskView.tsx`
- Look for `useEffect` with focus logic
- Console shows: `[AskView] ⌨️ Auto-focused input (attempt 1)`
- But it's not working

**Possible Causes**:
1. Race condition (focus called before element ready)
2. Window not fully visible when focus attempted
3. macOS permission issue with auto-focus

**Fix**:
```typescript
// In AskView.tsx, after window becomes visible:
useEffect(() => {
  if (document.visibilityState === 'visible') {
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100); // Delay to ensure window is ready
  }
}, []);
```

**Verification**:
1. Press Cmd+Shift+Return (Ask window opens)
2. Immediately start typing
3. **Expected**: Text appears in input
4. **Actual**: Nothing happens (must click first) ❌

---

### ISSUE #8: Backend Offline/WS Error Toasts 🔔

**Severity**: 🟠 **HIGH** (UX)  
**Agent**: Desktop + Deployment  
**Status**: ⚠️ Related to Issue #1  
**Est. Time**: 0 (fix Issue #1)

**Problem**:
- Toast notifications: "Offline mode"
- Toast: "WS error - audio capture failed"
- Header throwing backend error toasts

**User Report**:
> "The header also throws backend error toasts. (offline mode, and when i press listen: WS error - audiocapture failed)."

**Root Cause**:
- Same as Issue #1 - trying to connect to localhost
- Backend not reachable because wrong URL

**Fix**:
- Fix Issue #1 (use Azure URLs)
- These toasts should stop

**No separate fix needed** - dependency on Issue #1

---

### ISSUE #9: Source Code Assets Can't Be Deleted 📦

**Severity**: 🟡 **MEDIUM** (Info only)  
**Agent**: N/A (GitHub limitation)  
**Status**: ⚠️ NOT FIXABLE  
**Est. Time**: 0 (document only)

**Problem**:
- GitHub automatically adds "Source code (zip)" and "Source code (tar.gz)" to every release
- User cannot delete these
- User wants only app downloadable, not code (not opensource)

**User Request**:
> "The Source code (zip)" and "Source code (tar.gz)" files have to be deleted"

**Answer**:
**CANNOT BE DELETED** - This is a GitHub limitation.

**Alternatives**:
1. **Accept it**: Leave the source code assets (recommended)
   - Most users won't download them
   - Developers who want source can get it
   - Standard GitHub behavior

2. **Make repo private**: 
   - Source code downloads require authentication
   - But DMG downloads also require auth ❌
   - Not recommended

3. **Use different hosting**:
   - Azure Blob Storage
   - Direct download server
   - Loses GitHub's CDN/versioning benefits

**Recommendation**: 
- Keep source code assets
- In release notes, clearly mark which file to download
- Already done in `GITHUB-RELEASE-NOTES-TEMPLATE.md`:
  ```markdown
  ## ⚠️ IGNORE Source Code Files
  The "Source code (zip)" and "Source code (tar.gz)" files are 
  automatically added by GitHub. You don't need these.
  Download the DMG files instead.
  ```

**Status**: DOCUMENTED, NOT FIXABLE

---

### ISSUE #10: André's Fixes Need Verification 🔍

**Severity**: 🟡 **MEDIUM** (Verification)  
**Agent**: Coordinator  
**Status**: ⏳ PENDING VERIFICATION  
**Est. Time**: 30 minutes

**André's Claims**:
1. ✅ "Fixed eviabar appears without logging in"
2. ✅ "Fixed mac os logic override"
3. 🔄 "Matching database with models.py"
4. 🔄 "German-first language"

**Verification Needed**:
1. **Pull André's commits**:
   ```bash
   cd EVIA-Desktop
   git fetch origin
   git pull origin main  # Or whatever branch he pushed to
   ```

2. **Review changes**:
   ```bash
   git log --oneline -10
   git diff HEAD~5  # Check last 5 commits
   ```

3. **Rebuild and test**:
   ```bash
   ./build-production.sh
   # Test each claimed fix
   ```

4. **Verify no Windows code overwritten**:
   - André warned about macOS-specific code overriding Windows code
   - Check main process files for platform checks
   - Look for `process.platform === 'darwin'` logic

**Files André Likely Changed**:
- `src/main/header-controller.ts` (header appearing issue)
- `src/main/main.ts` (startup logic)
- Language files (German default)
- Database migration files

**Test Protocol**:
1. Fresh install
2. Check welcome window appears first ✓
3. Check header doesn't appear before login ✓
4. Check language defaults to German ✓
5. Check no Windows-specific code broken ✓

---

## 🟢 MEDIUM/LOW PRIORITY ISSUES

### ISSUE #11: Alembic Temporarily Disabled in Production ⚠️

**Severity**: 🟢 **INFO** (Backend)  
**Agent**: Backend  
**Status**: ℹ️ DOCUMENTED  
**Est. Time**: 0 (already known)

**From azure-config.md**:
> "Alembic is temporarily disabled in production. Schema alignment is handled by startup safeguards and targeted SQL when needed. A baseline migration will be generated later from the current schema."

**Not a new issue** - just documented for completeness.

**Related to Issue #5** - database schemas.

---

### ISSUE #12: macOS Permissions Flow Unclear 🔐

**Severity**: 🟢 **LOW** (UX improvement)  
**Agent**: Desktop  
**Status**: ℹ️ EXISTING  
**Est. Time**: Future enhancement

**Not reported by user, but observed**:
- Permissions window flow could be clearer
- Multiple prompts (Microphone, Screen Recording, Accessibility)
- Could add visual progress indicator

**Future Enhancement** - not blocking launch.

---

## 📊 AGENT RESPONSIBILITY MATRIX

| Issue # | Title | Agent | Priority | Est. Time | Status |
|---------|-------|-------|----------|-----------|--------|
| 1 | Localhost instead of Azure URLs | Deployment + Desktop | 🔴 CRITICAL | 30 min | ❌ Not Fixed |
| 2 | Header before welcome | Desktop | 🔴 CRITICAL | 30 min | ⚠️ André claims fixed |
| 3 | Keychain password every launch | Desktop | 🔴 CRITICAL | 1 hour | ❌ Not Fixed |
| 4 | Settings links to localhost | Deployment + Desktop | 🔴 CRITICAL | 15 min | ⚠️ Partial |
| 5 | Database schemas not updated | Backend | 🔴 CRITICAL | 1-2 hours | ❌ Not Fixed |
| 6 | Default language English | Desktop | 🟠 HIGH | 15 min | ⚠️ André working |
| 7 | Ask input not auto-focused | Desktop | 🟠 HIGH | 15 min | ❌ Not Fixed |
| 8 | Backend error toasts | Desktop + Deployment | 🟠 HIGH | 0 (dep #1) | ⚠️ Depends on #1 |
| 9 | Source code assets | N/A | 🟡 MEDIUM | 0 | ℹ️ Not fixable |
| 10 | Verify André's fixes | Coordinator | 🟡 MEDIUM | 30 min | ⏳ Pending |
| 11 | Alembic disabled | Backend | 🟢 INFO | 0 | ℹ️ Known |
| 12 | Permissions flow UX | Desktop | 🟢 LOW | Future | ℹ️ Enhancement |

---

## 🎯 RECOMMENDED FIX SEQUENCE

### Phase 1: CRITICAL (Before any user testing)

**1.1 Fix Issue #1 (Localhost URLs)** - DEPLOYMENT AGENT
- Time: 30 minutes
- Blocker for everything else
- I can fix this immediately

**1.2 Fix Issue #5 (Database Schemas)** - BACKEND AGENT
- Time: 1-2 hours
- Must backup first
- Run migrations

**1.3 Verify Issue #2 (Header Flow)** - DESKTOP AGENT
- Time: 15 minutes verification
- If not fixed: 30 minutes to fix
- Critical security issue

**1.4 Test Issue #4 (Settings Links)** - DEPLOYMENT AGENT
- Time: 5 minutes
- Should work after Issue #1 fixed

---

### Phase 2: HIGH PRIORITY (Before launch)

**2.1 Fix Issue #6 (German Default)** - DESKTOP AGENT
- Time: 15 minutes
- André may have already done this

**2.2 Fix Issue #7 (Auto-focus)** - DESKTOP AGENT
- Time: 15 minutes
- UX polish

**2.3 Investigate Issue #3 (Keychain)** - DESKTOP AGENT
- Time: 1 hour
- May require code signing (future)

---

### Phase 3: VERIFICATION

**3.1 Full Integration Test** - ALL AGENTS
- Time: 30 minutes
- Test complete user flow
- Document any new issues

**3.2 Update Documentation** - DEPLOYMENT AGENT
- Time: 15 minutes
- Update release notes
- Add known issues section

---

## 🚀 IMMEDIATE ACTIONS (Next 2 Hours)

### For DEPLOYMENT AGENT (Me):

**Now - 30 minutes:**
1. ✅ Create this tracking document
2. ⏳ Fix Issue #1 (Vite environment variables)
3. ⏳ Rebuild production DMG
4. ⏳ Test Azure connection

**After 30 minutes:**
5. ⏳ Verify Issue #4 still works
6. ⏳ Update documentation

---

### For DESKTOP AGENT:

**Now - 1 hour:**
1. ⏳ Pull André's commits
2. ⏳ Review changes (verify no Windows code overridden)
3. ⏳ Verify Issue #2 (header flow) actually fixed
4. ⏳ Fix Issue #7 (auto-focus)
5. ⏳ Verify Issue #6 (German default)

---

### For BACKEND AGENT:

**Now - 2 hours:**
1. ⏳ Backup Azure production database
2. ⏳ Compare local models.py vs production schema
3. ⏳ Generate migration (if needed)
4. ⏳ Test migration locally
5. ⏳ Apply to production (maintenance window)

---

### For COORDINATOR:

**Now - 30 minutes:**
1. ⏳ Review this document
2. ⏳ Assign agents to issues
3. ⏳ Set up communication channel for status updates
4. ⏳ Schedule next check-in (2 hours)

---

## 📈 SUCCESS CRITERIA

**Before declaring "launch ready":**

- [ ] Issue #1: App connects to Azure (not localhost) ✅
- [ ] Issue #2: Welcome appears before header ✅
- [ ] Issue #3: Keychain prompt (documented or fixed) ✅
- [ ] Issue #4: Settings links open Azure frontend ✅
- [ ] Issue #5: Database schemas up to date ✅
- [ ] Issue #6: German is default language ✅
- [ ] Issue #7: Ask input auto-focuses ✅
- [ ] Issue #8: No backend error toasts (Azure connected) ✅
- [ ] Issue #10: André's fixes verified ✅

**Known Issues (Acceptable for launch):**
- Issue #3: Keychain prompt (if code signing not feasible)
- Issue #9: Source code assets (GitHub limitation)
- Issue #11: Alembic disabled (documented)
- Issue #12: Permissions UX (future enhancement)

---

## 🔗 RELATED DOCUMENTATION

- `PRODUCTION-DEPLOYMENT-GUIDE.md` - Original deployment guide
- `URGENT-FIXES-ACTION-PLAN.md` - Icon/damaged app fixes
- `FIX-DAMAGED-APP-ERROR.md` - Keychain/security issues
- `ICON-FIX-COMPLETE.md` - Icon implementation complete
- `azure-config.md` - Azure configuration details

---

**Status**: 📋 **TRACKING ACTIVE**  
**Next Update**: After Phase 1 completion  
**Est. Launch**: 6-8 hours if all agents work in parallel

---

**Created**: October 28, 2025 09:00 UTC  
**By**: Deployment Agent (Ultra-Deep Analysis Mode)  
**For**: Bene Kroetz (Coordinator)

