// Small helper to request system (display) audio and microphone streams
// Exported as a JS/TS helper (placed in .tsx so it can include optional UI later)
import React from 'react';
import './overlay-glass.css';
import { createRoot, Root } from 'react-dom/client';

type ModalChoice = 'start' | 'cancel';

const ScreenPickerModal: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
  return (
    <div className="picker-overlay">
      <div className="picker-modal">
        <div className="picker-title">Share system audio and microphone</div>
        <div className="picker-desc">Evia needs permission to capture your system audio (for desktop sounds) and your microphone. The next dialogs will ask for these permissions.</div>
        <div className="picker-actions">
          <button onClick={onCancel} className="picker-btn">Cancel</button>
          <button onClick={onConfirm} className="picker-btn start">Start</button>
        </div>
      </div>
    </div>
  );
};

function showReactModal(): Promise<ModalChoice> {
  return new Promise(resolve => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const cleanup = () => {
      try {
        root.unmount();
      } catch (e) {
        /* ignore */
      }
      if (container.parentNode) container.parentNode.removeChild(container);
    };

    const handleConfirm = () => {
      cleanup();
      resolve('start');
    };
    const handleCancel = () => {
      cleanup();
      resolve('cancel');
    };

    root.render(<ScreenPickerModal onConfirm={handleConfirm} onCancel={handleCancel} />);
  });
}

export async function pickScreenAndMic(): Promise<{
  systemStream?: MediaStream;
  micStream?: MediaStream;
}> {
  const result: { systemStream?: MediaStream; micStream?: MediaStream } = {};

  // Detect platform
  const isWindows = Boolean((window as any)?.platformInfo?.isWindows) || /windows/i.test(navigator.userAgent);

  // Show a transient glass-style modal to match Glass parity before requesting permissions
  try {
    const choice = await showReactModal();
    if (choice !== 'start') {
      console.log('[ScreenPicker] User cancelled modal before requesting permissions');
      throw new Error('user_cancelled');
    }
  } catch (err) {
    console.warn('[ScreenPicker] Modal interrupted:', err);
    throw err;
  }

  // On Windows, skip Chromium loopback completely (WASAPI binary will be used instead)
  if (!isWindows) {
    // Try to capture system audio via getDisplayMedia first (mac/Linux Chromium path only)
    try {
      console.log('[ScreenPicker] Requesting display (system) audio via getDisplayMedia');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore allow getDisplayMedia to exist on navigator
      const displayStream = await (navigator.mediaDevices as any).getDisplayMedia({ audio: true, video: false });
      if (displayStream && displayStream.getAudioTracks && displayStream.getAudioTracks().length > 0) {
        console.log('[ScreenPicker] Received display stream with audio tracks:', displayStream.getAudioTracks().map((t: MediaStreamTrack) => t.label));
        result.systemStream = displayStream as MediaStream;
      } else {
        console.warn('[ScreenPicker] Display stream had no audio tracks (user may have declined system audio)');
        // If no audio tracks, stop any tracks that may exist
        if (displayStream && displayStream.getTracks) {
          displayStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        }
      }
    } catch (err) {
      console.warn('[ScreenPicker] getDisplayMedia failed or was cancelled:', err);
    }
  } else {
    console.log('[ScreenPicker] 🪟 Windows detected — skipping getDisplayMedia for system audio');
  }

  // Then request microphone explicitly with recommended constraints (no builtin echo/noise AGC)
  try {
    console.log('[ScreenPicker] Requesting microphone via getUserMedia (24k mono, EC/NS/AGC off)');
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 24000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    if (micStream && micStream.getAudioTracks().length > 0) {
      console.log('[ScreenPicker] Received mic stream:', micStream.getAudioTracks().map((t: MediaStreamTrack) => t.label));
      result.micStream = micStream;
    } else {
      console.warn('[ScreenPicker] Microphone stream had no audio tracks');
      if (micStream && micStream.getTracks) micStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    }
  } catch (err) {
    console.error('[ScreenPicker] getUserMedia (mic) failed:', err);
    // propagate failure by rethrowing so callers can show UI / fallback
    throw err;
  }

  return result;
}
