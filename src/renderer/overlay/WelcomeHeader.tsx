/// <reference types="vite/client" />
import React from "react";
import "./overlay-tokens.css";
import "./overlay-glass.css";

/**
 * WelcomeHeader Component
 *
 * Displayed when user is not logged in.
 * Shows welcome message and login button that opens browser to Frontend.
 *
 * Flow:
 * 1. User sees this window on first launch (no token in keytar)
 * 2. Clicks "Open Browser to Log In" button
 * 3. Browser opens to EVIA-Frontend/login?source=desktop
 * 4. After successful login, Frontend redirects to evia://auth-callback?token=...
 * 5. This window closes, permission window opens
 *
 * Glass Reference: glass/src/ui/app/WelcomeHeader.js
 */

const WelcomeHeader: React.FC = () => {
  /**
   * Opens default browser to Frontend login page
   * Adds ?source=desktop param so Frontend knows to redirect back via evia://
   */
  const handleLogin = async () => {
    console.log("[WelcomeHeader] 🔐 Opening browser for login...");

    // FIXED: Use VITE env var (not process.env) in renderer
    const frontendUrl =
      import.meta.env.VITE_FRONTEND_URL || "http://localhost:5173";
    const loginUrl = `${frontendUrl}/login?source=desktop`;

    console.log("[WelcomeHeader] 🌐 Login URL:", loginUrl);
    console.log(
      "[WelcomeHeader] 🔍 Checking evia bridge:",
      (window as any).evia
    );

    try {
      // Use shell API to open in external browser
      if ((window as any).evia?.shell?.openExternal) {
        console.log(
          "[WelcomeHeader] ✅ Shell API available, opening browser..."
        );
        await (window as any).evia.shell.openExternal(loginUrl);
        console.log("[WelcomeHeader] ✅ Browser opened successfully");

        // Close welcome window immediately to avoid blocking browser view
        console.log("[WelcomeHeader] 🔒 Closing welcome window");
        window.close();
      } else {
        console.error(
          "[WelcomeHeader] ❌ Shell API not available:",
          (window as any).evia
        );
        // Fallback: Try window.open (may be blocked by browser)
        window.open(loginUrl, "_blank");
      }
    } catch (err) {
      console.error("[WelcomeHeader] ❌ Failed to open browser:", err);
    }
  };

  /**
   * Opens privacy policy
   */
  const handlePrivacyPolicy = async () => {
    console.log("[WelcomeHeader] Opening privacy policy...");
    try {
      if ((window as any).evia?.shell?.openExternal) {
        await (window as any).evia.shell.openExternal(
          "https://evia.work/privacy"
        );
      }
    } catch (err) {
      console.error("[WelcomeHeader] ❌ Failed to open privacy policy:", err);
    }
  };

  /**
   * Quits the application
   */
  const handleQuit = async () => {
    console.log("[WelcomeHeader] 🚪 Quit button clicked");

    try {
      if ((window as any).evia?.app?.quit) {
        await (window as any).evia.app.quit();
      } else {
        console.error("[WelcomeHeader] ❌ App quit API not available");
      }
    } catch (err) {
      console.error("[WelcomeHeader] ❌ Failed to quit:", err);
    }
  };

  return (
    <div className="welcome-container">
      {/* Close button (quits app) */}
      <button
        className="welcome-close-btn"
        onClick={handleQuit}
        aria-label="Quit EVIA"
      >
        ×
      </button>

      {/* Header Section */}
      <div className="welcome-header-section">
        <div className="welcome-title">Welcome to EVIA</div>
        <div className="welcome-subtitle">
          Your AI-powered meeting assistant
        </div>
      </div>

      {/* Login Option Card */}
      <div className="welcome-option-card">
        <div className="welcome-divider"></div>
        <div className="welcome-option-content">
          <div className="welcome-option-title">Get Started</div>
          <div className="welcome-option-description">
            Log in to access your EVIA account
            <br />
            Your conversations are securely stored
            <br />
            Access insights and meeting notes
          </div>
        </div>
        <button
          className="welcome-action-button"
          onClick={handleLogin}
          aria-label="Open browser to log in"
        >
          <div className="welcome-button-text">Open Browser to Log in</div>
          <div className="welcome-button-icon">
            <div className="welcome-arrow-icon"></div>
          </div>
        </button>
      </div>

      {/* Footer with Privacy Policy */}
      <div className="welcome-footer">
        EVIA keeps your personal data private —{" "}
        <span
          className="welcome-footer-link"
          onClick={handlePrivacyPolicy}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handlePrivacyPolicy();
            }
          }}
        >
          See details
        </span>
      </div>
    </div>
  );
};

export default WelcomeHeader;
