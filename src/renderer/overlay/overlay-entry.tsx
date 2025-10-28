import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom/client";
import EviaBar from "./EviaBar";
import ListenView from "./ListenView";
import AskView from "./AskView";
import SettingsView from "./SettingsView";
import ShortCutSettingsView from "./ShortCutSettingsView";
import { i18n } from "../i18n/i18n";
import { startCapture, stopCapture } from "../audio-processor-glass-parity";
import { BACKEND_URL } from "../config/config";
import {
  startWindowsCapture,
  stopWindowsCapture,
} from "../audio/windows/windows-audio-processor";
import ScreenPickerModal from "./ScreenPickerModal";
import "../overlay/static/overlay-glass.css";

const params = new URLSearchParams(window.location.search);
const view = (params.get("view") || "header").toLowerCase();
const rootEl = document.getElementById("overlay-root");

// 🔍 DIAGNOSTIC: Entry point execution
console.log("[OverlayEntry] 🔍 ENTRY POINT EXECUTING");
console.log("[OverlayEntry] 🔍 URL:", window.location.href);
console.log("[OverlayEntry] 🔍 Search params:", window.location.search);
console.log("[OverlayEntry] 🔍 View param:", view);
console.log("[OverlayEntry] 🔍 rootEl exists:", !!rootEl);

// Initialize language from localStorage or default to German
const savedLanguage = i18n.getLanguage();

// Language toggle function that broadcasts to all windows
const handleToggleLanguage = async (
  captureHandleRef: any,
  isCapturing: boolean,
  setIsCapturing: (val: boolean) => void
) => {
  const currentLang = i18n.getLanguage();
  const newLang = currentLang === "de" ? "en" : "de";

  console.log(
    "[OverlayEntry] 🌐 Language toggle started:",
    currentLang,
    "→",
    newLang
  );

  // 🔧 FIX: Stop audio capture first (close session)
  if (isCapturing && captureHandleRef.current) {
    console.log(
      "[OverlayEntry] 🛑 Stopping audio capture before language toggle..."
    );
    await stopCapture(captureHandleRef.current);
    captureHandleRef.current = null;
    setIsCapturing(false);

    // Notify Listen window to stop timer
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.send) {
      eviaIpc.send("transcript-message", { type: "recording_stopped" });
      console.log("[OverlayEntry] ✅ Sent recording_stopped message");
    }
  }

  // 🔧 FIX: Close all child windows except Settings
  const eviaWindows = (window as any).evia?.windows;
  if (eviaWindows) {
    console.log(
      "[OverlayEntry] Closing child windows (keeping Settings open)..."
    );
    await eviaWindows.hide("listen");
    await eviaWindows.hide("ask");
    // Keep Settings open - user is toggling from Settings window
  }

  // 🔧 SINGULARITY ANIMATION: Shrink header to point, then expand with new language
  const headerElement = document.querySelector(
    ".evia-main-header"
  ) as HTMLElement;
  if (headerElement) {
    console.log("[OverlayEntry] 🌀 Starting singularity animation...");

    // Phase 1: Compress to singularity (500ms)
    headerElement.style.transition =
      "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s ease";
    headerElement.style.transform = "scale(0.01)";
    headerElement.style.opacity = "0";

    // Wait for compression to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Update language (happens at singularity point)
    i18n.setLanguage(newLang);

    // 🔧 REACTIVE I18N: Broadcast to all windows
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.send("language-changed", newLang);
    }

    // Trigger local re-render
    window.dispatchEvent(
      new CustomEvent("evia-language-changed", {
        detail: { language: newLang },
      })
    );

    // Small delay for language to update in DOM
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Phase 2: Expand from singularity (500ms)
    headerElement.style.transform = "scale(1)";
    headerElement.style.opacity = "1";

    // Wait for expansion to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Reset transition for normal animations
    headerElement.style.transition = "";

    console.log(
      "[OverlayEntry] ✅ Singularity animation complete, language:",
      newLang
    );
  } else {
    // Fallback if header element not found
    i18n.setLanguage(newLang);
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.send("language-changed", newLang);
    }
    window.dispatchEvent(
      new CustomEvent("evia-language-changed", {
        detail: { language: newLang },
      })
    );
  }
};

function App() {
  const [language, setLanguage] = useState<"de" | "en">(
    savedLanguage as "de" | "en"
  );
  const [isCapturing, setIsCapturing] = useState(false);
  const captureHandleRef = useRef<any>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);

  // 🔧 REACTIVE I18N: Listen for language changes (local window event)
  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ language: "de" | "en" }>;
      const newLang = customEvent.detail.language;
      console.log("[OverlayEntry] 🌐 Language changed:", newLang);
      setLanguage(newLang);
    };
    window.addEventListener("evia-language-changed", handleLanguageChange);
    return () =>
      window.removeEventListener("evia-language-changed", handleLanguageChange);
  }, []);

  // 🔧 REACTIVE I18N: Listen for language changes from OTHER windows via IPC
  useEffect(() => {
    const eviaIpc = (window as any).evia?.ipc;
    if (!eviaIpc) {
      console.warn(
        "[OverlayEntry] IPC not available for cross-window language sync"
      );
      return;
    }

    const handleCrossWindowLanguageChange = (newLang: "de" | "en") => {
      console.log(
        "[OverlayEntry] 🌐 Language changed from other window:",
        newLang
      );
      i18n.setLanguage(newLang);
      setLanguage(newLang);
      // Trigger local event to update all components in THIS window
      window.dispatchEvent(
        new CustomEvent("evia-language-changed", {
          detail: { language: newLang },
        })
      );
    };

    eviaIpc.on("language-changed", handleCrossWindowLanguageChange);
    console.log("[OverlayEntry] ✅ Registered cross-window language listener");

    return () => {
      console.log("[OverlayEntry] 🧹 Cleaning up language listener");
    };
  }, []);

  const toggleLanguage = () => {
    handleToggleLanguage(captureHandleRef, isCapturing, setIsCapturing);
  };

  const handleToggleListening = async () => {
    try {
      if (!isCapturing) {
        // Start capture
        console.log("[OverlayEntry] Starting audio capture...");

        // 🔧 Get auth token from keytar (secure credential storage)
        console.log("[OverlayEntry] 🔍 Getting auth token from keytar...");
        const token = await (window as any).evia?.auth?.getToken?.();
        const backend =
          BACKEND_URL;

        if (!token) {
          console.error(
            "[OverlayEntry] ❌ No auth token found - user must login first"
          );
          console.error(
            '[OverlayEntry] Run this in DevTools: await window.evia.auth.login("admin", "your-password")'
          );
          return;
        }

        console.log(
          "[OverlayEntry] ✅ Got auth token (length:",
          token.length,
          "chars)"
        );

        // Import getOrCreateChatId dynamically to ensure chat exists
        const { getOrCreateChatId } = await import(
          "../services/websocketService"
        );
        const chatId = await getOrCreateChatId(backend, token);
        console.log("[OverlayEntry] Using chat_id:", chatId);

        // Start audio capture (mic + system audio for meeting transcription)
        console.log(
          "[OverlayEntry] Starting dual capture (mic + system audio)..."
        );
        const isWindows =
          !!(window as any).evia?.isWindows ||
          (window as any).evia?.platform === "win32";
        if (isWindows) {
          // Open custom picker; defer actual start until a source is chosen
          setPendingStart(true);
          setPickerOpen(true);
          return; // wait for user selection
        } else {
          const handle = await startCapture(true);
          captureHandleRef.current = handle;
        }
        setIsCapturing(true);
        console.log(
          "[OverlayEntry] Audio capture started successfully (mic + system)"
        );

        // 🔧 FIX: Notify Listen window to start timer
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send("transcript-message", { type: "recording_started" });
            console.log(
              "[OverlayEntry] Sent recording_started message to Listen window"
            );
          }
        } catch (error) {
          console.error(
            "[OverlayEntry] Failed to send recording_started:",
            error
          );
        }
      } else {
        // Stop capture
        console.log("[OverlayEntry] Stopping audio capture...");
        const isWindows =
          !!(window as any).evia?.isWindows ||
          (window as any).evia?.platform === "win32";
        if (isWindows) {
          await stopWindowsCapture();
        } else {
          await stopCapture(captureHandleRef.current);
        }
        captureHandleRef.current = null;
        setIsCapturing(false);
        console.log("[OverlayEntry] Audio capture stopped successfully");

        // 🔧 FIX: Notify Listen window to stop timer
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send("transcript-message", { type: "recording_stopped" });
            console.log(
              "[OverlayEntry] Sent recording_stopped message to Listen window"
            );
          }
        } catch (error) {
          console.error(
            "[OverlayEntry] Failed to send recording_stopped:",
            error
          );
        }
      }
    } catch (error) {
      console.error("[OverlayEntry] Error toggling audio capture:", error);
      // Reset state on error
      captureHandleRef.current = null;
      setIsCapturing(false);
    }
  };

  switch (view) {
    case "header":
      console.log("[OverlayEntry] 🔍 Rendering HEADER view");
      return (
        <>
          <EviaBar
            currentView={null}
            onViewChange={() => {}}
            isListening={isCapturing}
            onToggleListening={handleToggleListening}
            language={language}
            onToggleLanguage={toggleLanguage}
          />
          {pickerOpen && (
            <ScreenPickerModal
              backdrop={false}
              onSelect={async (sourceId: string) => {
                setPickerOpen(false);
                if (!pendingStart) return;
                try {
                  const handle = await startWindowsCapture(true, { sourceId });
                  captureHandleRef.current = handle;
                  setIsCapturing(true);
                } catch (e) {
                  console.error("[OverlayEntry] Windows start failed:", e);
                } finally {
                  setPendingStart(false);
                }
              }}
              onCancel={() => {
                setPickerOpen(false);
                setPendingStart(false);
              }}
            />
          )}
        </>
      );
    case "listen":
      console.log(
        "[OverlayEntry] 🔍 Rendering LISTEN view - about to create ListenView component"
      );
      console.log("[OverlayEntry] 🔍 ListenView imported:", typeof ListenView);
      return (
        <ListenView
          lines={[]}
          followLive={true}
          onToggleFollow={() => {}}
          onClose={() => (window as any).evia?.closeWindow?.("listen")}
        />
      );
    case "ask":
      return <AskView language={language} />;
    case "settings":
      return (
        <SettingsView language={language} onToggleLanguage={toggleLanguage} />
      );
    case "shortcuts":
      return <ShortCutSettingsView />;
    default:
      return (
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={false}
          onToggleListening={() => {}}
          language={language}
          onToggleLanguage={toggleLanguage}
        />
      );
  }
}

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}
