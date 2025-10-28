# 🚨 IMMEDIATE FIXES - STATUS REPORT

**Date**: October 28, 2025  
**Agent**: Deployment Agent (Ultra Mode)  
**Priority**: 🔴 CRITICAL

---

## 🎯 WHAT NEEDS TO HAPPEN NOW

### 1. ✅ BACKEND DATABASE MIGRATION (BLOCKER)

**Issue**: `/ask` and `/transcripts` return 500 errors

**Root Cause**: Database missing `chat.language` column

**Fix SQL** (Ready in `/tmp/add_language_column.sql`):
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

**WHO**: Backend Agent (has Azure DB access)  
**ETA**: 2 minutes  
**IMPACT**: Unblocks ALL features (Ask, Transcription, Insights)

---

### 2. ⏳ DMG NAMING FIX

**Issue**: DMG shows "EVIA Desktop" instead of "EVIA"  
**Icon**: Missing custom logo

**Fix**: Update `electron-builder.yml`
```yaml
productName: EVIA  # Change from "EVIA Desktop"
appId: com.evia.app
icon: src/main/assets/icon.icns
```

**WHO**: Me (doing now)  
**ETA**: 5 minutes + rebuild

---

### 3. 📋 UI RESTORATION (NEXT SESSION)

**Issue**: André's UI worse than user's  
**Needed**: Restore user's better Settings + Listen UI

**Approach**:
- Base: User's original from `prep-fixes/desktop-polish`
- Keep: Only André's login status display logic
- Restore: All of user's better functionality

**WHO**: Desktop Agent (specialized UI work)  
**ETA**: 30-45 minutes proper work  
**PRIORITY**: High but not blocking launch

---

## 🚀 IMMEDIATE ACTION ITEMS

**For User (RIGHT NOW)**:
1. Notify Backend Agent to run migration SQL
2. Wait 2 minutes for backend fix
3. Re-test app (Ask + Transcription should work)

**For Me (IN PROGRESS)**:
1. ✅ Created migration SQL
2. ⏳ Fixing DMG naming
3. ⏳ Fixing icon
4. ⏳ Rebuilding DMG

**For Backend Agent (URGENT)**:
1. Run `/tmp/add_language_column.sql` on Azure PostgreSQL
2. Verify `/ask` endpoint works (not 500)
3. Notify when done

**For Desktop Agent (NEXT)**:
1. Restore user's Settings UI
2. Restore user's Listen UI
3. Keep André's login logic only
4. Full UI testing

---

## ⏱️ TIMELINE

**Now (12:10)**: Backend migration needed  
**12:15**: DMG rebuild complete  
**12:20**: User testing with fixed backend  
**Later today**: UI restoration by Desktop Agent

---

## 💬 USER FEEDBACK ADDRESSED

> "The transcription as well as ask don't work."  
**Fix**: Backend database migration (Backend Agent)

> "DMG named 'EVIA Desktop', wrong icon"  
**Fix**: `electron-builder.yml` + rebuild (Me, in progress)

> "André's UI worse, restore mine"  
**Fix**: UI restoration (Desktop Agent, scheduled)

---

**Status**: 🔄 **COORDINATING FIXES**  
**Blocker**: Backend database migration  
**Next**: DMG rebuild after backend ready
