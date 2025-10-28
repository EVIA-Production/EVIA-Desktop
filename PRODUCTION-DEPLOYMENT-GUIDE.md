# 🚀 EVIA Desktop - Production Deployment Guide

**Status**: ✅ Production DMG Built  
**Date**: October 27, 2025  
**Version**: 0.1.0

---

## 📋 DEPLOYMENT SUMMARY

### ✅ What's Been Done

1. **Environment Configuration**: Production Azure URLs injected via preload.ts
2. **URL Updates**: All localhost references updated to Azure endpoints
3. **CSP Headers**: Updated to allow Azure Container Apps connections
4. **DMG Build**: Successfully built for both Intel and Apple Silicon
5. **Code Signing**: Ad-hoc (unsigned) for initial deployment

### 📦 Build Artifacts

Located in `EVIA-Desktop/dist/`:

| File | Size | Architecture | Format | Recommended |
|------|------|--------------|--------|-------------|
| `EVIA-0.1.0-arm64.dmg` | 446 MB | Apple Silicon (M1/M2/M3) | DMG | ✅ **YES** (Most users) |
| `EVIA-0.1.0.dmg` | 222 MB | Intel x64 | DMG | Legacy Macs only |
| `EVIA-0.1.0-arm64-mac.zip` | 431 MB | Apple Silicon | ZIP | Alternative format |
| `EVIA-0.1.0-mac.zip` | 214 MB | Intel x64 | ZIP | Alternative format |

**Recommended for Distribution**: `EVIA-0.1.0-arm64.dmg` (Apple Silicon)

---

## 🌐 AZURE CONFIGURATION

### Backend Endpoints

The production app connects to these Azure Container Apps URLs:

```bash
# HTTP API
https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io

# WebSocket
wss://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io

# Frontend (for Settings links)
https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io
```

### How URLs are Injected

**Method**: Environment variables → preload.ts → renderer process

```typescript
// At build time (build-production.sh):
export EVIA_BACKEND_URL=https://backend.livelydesert-1db1c46d...
export VITE_FRONTEND_URL=https://frontend.livelydesert-1db1c46d...
export EVIA_WS_URL=wss://backend.livelydesert-1db1c46d...

// In preload.ts:
const PRODUCTION_CONFIG = {
  EVIA_BACKEND_URL: process.env.EVIA_BACKEND_URL || 'http://localhost:8000',
  // ... exposed to renderer via contextBridge
}

// Accessible in renderer as:
(window as any).EVIA_BACKEND_URL  // "https://backend.livelydesert..."
```

### Files Modified for Production

1. **`src/main/preload.ts`**:
   - Added PRODUCTION_CONFIG object
   - Exposed URLs via contextBridge to renderer
   - Backward compatible with existing code

2. **`src/renderer/overlay/SettingsView.tsx`**:
   - Updated frontend links to use dynamic URLs
   - Falls back to localhost in development

3. **`src/renderer/overlay.html`** (+ welcome.html, permission.html):
   - CSP headers updated to allow `*.azurecontainerapps.io`

4. **`electron-builder.yml`**:
   - Enabled DMG and ZIP targets
   - Configured DMG window and icon

5. **`config/production.config.js`**:
   - Centralized production URLs (reference only)

---

## 📥 DISTRIBUTION OPTIONS

### Option 1: GitHub Releases (Recommended)

**Pros**:
- Free hosting
- CDN distribution
- Version management
- Direct download links

**Steps**:

```bash
# 1. Create a new release on GitHub
# Go to: https://github.com/YOUR_ORG/EVIA-Desktop/releases/new

# 2. Tag version
Tag: v0.1.0
Release title: EVIA Desktop v0.1.0 - Production Release

# 3. Upload build artifacts
- dist/EVIA-0.1.0-arm64.dmg (Primary)
- dist/EVIA-0.1.0.dmg (Intel)
- dist/EVIA-0.1.0-arm64-mac.zip (Alternative)

# 4. Write release notes (template below)

# 5. Publish release

# 6. Download link will be:
https://github.com/YOUR_ORG/EVIA-Desktop/releases/download/v0.1.0/EVIA-0.1.0-arm64.dmg
```

**Release Notes Template**:

```markdown
## EVIA Desktop v0.1.0 - Production Release

**Always-on-top AI assistant for macOS**

### Features
- 🎤 Dual audio capture (microphone + system audio)
- 🌐 Real-time transcription (Deepgram)
- 🧠 AI insights (Groq/LLaMA)
- 💬 Ask functionality with streaming responses
- 🌍 German + English language support
- ⌨️ Keyboard shortcuts (Cmd+K, Cmd+Shift+Return)

### Downloads

**macOS Apple Silicon (M1/M2/M3)** - Recommended
- [EVIA-0.1.0-arm64.dmg](link) (446 MB)

**macOS Intel**
- [EVIA-0.1.0.dmg](link) (222 MB)

### Installation

1. Download the appropriate DMG for your Mac
2. Open the DMG file
3. Drag EVIA.app to Applications folder
4. Open EVIA from Applications
5. Grant permissions when prompted (Microphone, Screen Recording, Accessibility)
6. Login with your EVIA credentials

### Requirements
- macOS 12+ (Monterey or later)
- Apple Silicon or Intel processor
- Active internet connection
- EVIA account

### Known Issues
- App is unsigned (ad-hoc signature) - Right-click → Open on first launch
- Requires backend running at Azure (automatically configured)

### Support
See [README.md](link) for full documentation.
```

---

### Option 2: Azure Blob Storage

**Pros**:
- Already using Azure
- Can set public access
- Good for internal distribution

**Steps**:

```bash
# 1. Upload to Azure Blob Storage
az storage blob upload \
  --account-name evia \
  --container-name downloads \
  --name EVIA-0.1.0-arm64.dmg \
  --file dist/EVIA-0.1.0-arm64.dmg \
  --content-type application/x-apple-diskimage

# 2. Set public access (if needed)
az storage blob set-properties \
  --account-name evia \
  --container-name downloads \
  --name EVIA-0.1.0-arm64.dmg \
  --public-access blob

# 3. Get download URL
# https://evia.blob.core.windows.net/downloads/EVIA-0.1.0-arm64.dmg
```

---

### Option 3: Direct Download Server

**Pros**:
- Full control
- Custom download page

**Cons**:
- Requires server setup
- Bandwidth costs

**Not recommended for MVP** - Use GitHub Releases instead.

---

## 🧪 TESTING CHECKLIST

### Pre-Distribution Testing

**Before sharing the download link**, test these scenarios:

#### Test 1: Fresh Install (Critical)
```bash
# 1. Download DMG from distribution source
# 2. Mount DMG
# 3. Drag to Applications
# 4. Open EVIA.app
# 5. Verify:
   ✅ App launches without errors
   ✅ Welcome screen appears
   ✅ Login works
```

#### Test 2: Backend Connection (Critical)
```bash
# After login:
# 1. Press Cmd+K (Listen)
# 2. Speak for 10 seconds
# 3. Press Stop
# 4. Verify:
   ✅ Transcripts appear (not blank)
   ✅ Language is correct (German/English based on settings)
   ✅ Insights generate (Summary, Topics, Actions)
```

#### Test 3: WebSocket Connection (Critical)
```bash
# During recording:
# 1. Open DevTools (if unsigned): Cmd+Option+I
# 2. Check Console for:
   ✅ No "WebSocket connection failed" errors
   ✅ See "wss://backend.livelydesert..." connection
   ✅ Transcripts streaming in real-time
```

#### Test 4: Ask Functionality (High Priority)
```bash
# 1. Click Ask icon or Cmd+Shift+Return
# 2. Type: "What is 2+2?"
# 3. Press Enter
# 4. Verify:
   ✅ Response streams in
   ✅ Window auto-resizes
   ✅ Markdown renders correctly
```

#### Test 5: Settings Links (Medium Priority)
```bash
# 1. Click Settings (⋯)
# 2. Click "Aktivität" (Activity)
# 3. Verify:
   ✅ Opens browser to: https://frontend.livelydesert.../activity
   ✅ Page loads (not localhost)
```

#### Test 6: Permissions (Medium Priority)
```bash
# On first run:
# 1. Grant Microphone permission
# 2. Grant Screen Recording permission
# 3. Grant Accessibility permission
# 4. Verify:
   ✅ All permissions accepted
   ✅ App transitions to main interface
```

---

## 🔍 TROUBLESHOOTING

### Issue: "App can't be opened because it is from an unidentified developer"

**Cause**: App is not signed with Apple Developer ID

**Fix**:
```bash
# Option 1: Right-click workaround (Recommended)
1. Right-click EVIA.app
2. Select "Open"
3. Click "Open" in dialog

# Option 2: System Settings
1. System Settings → Privacy & Security
2. Scroll to "EVIA was blocked from use"
3. Click "Open Anyway"

# Option 3: Remove quarantine attribute (Advanced)
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app
```

---

### Issue: Backend Connection Failed

**Symptoms**:
- "Backend offline" message
- No transcripts appearing
- WebSocket errors in console

**Diagnosis**:
```bash
# Check if backend is reachable
curl https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io/health

# Expected: {"status":"ok","message":"EVIA backend is running"}
```

**Fixes**:

1. **Backend is down**:
   ```bash
   # Check Azure Container Apps status
   az containerapp show \
     --name backend \
     --resource-group EVIA \
     --query "properties.runningStatus"
   
   # Restart if needed
   az containerapp revision restart \
     --name backend \
     --resource-group EVIA
   ```

2. **CORS issue**:
   - Check backend logs for CORS errors
   - Verify `FRONTEND_URL` env var includes Desktop origin

3. **Network/Firewall**:
   - Check user's firewall allows HTTPS/WSS
   - Test from different network

---

### Issue: Transcripts in Wrong Language

**Symptoms**:
- Set language to English → Transcripts in German

**Cause**: Backend language parameter not being passed correctly

**Diagnosis**:
```bash
# In DevTools console:
(window as any).EVIA_BACKEND_URL
// Should show Azure URL, not localhost

# Check WebSocket connection:
// Look for language parameter in WebSocket messages
```

**Fix**:
- This is a **backend issue**, not Desktop
- Desktop correctly sends `language` parameter
- Backend needs to pass it to Deepgram
- See: `EVIA-Backend/BACKEND-LANGUAGE-AND-INSIGHTS-ISSUES.md`

---

### Issue: Insights Not Generating

**Symptoms**:
- Transcripts work
- Insights section blank or shows error

**Cause**: Groq API rate limit or key issue

**Diagnosis**:
```bash
# Check backend logs
az containerapp logs show \
  --name backend \
  --resource-group EVIA \
  --tail 50

# Look for:
# "Rate limit reached for model llama-3.3-70b-versatile"
# "Groq API error: 401 Unauthorized"
```

**Fix**:
- Update `GROQ_API_KEY` in backend (see GROQ_API_KEY_UPDATE.md)
- Wait if rate limited (free tier: 100k tokens/day)

---

### Issue: App Crashes on Startup

**Symptoms**:
- App launches then immediately closes
- No error message

**Diagnosis**:
```bash
# Check macOS crash logs
open ~/Library/Logs/DiagnosticReports/

# Look for files starting with "EVIA"
# Check for permission errors or missing dependencies
```

**Fixes**:

1. **Permissions not granted**:
   - Reset and re-grant permissions
   ```bash
   tccutil reset Microphone com.evia.app
   tccutil reset ScreenCapture com.evia.app
   tccutil reset Accessibility com.evia.app
   ```

2. **Corrupted state**:
   - Delete app data
   ```bash
   rm -rf ~/Library/Application\ Support/evia/
   ```

3. **Native module issue**:
   - Verify keytar was compiled correctly
   - Check electron version matches build

---

## 📊 DEPLOYMENT METRICS

### Success Criteria

After deployment, monitor these metrics:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Download Success Rate** | >95% | GitHub Releases download count vs attempts |
| **Installation Success** | >90% | User reports + crash logs |
| **First Launch Success** | >85% | Users reaching login screen |
| **Backend Connection** | >95% | No "offline" errors in first 5 min |
| **Transcription Accuracy** | >90% | User satisfaction surveys |
| **Crash Rate** | <1% | macOS crash reports |

### Monitoring

**Week 1 Post-Launch**:
- Daily check of GitHub Issues for installation problems
- Monitor Azure backend logs for connection spikes
- Track Groq API usage (rate limits)
- Collect user feedback via support channel

**Week 2-4**:
- Weekly metrics review
- Identify top 3 issues
- Plan hotfix release if needed

---

## 🔄 UPDATE STRATEGY

### Releasing Updates

**Version Numbering**: Semantic Versioning (MAJOR.MINOR.PATCH)

- **Patch** (0.1.1): Bug fixes, no new features
- **Minor** (0.2.0): New features, backward compatible
- **Major** (1.0.0): Breaking changes, major milestones

**Update Process**:

1. **Increment version** in `package.json`
2. **Rebuild** with `./build-production.sh`
3. **Test** thoroughly
4. **Create GitHub Release** with new tag
5. **Update download link** on website/docs
6. **Notify users** (in-app notification if auto-update enabled)

### Future: Auto-Update

Currently using `electron-updater` dependency but not configured.

**To enable**:
1. Sign app with Developer ID
2. Configure `publish` in electron-builder.yml
3. Implement update check on app startup
4. Test update flow end-to-end

---

## 🎯 PRODUCTION DEPLOYMENT CHECKLIST

Before declaring "production ready":

- ✅ **Build**: DMG successfully built for both architectures
- ✅ **URLs**: All Azure endpoints configured correctly
- ✅ **CSP**: Headers allow Azure connections
- ⏳ **Distribution**: GitHub Release created with download link
- ⏳ **Testing**: All 6 critical tests passed (see Testing Checklist)
- ⏳ **Monitoring**: Azure backend logs monitored
- ⏳ **Documentation**: README updated with download link
- ⏳ **Support**: Issue tracker ready for user reports

---

## 📞 SUPPORT & NEXT STEPS

### Immediate Next Steps

1. **Create GitHub Release** (if not done):
   - Upload `EVIA-0.1.0-arm64.dmg`
   - Write release notes
   - Publish

2. **Test Installation**:
   - Download from GitHub Release
   - Fresh install on clean Mac
   - Run through 6 test scenarios

3. **Share Download Link**:
   - Update website
   - Notify beta testers
   - Monitor first 24 hours

### Long-Term Improvements

1. **Code Signing**:
   - Obtain Apple Developer ID
   - Sign app for notarization
   - Enable auto-update

2. **Crash Reporting**:
   - Integrate Sentry or similar
   - Track errors in production

3. **Analytics**:
   - Track feature usage
   - Monitor performance metrics

4. **CI/CD**:
   - Automate builds on git tag
   - Auto-publish to GitHub Releases

---

## 📚 RELATED DOCUMENTATION

- **Architecture**: [EVIA-DESKTOP-ARCHITECTURE.md](./EVIA-DESKTOP-ARCHITECTURE.md)
- **Development**: [README.md](./README.md)
- **Backend**: [../EVIA-Backend/README.md](../EVIA-Backend/README.md)
- **Azure Config**: [../EVIA-Backend/docs/azure-config.md](../EVIA-Backend/docs/azure-config.md)

---

**Deployment Guide Complete** ✅  
**Production DMG Ready** 🚀  
**Ready for Distribution** 📦

---

**Last Updated**: October 27, 2025  
**Version**: 0.1.0  
**Deployment Agent**: Ultra-Deep Mode

