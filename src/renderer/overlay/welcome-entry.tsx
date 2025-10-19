/**
 * Welcome Window Entry Point
 *
 * Renders the WelcomeHeader component which shows when user is not logged in.
 * This is a simple entry point that doesn't need language toggle or complex state.
 *
 * Flow:
 * 1. App launches → HeaderController checks for token
 * 2. No token found → Shows this Welcome window
 * 3. User clicks "Login" → Opens browser to Frontend
 * 4. After login → Frontend redirects to evia://auth-callback?token=...
 * 5. Token stored → HeaderController transitions to permission window
 */

import React from "react";
import ReactDOM from "react-dom/client";
import WelcomeHeader from "./WelcomeHeader";
import "../overlay/static/overlay-glass.css";

console.log("[WelcomeEntry] 🔍 Welcome entry point executing");
console.log("[WelcomeEntry] 🔍 URL:", window.location.href);

const rootEl = document.getElementById("welcome-root");

if (rootEl) {
  console.log("[WelcomeEntry] ✅ Root element found, rendering WelcomeHeader");
  const root = ReactDOM.createRoot(rootEl);
  root.render(<WelcomeHeader />);
} else {
  console.error("[WelcomeEntry] ❌ Root element #welcome-root not found");
}
