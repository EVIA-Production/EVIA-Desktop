import React from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';

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
    console.log('[WelcomeHeader] 🔐 Opening browser for login...');
    
    // Get backend URL from environment or default to localhost
    const frontendUrl = process.env.EVIA_FRONTEND_URL || 'http://localhost:5173';
    const loginUrl = `${frontendUrl}/login?source=desktop`;
    
    console.log('[WelcomeHeader] 🌐 Login URL:', loginUrl);
    
    try {
      // Use shell API to open in external browser
      if ((window as any).evia?.shell?.openExternal) {
        await (window as any).evia.shell.openExternal(loginUrl);
        console.log('[WelcomeHeader] ✅ Browser opened successfully');
      } else {
        console.error('[WelcomeHeader] ❌ Shell API not available');
        // Fallback: Try window.open (may be blocked by browser)
        window.open(loginUrl, '_blank');
      }
    } catch (err) {
      console.error('[WelcomeHeader] ❌ Failed to open browser:', err);
    }
  };

  /**
   * Placeholder for API key flow (deferred for MVP)
   */
  const handleApiKey = () => {
    console.log('[WelcomeHeader] API key option clicked (not implemented yet)');
  };

  /**
   * Opens privacy policy
   */
  const handlePrivacyPolicy = async () => {
    console.log('[WelcomeHeader] Opening privacy policy...');
    try {
      if ((window as any).evia?.shell?.openExternal) {
        await (window as any).evia.shell.openExternal('https://evia.work/privacy');
      }
    } catch (err) {
      console.error('[WelcomeHeader] ❌ Failed to open privacy policy:', err);
    }
  };

  /**
   * Quits the application
   */
  const handleQuit = async () => {
    console.log('[WelcomeHeader] 🚪 Quit button clicked');
    
    try {
      if ((window as any).evia?.app?.quit) {
        await (window as any).evia.app.quit();
      } else {
        console.error('[WelcomeHeader] ❌ App quit API not available');
      }
    } catch (err) {
      console.error('[WelcomeHeader] ❌ Failed to quit:', err);
    }
  };

  return (
    <div className="welcome-container">
      {/* Close button (quits app) */}
      <button 
        className="close-button" 
        onClick={handleQuit}
        aria-label="Quit EVIA"
      >
        ×
      </button>
      
      {/* Header Section */}
      <div className="header-section">
        <div className="title">Welcome to EVIA</div>
        <div className="subtitle">Choose how to connect your AI model</div>
      </div>

      {/* Option Card 1: Quick start with default API key */}
      <div className="option-card">
        <div className="divider"></div>
        <div className="option-content">
          <div className="option-title">Quick start with default API key</div>
          <div className="option-description">
            100% free with EVIA's OpenAI key<br />
            Your data stays on your device<br />
            Sign up with Google in seconds
          </div>
        </div>
        <button 
          className="action-button" 
          onClick={handleLogin}
          aria-label="Open browser to log in"
        >
          <div className="button-text">Open Browser to Log in</div>
          <div className="button-icon">
            <div className="arrow-icon"></div>
          </div>
        </button>
      </div>

      {/* Option Card 2: Use Personal API keys */}
      <div className="option-card">
        <div className="divider"></div>
        <div className="option-content">
          <div className="option-title">Use Personal API keys</div>
          <div className="option-description">
            Costs may apply based on your API usage<br />
            No personal data collected<br />
            Use your own API keys (OpenAI, Gemini, etc.)
          </div>
        </div>
        <button 
          className="action-button" 
          onClick={handleApiKey}
          aria-label="Enter your API key"
        >
          <div className="button-text">Enter Your API Key</div>
          <div className="button-icon">
            <div className="arrow-icon"></div>
          </div>
        </button>
      </div>

      {/* Footer */}
      <div className="footer">
        EVIA keeps your personal data private —{' '}
        <span 
          className="footer-link" 
          onClick={handlePrivacyPolicy}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handlePrivacyPolicy();
            }
          }}
        >
          See details
        </span>
      </div>

      {/* Styling - Exact match to Glass */}
      <style>{`
        .welcome-container {
          -webkit-app-region: drag;
          width: 100%;
          box-sizing: border-box;
          height: auto;
          padding: 24px 16px;
          background: rgba(0, 0, 0, 0.64);
          box-shadow: 0px 0px 0px 1.5px rgba(255, 255, 255, 0.64) inset;
          border-radius: 16px;
          flex-direction: column;
          justify-content: flex-start;
          align-items: flex-start;
          gap: 32px;
          display: inline-flex;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          cursor: default;
          user-select: none;
          position: relative;
        }

        .close-button {
          -webkit-app-region: no-drag;
          position: absolute;
          top: 16px;
          right: 16px;
          width: 20px;
          height: 20px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          border-radius: 5px;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
          z-index: 10;
          font-size: 16px;
          line-height: 1;
          padding: 0;
        }

        .close-button:hover {
          background: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.9);
        }

        .header-section {
          flex-direction: column;
          justify-content: flex-start;
          align-items: flex-start;
          gap: 4px;
          display: flex;
        }

        .title {
          color: white;
          font-size: 18px;
          font-weight: 700;
        }

        .subtitle {
          color: white;
          font-size: 14px;
          font-weight: 500;
        }

        .option-card {
          width: 100%;
          justify-content: flex-start;
          align-items: flex-start;
          gap: 8px;
          display: inline-flex;
        }

        .divider {
          width: 1px;
          align-self: stretch;
          position: relative;
          background: #bebebe;
          border-radius: 2px;
        }

        .option-content {
          flex: 1 1 0;
          flex-direction: column;
          justify-content: flex-start;
          align-items: flex-start;
          gap: 8px;
          display: inline-flex;
          min-width: 0;
        }

        .option-title {
          color: white;
          font-size: 14px;
          font-weight: 700;
        }

        .option-description {
          color: #dcdcdc;
          font-size: 12px;
          font-weight: 400;
          line-height: 18px;
          letter-spacing: 0.12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .action-button {
          -webkit-app-region: no-drag;
          padding: 8px 10px;
          background: rgba(132.6, 132.6, 132.6, 0.8);
          box-shadow: 0px 2px 2px rgba(0, 0, 0, 0.16);
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.5);
          justify-content: center;
          align-items: center;
          gap: 6px;
          display: flex;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .action-button:hover {
          background: rgba(150, 150, 150, 0.9);
        }

        .button-text {
          color: white;
          font-size: 12px;
          font-weight: 600;
        }

        .button-icon {
          width: 12px;
          height: 12px;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .arrow-icon {
          border: solid white;
          border-width: 0 1.2px 1.2px 0;
          display: inline-block;
          padding: 3px;
          transform: rotate(-45deg);
          -webkit-transform: rotate(-45deg);
        }

        .footer {
          align-self: stretch;
          text-align: center;
          color: #dcdcdc;
          font-size: 12px;
          font-weight: 500;
          line-height: 19.2px;
        }

        .footer-link {
          text-decoration: underline;
          cursor: pointer;
          -webkit-app-region: no-drag;
        }
      `}</style>
    </div>
  );
};

export default WelcomeHeader;

