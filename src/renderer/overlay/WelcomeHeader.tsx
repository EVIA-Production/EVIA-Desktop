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
      {/* Close button (actually quits app) */}
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
        <div className="subtitle">Your AI-powered meeting assistant</div>
      </div>

      {/* Login Option Card */}
      <div className="option-card">
        <div className="divider"></div>
        <div className="option-content">
          <div className="option-title">Get Started</div>
          <div className="option-description">
            Log in to access your EVIA account<br />
            Your conversations are securely stored<br />
            Access insights and meeting notes
          </div>
        </div>
        <button 
          className="action-button" 
          onClick={handleLogin}
          aria-label="Open browser to log in"
        >
          <div className="button-text">Open Browser to Log In</div>
          <div className="button-icon">
            <div className="arrow-icon">→</div>
          </div>
        </button>
      </div>

      {/* Footer */}
      <div className="footer">
        EVIA keeps your data private — 
        <span 
          className="footer-link" 
          onClick={() => {
            if ((window as any).evia?.shell?.openExternal) {
              (window as any).evia.shell.openExternal('https://evia.work/privacy');
            }
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if ((window as any).evia?.shell?.openExternal) {
                (window as any).evia.shell.openExternal('https://evia.work/privacy');
              }
            }
          }}
        >
          Learn more about privacy
        </span>
      </div>

      {/* Styling specific to WelcomeHeader */}
      <style>{`
        .welcome-container {
          -webkit-app-region: drag;
          width: 400px;
          padding: 18px 20px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 16px;
          overflow: hidden;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          cursor: default;
          user-select: none;
        }

        /* Glass effect border */
        .welcome-container::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 16px;
          padding: 1px;
          background: linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: destination-out;
          mask-composite: exclude;
          pointer-events: none;
        }

        .close-button {
          -webkit-app-region: no-drag;
          position: absolute;
          top: 10px;
          right: 10px;
          width: 14px;
          height: 14px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          border-radius: 3px;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
          z-index: 10;
          font-size: 14px;
          line-height: 1;
          padding: 0;
        }

        .close-button:hover {
          background: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.9);
        }

        .close-button:active {
          transform: scale(0.95);
        }

        .header-section {
          text-align: center;
          margin-bottom: 20px;
          width: 100%;
        }

        .title {
          color: white;
          font-size: 20px;
          font-weight: 600;
          margin-bottom: 6px;
        }

        .subtitle {
          color: rgba(255, 255, 255, 0.7);
          font-size: 12px;
          font-weight: 400;
        }

        .option-card {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          padding: 16px;
          margin-bottom: 16px;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .divider {
          height: 1px;
          background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.2) 50%, transparent 100%);
          margin-bottom: 4px;
        }

        .option-content {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .option-title {
          color: white;
          font-size: 14px;
          font-weight: 500;
        }

        .option-description {
          color: rgba(255, 255, 255, 0.6);
          font-size: 11px;
          line-height: 1.4;
        }

        .action-button {
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(0, 122, 255, 0.15);
          border: 1px solid rgba(0, 122, 255, 0.3);
          border-radius: 8px;
          padding: 10px 14px;
          color: rgba(0, 122, 255, 0.9);
          cursor: pointer;
          transition: all 0.2s ease;
          width: 100%;
        }

        .action-button:hover {
          background: rgba(0, 122, 255, 0.25);
          border-color: rgba(0, 122, 255, 0.5);
          transform: translateY(-1px);
        }

        .action-button:active {
          transform: translateY(0);
        }

        .button-text {
          font-size: 13px;
          font-weight: 500;
        }

        .button-icon {
          display: flex;
          align-items: center;
        }

        .arrow-icon {
          font-size: 16px;
          transition: transform 0.2s ease;
        }

        .action-button:hover .arrow-icon {
          transform: translateX(2px);
        }

        .footer {
          color: rgba(255, 255, 255, 0.5);
          font-size: 10px;
          text-align: center;
          line-height: 1.4;
        }

        .footer-link {
          color: rgba(0, 122, 255, 0.8);
          text-decoration: underline;
          cursor: pointer;
          transition: color 0.15s ease;
        }

        .footer-link:hover {
          color: rgba(0, 122, 255, 1);
        }
      `}</style>
    </div>
  );
};

export default WelcomeHeader;

