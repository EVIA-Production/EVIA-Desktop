# 🔐 Keychain Access Explained

**Date:** October 30, 2025  
**Topic:** Why EVIA needs macOS Keychain access  
**User Question:** "Why does EVIA need keychain access? Does every user have to permit this?"

---

## 🎯 Quick Answer

**Q: Why does EVIA need Keychain access?**  
**A:** To securely store your authentication token (login session)

**Q: Does every user have to permit this?**  
**A:** Yes, but only ONCE. After first permission, it's automatic.

**Q: Is it safe?**  
**A:** Yes! Keychain is Apple's secure password manager. It's the SAFEST way to store credentials on macOS.

---

## 🔍 What is macOS Keychain?

**Keychain** = Apple's built-in secure password & credential storage system

**Used by:**
- Safari (stores website passwords)
- Mail (stores email passwords)
- Slack, Teams, Discord (stores login tokens)
- **EVIA** (stores your auth token)

**Security:**
- ✅ Encrypted with your Mac's login password
- ✅ Protected by macOS system security
- ✅ Cannot be accessed by other apps
- ✅ Industry-standard secure storage

---

## 🔐 What EVIA Stores in Keychain

### 1. Authentication Token (`evia-auth-token`)

**What it is:**  
A secure token that proves you're logged in

**Why we need it:**  
- So you don't have to log in every time you open EVIA
- Backend API requires it for all requests
- Stays valid even after restarting your Mac

**Example value:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
(This is a JWT - JSON Web Token, industry standard)

**Stored as:**
- Service: `evia-auth-token`
- Account: Your user ID
- Access: Only EVIA app can read it

---

### 2. Backend URL (Optional, for advanced users)

**What it is:**  
The server URL EVIA connects to

**Default:**
```
https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io
```

**Why we store it:**  
For advanced users who might use custom backend instances (rare)

---

## 💡 Why Not Store in Files?

### ❌ Bad: Storing Token in a File

```
~/Library/Application Support/evia/token.txt
```

**Problems:**
- ❌ Any app can read it
- ❌ Malware can steal it
- ❌ Visible in backups (unencrypted)
- ❌ Can be accidentally shared
- ❌ Not industry best practice

### ✅ Good: Storing Token in Keychain

```
macOS Keychain → evia-auth-token → Encrypted
```

**Benefits:**
- ✅ Only EVIA can read it
- ✅ Encrypted automatically
- ✅ Protected by macOS security
- ✅ Industry best practice
- ✅ Used by all major apps (Slack, Teams, etc.)

---

## 🎬 What Happens on First Launch

### The Keychain Permission Prompt:

```
┌────────────────────────────────────────────────┐
│  "EVIA wants to access the keychain"          │
│                                                │
│  This allows EVIA to store your login         │
│  credentials securely.                        │
│                                                │
│  [Deny]  [Allow]  [Always Allow]              │
└────────────────────────────────────────────────┘
```

### User Choices:

1. **"Always Allow"** (Recommended ✅)
   - EVIA can read/write token automatically
   - No more prompts
   - Best user experience

2. **"Allow"** (OK, but annoying)
   - EVIA can read/write token THIS TIME
   - Will prompt again next time
   - Annoying for daily use

3. **"Deny"** (Breaks EVIA ❌)
   - EVIA cannot store auth token
   - Must log in every time you open EVIA
   - Very poor user experience

---

## 🔒 Security Details

### What Can EVIA Do With Keychain Access?

**EVIA can:**
- ✅ Read its OWN stored token (`evia-auth-token`)
- ✅ Write/update its OWN token
- ✅ Delete its OWN token (on logout)

**EVIA CANNOT:**
- ❌ Read other apps' passwords (Safari, Chrome, etc.)
- ❌ Read your email passwords
- ❌ Read other apps' tokens
- ❌ Access system passwords

**Keychain Isolation:**
Each app can only access its OWN keychain items!

---

### How Keychain Protects Your Token

```
┌─────────────────────────────────────────────────────┐
│                   macOS Keychain                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Service: "evia-auth-token"                         │
│  Access: com.evia.app ONLY                          │
│  Value: [ENCRYPTED with your Mac login password]   │
│                                                     │
│  ↓                                                  │
│  Other Apps CANNOT Read This                        │
│  Even with Full Disk Access!                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Encryption:**
- Token encrypted with AES-256
- Key derived from your Mac login password
- Cannot be decrypted without your Mac password

---

## 📋 Do Other Apps Use Keychain?

**YES! All major macOS apps use Keychain:**

| App | What They Store |
|-----|----------------|
| **Slack** | Login token, workspace credentials |
| **Microsoft Teams** | Microsoft account token |
| **Discord** | Discord auth token |
| **Zoom** | Meeting credentials, SSO tokens |
| **Dropbox** | OAuth tokens |
| **1Password** | Master password, sync credentials |
| **Chrome** | Website passwords |
| **Safari** | Website passwords, credit cards |
| **EVIA** | Authentication token ✅ |

**Using Keychain = Industry Standard!**

---

## 🛡️ Alternative: Not Using Keychain

### What Would Happen Without Keychain?

**Option 1: Store token in plaintext file**
- ❌ Insecure (any app can read)
- ❌ Not industry standard
- ❌ Fails security audits

**Option 2: Store in localStorage (browser-like)**
- ❌ Less secure than Keychain
- ❌ Electron doesn't encrypt localStorage
- ❌ Visible in app data directory

**Option 3: Don't store at all**
- ❌ User must log in EVERY TIME
- ❌ Terrible user experience
- ❌ No persistent sessions

**Conclusion:** Keychain is the BEST option!

---

## 🎯 What Happens on Logout?

When you log out or run `reset-to-new-user.sh`:

```bash
# This deletes the token from Keychain
security delete-generic-password -s "evia-auth-token"
```

**Result:**
- ✅ Token removed from Keychain
- ✅ User logged out
- ✅ Must log in again on next launch

---

## 🔍 How to Manually Check Keychain

**To see EVIA's keychain entry:**

1. Open **Keychain Access.app**
2. Select **"login"** keychain
3. Search for: `evia`
4. You'll see:
   - `evia-auth-token` (your login token)
   - `evia-backend-url` (if set)

**To view the token value:**
1. Double-click `evia-auth-token`
2. Click **"Show password"**
3. Enter your Mac password
4. See the encrypted token

**To delete manually:**
1. Right-click `evia-auth-token`
2. Click **"Delete"**
3. EVIA will ask you to log in again

---

## ❓ Common Questions

### Q: Is my token stored on EVIA's servers?

**A: NO!** The token is ONLY stored locally in your Mac's Keychain.

- ✅ Never sent to EVIA servers (except when logging in)
- ✅ Never leaves your Mac
- ✅ Encrypted on your Mac only

### Q: Can EVIA access my Mac password?

**A: NO!** EVIA does NOT know your Mac password.

- Keychain uses your Mac password to encrypt data
- EVIA never sees your Mac password
- macOS handles encryption/decryption internally

### Q: What if I deny Keychain access?

**A: EVIA will still work, but:**
- ❌ You'll need to log in EVERY TIME
- ❌ No persistent sessions
- ❌ Poor user experience

**Workaround:** Click "Always Allow" next time prompted

### Q: Can I revoke Keychain access later?

**A: Yes!**

1. Open **Keychain Access.app**
2. Find `evia-auth-token`
3. Double-click → **Access Control** tab
4. Remove "EVIA" from allowed apps
5. EVIA will prompt again next time

### Q: Do I need to grant this on every Mac?

**A: Yes, once per Mac.**

- Keychain is local to each Mac
- Not synced via iCloud (for security)
- Each Mac needs its own permission

---

## 📊 Comparison: Keychain vs Alternatives

| Storage Method | Security | UX | Industry Standard |
|---------------|----------|-----|------------------|
| **macOS Keychain** | ✅✅✅ Excellent | ✅✅✅ Great | ✅ Yes (Slack, Teams) |
| Plaintext File | ❌ Terrible | ✅✅ Good | ❌ No |
| localStorage | ⚠️ OK | ✅✅ Good | ⚠️ Web only |
| No Storage | ✅✅ Secure | ❌ Terrible | ❌ No |

**Winner:** Keychain! 🏆

---

## ✅ Summary

**Why EVIA needs Keychain access:**
- To securely store your authentication token
- So you stay logged in between sessions
- Industry best practice (used by Slack, Teams, etc.)

**Is it required?**
- Technically no, but HIGHLY recommended
- Without it, you log in every time (annoying!)

**Is it safe?**
- YES! Safest way to store credentials on macOS
- Encrypted with your Mac password
- Cannot be accessed by other apps
- Used by all major apps

**What you should do:**
- ✅ Click **"Always Allow"** when prompted
- ✅ This is normal and expected
- ✅ Every user will see this prompt ONCE
- ✅ After allowing, it's automatic

---

**Keychain access = Normal, safe, and recommended! ✅**

