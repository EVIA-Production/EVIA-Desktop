/**
 * SubscriptionRequired Component
 * 
 * Displayed when user is logged in but doesn't have an active subscription.
 * Prompts them to complete checkout in browser.
 * 
 * Part of Stripe Integration - Agent 3: Desktop App Subscription Gating
 * 
 * Flow:
 * 1. User authenticates successfully
 * 2. HeaderController checks subscription status
 * 3. No active subscription → Shows this window
 * 4. User clicks "Subscribe Now" → Opens browser to checkout
 * 5. After subscribing, user clicks "Refresh" → Rechecks subscription
 * 6. If subscription active → HeaderController transitions to permissions/ready
 */

import React, { useEffect, useRef } from 'react';
import './overlay-glass.css';
import { FRONTEND_URL } from '../config/config';

const SubscriptionRequired: React.FC = () => {
  const isMac = (window as any).platformInfo?.isMac || false;
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measureAndResize = async () => {
      const el = rootRef.current || document.querySelector('.subscription-required-container');
      if (!el) return;

      // Give layout a moment to settle
      await new Promise((r) => setTimeout(r, 100));

      const rect = el.getBoundingClientRect();
      const contentWidth = Math.ceil(rect.width);
      const contentHeight = Math.ceil(rect.height) + 2; // account for glass border

      console.log('[SubscriptionRequired] Content measured:', contentWidth, 'x', contentHeight);

      try {
        if ((window as any).evia?.windows?.resizeHeader) {
          await (window as any).evia.windows.resizeHeader(contentWidth, contentHeight);
          console.log('[SubscriptionRequired] Requested resize via evia.windows.resizeHeader');
        } else {
          const ipc = (window as any).electron?.ipcRenderer;
          if (ipc && typeof ipc.invoke === 'function') {
            await ipc.invoke('win:resizeHeader', contentWidth, contentHeight);
            console.log('[SubscriptionRequired] Requested resize via ipc fallback');
          }
        }
      } catch (err) {
        console.warn('[SubscriptionRequired] resize request failed:', err);
      }
    };

    measureAndResize();
  }, []);

  /**
   * Opens browser to checkout page and closes this window
   */
  const handleSubscribe = async () => {
    console.log('[SubscriptionRequired] 💳 Opening browser for checkout...');
    
    // Direct to checkout with desktop source param
    const checkoutUrl = `${FRONTEND_URL}/checkout?source=desktop`;
    
    console.log('[SubscriptionRequired] 🌐 Checkout URL:', checkoutUrl);
    
    try {
      if ((window as any).evia?.shell?.openExternal) {
        await (window as any).evia.shell.openExternal(checkoutUrl);
        console.log('[SubscriptionRequired] ✅ Browser opened to checkout');
        
        // Close this window after opening browser
        console.log('[SubscriptionRequired] 🔒 Closing subscription window');
        window.close();
      } else {
        console.error('[SubscriptionRequired] ❌ Shell API not available');
        window.open(checkoutUrl, '_blank');
      }
    } catch (err) {
      console.error('[SubscriptionRequired] ❌ Failed to open browser:', err);
    }
  };

  /**
   * Refresh subscription status (in case user just subscribed)
   */
  const handleRefresh = async () => {
    console.log('[SubscriptionRequired] 🔄 Refreshing subscription status...');
    
    try {
      if ((window as any).evia?.subscription?.refresh) {
        const result = await (window as any).evia.subscription.refresh();
        console.log('[SubscriptionRequired] 🔄 Refresh result:', result);
        // HeaderController will handle state transition if subscription is now active
      } else {
        console.error('[SubscriptionRequired] ❌ Subscription refresh API not available');
      }
    } catch (err) {
      console.error('[SubscriptionRequired] ❌ Failed to refresh:', err);
    }
  };

  /**
   * Logs out and returns to welcome screen
   */
  const handleLogout = async () => {
    console.log('[SubscriptionRequired] 🚪 Logging out...');
    
    try {
      if ((window as any).evia?.auth?.logout) {
        await (window as any).evia.auth.logout();
        console.log('[SubscriptionRequired] ✅ Logged out');
      } else {
        console.error('[SubscriptionRequired] ❌ Auth logout API not available');
      }
    } catch (err) {
      console.error('[SubscriptionRequired] ❌ Failed to logout:', err);
    }
  };

  /**
   * Quits the application
   */
  const handleQuit = async () => {
    console.log('[SubscriptionRequired] 🚪 Quit button clicked');
    
    try {
      if ((window as any).evia?.app?.quit) {
        if (isMac) {
          await (window as any).evia.app.quit();
        } else {
          window.close();
        }
      } else {
        console.error('[SubscriptionRequired] ❌ App quit API not available');
      }
    } catch (err) {
      console.error('[SubscriptionRequired] ❌ Failed to quit:', err);
    }
  };

  return (
    <div className="subscription-required-container" ref={rootRef}>
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
        <div className="subtitle">Your AI-powered sales coach</div>
      </div>

      {/* Main CTA Button */}
      <button 
        className="action-button action-button-primary action-button-absolute" 
        onClick={handleSubscribe}
        aria-label="Start Free Trial"
      >
        <div className="button-text">Start Free Trial</div>
        <div className="button-icon">
          <div className="arrow-icon"></div>
        </div>
      </button>

      {/* Info Card */}
      <div className="option-card">
        <div className="divider"></div>
        <div className="option-content">
          <div className="option-title">Get Started</div>
          <div className="option-description">
            Know what the best would say, in real-time<br />
            7 days free, then $49/month<br />
            Cancel anytime
          </div>
        </div>
      </div>

      {/* Secondary Actions */}
      <div className="secondary-actions">
        <button 
          className="text-button"
          onClick={handleRefresh}
        >
          Already subscribed? Refresh
        </button>
        <span className="separator">•</span>
        <button 
          className="text-button"
          onClick={handleLogout}
        >
          Log out
        </button>
      </div>
    </div>
  );
};

export default SubscriptionRequired;

