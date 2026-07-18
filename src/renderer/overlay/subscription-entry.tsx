/**
 * Subscription Window Entry Point
 * 
 * Renders the SubscriptionRequired component which shows when user is 
 * authenticated but doesn't have an active subscription.
 * 
 * Part of Stripe Integration - Agent 3: Desktop App Subscription Gating
 * 
 * Flow:
 * 1. App launches → HeaderController checks for token
 * 2. Token found → Check subscription status
 * 3. No active subscription → Shows this Subscription window
 * 4. User subscribes → Clicks refresh → HeaderController transitions to permissions/ready
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import SubscriptionRequired from './SubscriptionRequired';
import '../overlay/overlay-glass.css';
import '../overlay/liquid-glass.css';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.material = params.get('material') || 'custom';
document.documentElement.dataset.surface = params.get('surface') || 'modal';
document.documentElement.dataset.windowActive = document.hasFocus() ? 'true' : 'false';
window.addEventListener('focus', () => {
  document.documentElement.dataset.windowActive = 'true';
});
window.addEventListener('blur', () => {
  document.documentElement.dataset.windowActive = 'false';
});

console.log('[SubscriptionEntry] 🔍 Subscription entry point executing');
console.log('[SubscriptionEntry] 🔍 URL:', window.location.href);

const rootEl = document.getElementById('subscription-root');

if (rootEl) {
  console.log('[SubscriptionEntry] ✅ Root element found, rendering SubscriptionRequired');
  const root = ReactDOM.createRoot(rootEl);
  root.render(<SubscriptionRequired />);
} else {
  console.error('[SubscriptionEntry] ❌ Root element #subscription-root not found');
}
