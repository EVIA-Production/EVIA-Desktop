# ✅ EVIA v1.0.0 - Production Release Checklist

**Release Date:** 2025-10-29  
**Status:** Ready for Production  

---

## 📋 Pre-Release Checklist

### ✅ Code Quality
- [x] All bugs fixed (session isolation, CORS, DB schema)
- [x] localStorage cleanup implemented
- [x] Error handling improved
- [x] Logging enhanced for debugging
- [x] No console errors in production build
- [x] TypeScript compilation successful

### ✅ Testing
- [x] Session isolation verified (each "Done" creates new chat)
- [x] Summary auto-generation working
- [x] Q&A storage and retrieval working
- [x] Presets integration with Groq confirmed
- [x] Fresh install tested (reset script)
- [x] Permissions flow tested
- [x] Login/logout tested
- [x] Recording → transcript → summary flow tested

### ✅ Backend
- [x] Deployed to Azure Container Apps
- [x] Database schema up to date
- [x] CORS configured correctly
- [x] `/session/complete` endpoint working
- [x] `/ask` endpoint working
- [x] `/chat/{id}/` endpoint working
- [x] Summary generation working

### ✅ Frontend
- [x] Deployed to Azure Container Apps
- [x] Activity page displaying sessions correctly
- [x] Chat details page showing summary + Q&A
- [x] Login/authentication working
- [x] Desktop token authentication working

### ✅ Documentation
- [x] Deployment guide created
- [x] Quick start guide created
- [x] README.txt for users created
- [x] Demo video script created
- [x] GitHub Actions workflow created
- [x] Reset script created

---

## 🚀 Release Steps

### Step 1: Final Build Test
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Clean build
rm -rf dist/
npm run build

# Test the app
open dist/mac-arm64/EVIA.app
```

**Verify:**
- [ ] App launches
- [ ] No console errors
- [ ] Create test session → works
- [ ] Chat ID is NEW (not 288)
- [ ] See `🗑️ Cleared chat_id` log in console
- [ ] Second session creates DIFFERENT chat ID

### Step 2: Update Version
```bash
# Update package.json version
npm version 1.0.0 --no-git-tag-version

# Commit
git add package.json
git commit -m "Release v1.0.0 - Production ready"
git push origin main
```

### Step 3: Create Release Tag
```bash
# Create annotated tag
git tag -a v1.0.0 -m "Release v1.0.0

✨ Features:
- Session isolation: Each recording creates separate chat
- Auto-summary generation after each session
- Q&A history tracking
- Preset integration with AI responses

🐛 Fixes:
- Fixed localStorage not clearing after session complete
- Fixed sessions merging into one chat
- Fixed CORS errors on chat details page
- Fixed database schema compatibility"

# Push tag (triggers GitHub Actions)
git push origin v1.0.0
```

### Step 4: Monitor GitHub Actions
- [ ] Go to https://github.com/benekroetz/EVIA/actions
- [ ] Watch "Desktop App Release" workflow
- [ ] Wait for completion (~10-15 minutes)
- [ ] Verify no errors

### Step 5: Verify GitHub Release
- [ ] Go to https://github.com/benekroetz/EVIA/releases
- [ ] Find release "v1.0.0"
- [ ] Verify downloads available:
  - [ ] EVIA-arm64.dmg
  - [ ] EVIA-x64.dmg
- [ ] Edit release notes if needed

---

## 🎬 Demo Video Recording

### Before Recording
```bash
# Reset to new user state
cd /Users/benekroetz/EVIA/EVIA-Desktop
./scripts/reset-to-new-user.sh
```

### Recording Setup
- [ ] Clear desktop (hide files/folders)
- [ ] Close unnecessary apps
- [ ] Set screen resolution to 1920x1080 or 1440x900
- [ ] Test microphone audio levels
- [ ] Prepare script (see DEPLOYMENT-GUIDE.md)

### Video Structure (5-7 minutes)
- [ ] Intro (30s): What is EVIA, what you'll learn
- [ ] Installation (1m): Download → drag to Applications
- [ ] Permissions (1.5m): Screen Recording + Microphone
- [ ] Login (30s): Enter credentials
- [ ] First session (2m): Click "Listen" → speak → "Done"
- [ ] AI features (1.5m): Ask, Insights, Activity page
- [ ] Outro (30s): Where to get help, thank you

### After Recording
- [ ] Edit video (cut mistakes, add captions)
- [ ] Export as MP4 (H.264, 1080p)
- [ ] File name: `EVIA-Setup-Demo-v1.0.0.mp4`
- [ ] Test playback on Mac and Windows

---

## 📦 User Package Preparation

### Package Structure
```
EVIA-v1.0.0-Package/
├── Downloads/
│   ├── EVIA-arm64.dmg
│   └── EVIA-x64.dmg
├── Demo/
│   └── EVIA-Setup-Demo-v1.0.0.mp4
├── Docs/
│   ├── Quick-Start-Guide.pdf
│   ├── Troubleshooting.pdf
│   └── FAQ.pdf
└── README.txt
```

### Create Package
- [ ] Create folder: `EVIA-v1.0.0-Package`
- [ ] Download .dmg files from GitHub Release
- [ ] Add demo video
- [ ] Convert QUICK-START-GUIDE.md to PDF
- [ ] Create Troubleshooting.pdf
- [ ] Create FAQ.pdf
- [ ] Add README.txt

### Upload Package
Choose one:
- [ ] **Option A:** Dropbox → Create shareable link
- [ ] **Option B:** Google Drive → Create shareable link
- [ ] **Option C:** Your server → Upload to `/downloads/evia`
- [ ] **Option D:** GitHub Releases only (users download separately)

---

## 📧 User Communication

### Prepare Email
- [ ] Copy email template from DEPLOYMENT-GUIDE.md
- [ ] Fill in download link
- [ ] Test all links work
- [ ] Proofread for typos

### Send Test Email
- [ ] Send to yourself first
- [ ] Download from link
- [ ] Verify all files present
- [ ] Test installation on fresh Mac (if possible)

### Send to Users
- [ ] Email list prepared
- [ ] BCC all users (or use mail merge)
- [ ] Send email
- [ ] Monitor for replies/issues

---

## 🧪 Post-Release Testing

### Day 1: Immediate Testing
- [ ] Check GitHub Actions ran successfully
- [ ] Download release files yourself
- [ ] Test installation on clean Mac
- [ ] Monitor for user feedback/issues
- [ ] Check support email inbox

### Day 2-3: Early Feedback
- [ ] Follow up with early adopters
- [ ] Address any reported issues
- [ ] Update FAQ if new questions arise
- [ ] Monitor backend logs for errors

### Week 1: Metrics Review
- [ ] How many users downloaded?
- [ ] How many completed first session?
- [ ] Any critical bugs reported?
- [ ] Support request volume?
- [ ] User satisfaction feedback?

---

## 🐛 Emergency Rollback Plan

If critical bug discovered after release:

### Step 1: Assess Severity
- **P0 - Critical:** App crashes, data loss, security issue → Immediate action
- **P1 - High:** Feature broken, annoying bug → Fix within 24h
- **P2 - Medium:** Minor issue → Fix in next release

### Step 2: For P0 Issues
```bash
# Delete the problematic release
gh release delete v1.0.0

# Or mark as pre-release
gh release edit v1.0.0 --prerelease

# Notify users immediately
# Email: "We've identified an issue with v1.0.0. Please do not install yet. Fix coming soon."
```

### Step 3: Deploy Hotfix
```bash
# Fix the bug
# Test thoroughly
# Create v1.0.1 hotfix release
npm version 1.0.1
git tag -a v1.0.1 -m "Hotfix: [describe fix]"
git push origin v1.0.1

# Notify users of fix
```

---

## 📊 Success Metrics

Track these post-release:

### Adoption Metrics
- [ ] Total downloads (from GitHub Releases)
- [ ] Successful installations (check backend logs)
- [ ] Daily active users (check backend analytics)

### Engagement Metrics
- [ ] Average sessions per user per day
- [ ] Average session duration
- [ ] Ask feature usage rate
- [ ] Activity page visit rate

### Quality Metrics
- [ ] Support tickets opened
- [ ] Bug reports filed
- [ ] Crash reports
- [ ] User satisfaction score (if surveyed)

### Performance Metrics
- [ ] Backend response times (TTFT, TTR)
- [ ] Summary generation success rate
- [ ] Transcript accuracy (qualitative)
- [ ] App performance (CPU, memory)

---

## ✅ Final Sign-Off

Before sending to users, confirm ALL items checked:

### Core Functionality
- [x] Session isolation working (CRITICAL)
- [x] Summary generation working
- [x] Q&A storage working
- [x] Presets integration working
- [x] Login working
- [x] Permissions flow working

### User Experience
- [ ] Demo video recorded
- [ ] Documentation complete
- [ ] Package uploaded
- [ ] Download link tested
- [ ] Email prepared

### Technical
- [ ] GitHub Release created
- [ ] .dmg files available
- [ ] Version number updated
- [ ] Git tagged

### Compliance
- [ ] No sensitive data in logs
- [ ] No hardcoded credentials
- [ ] Privacy policy accessible
- [ ] Terms of service accessible

---

## 🎉 Launch!

**Ready?**

- [ ] All checkboxes above are checked ✅
- [ ] You've tested as a new user ✅
- [ ] Demo video is recorded ✅
- [ ] Package is uploaded ✅
- [ ] Email is ready to send ✅

**Then GO!** 🚀

```bash
# Send the email to users
# Post announcement (if applicable)
# Monitor support channels
# Celebrate! 🎉
```

---

**Good luck with your launch!** 💪

*Last updated: 2025-10-29*

