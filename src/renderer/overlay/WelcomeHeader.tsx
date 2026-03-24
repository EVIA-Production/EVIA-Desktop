import React, { useEffect, useRef } from 'react';
import './overlay-glass.css';

const WEB_APP_URL = 'https://app.taylos.ai';

/**
 * WelcomeHeader Component
 *
 * Displayed when user is not logged in.
 * Shows welcome message and login button that opens browser to Frontend.
 *
 * Flow:
 * 1. User sees this window on first launch (no token in keytar)
 * 2. Clicks "Get Started"
 * 3. Browser opens to Taylos frontend with ?source=desktop
 * 4. After successful login, Frontend redirects to taylos://auth-callback?token=...
 * 5. This window closes and the app continues the onboarding flow
 */
const WelcomeHeader: React.FC = () => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measureAndResize = async () => {
      const el = rootRef.current || document.querySelector('.welcome-container');
      if (!el) return;

      await new Promise((r) => setTimeout(r, 100));

      const rect = el.getBoundingClientRect();
      const contentWidth = Math.ceil(rect.width);
      const contentHeight = Math.ceil(rect.height) + 2;

      console.log('[WelcomeHeader] Content measured:', contentWidth, 'x', contentHeight);

      try {
        if ((window as any).evia?.windows?.resizeHeader) {
          await (window as any).evia.windows.resizeHeader(contentWidth, contentHeight);
          console.log('[WelcomeHeader] Requested resize via evia.windows.resizeHeader');
        } else {
          const ipc = (window as any).electron?.ipcRenderer;
          if (ipc && typeof ipc.invoke === 'function') {
            await ipc.invoke('win:resizeHeader', contentWidth, contentHeight);
            console.log('[WelcomeHeader] Requested resize via ipc fallback');
          } else {
            console.warn('[WelcomeHeader] No IPC method available to request resize');
          }
        }
      } catch (err) {
        console.warn('[WelcomeHeader] Resize request failed:', err);
      }
    };

    measureAndResize();
    return () => {};
  }, []);

  const handleLogin = async () => {
    console.log('[WelcomeHeader] Opening browser for registration...');

    const loginUrl = `${WEB_APP_URL}/register?source=desktop`;

    console.log('[WelcomeHeader] Login URL:', loginUrl);
    console.log('[WelcomeHeader] Checking evia bridge:', (window as any).evia);

    try {
      if ((window as any).evia?.shell?.openExternal) {
        console.log('[WelcomeHeader] Shell API available, opening browser...');
        await (window as any).evia.shell.openExternal(loginUrl);
        console.log('[WelcomeHeader] Browser opened successfully');
        console.log('[WelcomeHeader] Closing welcome window while browser login is in progress');
        window.close();
      } else {
        console.error('[WelcomeHeader] Shell API not available:', (window as any).evia);
        window.open(loginUrl, '_blank');
        window.close();
      }
    } catch (err) {
      console.error('[WelcomeHeader] Failed to open browser:', err);
    }
  };

  const handlePrivacyPolicy = async () => {
    console.log('[WelcomeHeader] Opening privacy policy...');
    try {
      if ((window as any).evia?.shell?.openExternal) {
        await (window as any).evia.shell.openExternal('https://taylos.ai/data-privacy');
      }
    } catch (err) {
      console.error('[WelcomeHeader] Failed to open privacy policy:', err);
    }
  };

  const handleQuit = async () => {
    console.log('[WelcomeHeader] Quit button clicked');

    try {
      if ((window as any).evia?.app?.quit) {
        if ((window as any).platformInfo?.isMac) {
          await (window as any).evia.app.quit();
        } else {
          window.close();
        }
      } else {
        console.error('[WelcomeHeader] App quit API not available');
      }
    } catch (err) {
      console.error('[WelcomeHeader] Failed to quit:', err);
    }
  };

  return (
    <div className="welcome-container" ref={rootRef}>
      <button
        className="close-button"
        onClick={handleQuit}
        aria-label="Quit Taylos"
      >
        &times;
      </button>

      <div className="header-section">
        <div className="title">Welcome to Taylos</div>
        <div className="subtitle">Your AI-powered meeting assistant</div>
      </div>

      <button
        className="action-button action-button-absolute"
        onClick={handleLogin}
        aria-label="Get Started"
      >
        <div className="button-text">Get Started</div>
        <div className="button-icon">
          <div className="arrow-icon"></div>
        </div>
      </button>

      <div className="option-card">
        <div className="divider"></div>
        <div className="option-content">
          <div className="option-title">Get Started</div>
          <div className="option-description">
            Log in to access your Taylos account
            <br />
            Your conversations are securely stored
            <br />
            Access insights and meeting notes
          </div>
        </div>
      </div>

      <div className="footer">
        Taylos keeps your personal data private -{' '}
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
    </div>
  );
};

export default WelcomeHeader;
