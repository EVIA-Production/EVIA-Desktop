// Audio diagnostics script

import {
  initDebugCanvas,
  visualizeWaveform,
  calculateRMS,
  startLiveVisualization,
  startSystemVisualization,
  stopLiveVisualization,
  createSpectrogram,
  generateDiagnosticsReport
} from './debug-utils.js';

import {
  SAMPLE_RATE,
  AUDIO_CHUNK_DURATION,
  SAMPLES_PER_CHUNK,
  initAudioProcessing,
  processSystemAudio,
  convertFloat32ToInt16,
  base64ToFloat32Array,
  exportBufferToWav,
  pcmBuffers
} from './audio-processing.js';

// Global state
const state = {
  micStream: null,
  systemAudioEnabled: false,
  micEnabled: false,
  micRMS: 0,
  systemRMS: 0,
  micBufferSize: 0,
  systemBufferSize: 0,
  micSampleRate: 0,
  systemSampleRate: 0,
  micWsConnected: false,
  systemWsConnected: false,
  micDgOpen: false,
  systemDgOpen: false,
  logs: []
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await initAudioProcessing();
  setupTabs();
  setupButtons();
  setupVisualizers();
  updateMetrics();
  
  // Update metrics periodically
  setInterval(updateMetrics, 1000);
  
  // Register system audio handlers
  if (window.evia && window.evia.systemAudio) {
    window.evia.systemAudio.onStatus((line) => {
      try {
        const status = JSON.parse(line);
        log(`[system] ${status.status}: ${status.message || JSON.stringify(status)}`);
        
        if (status.status === 'src_format') {
          state.systemSampleRate = status.src_format.src_sample_rate;
        }
        
        updateSystemStatus(status);
      } catch (e) {
        log(`[system] ${line}`);
      }
    });
    
    window.evia.systemAudio.onData((data) => {
      try {
        const json = JSON.parse(data);
        const [_, rateStr, chStr] = json.mimeType.match(/rate=(\d+);channels=(\d+)/) || [];
        const inputRate = parseInt(rateStr) || 48000;
        const channels = parseInt(chStr) || 1;
        const float32 = base64ToFloat32Array(json.data);
        
        // Update state
        state.systemRMS = calculateRMS(float32);
        state.systemBufferSize = pcmBuffers.system.length;
        state.systemSampleRate = inputRate;
        
        // Process audio (for visualization)
        processSystemAudio(float32, inputRate, channels);
      } catch (e) {
        console.error('Error processing system audio data:', e);
      }
    });
  }
});

// Setup tab switching
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Deactivate all tabs
      tabs.forEach(t => t.classList.remove('active'));
      // Deactivate all content
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Activate clicked tab
      tab.classList.add('active');
      // Activate corresponding content
      const tabName = tab.getAttribute('data-tab');
      document.getElementById(tabName).classList.add('active');
    });
  });
}

// Setup button event listeners
function setupButtons() {
  // Start mic capture
  document.getElementById('startMic').addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });
      
      state.micStream = stream;
      state.micEnabled = true;
      state.micSampleRate = 48000; // Default
      
      const audioCtx = new AudioContext();
      state.micSampleRate = audioCtx.sampleRate;
      
      // Start visualization
      const micContainer = document.getElementById('micVisualizerContainer');
      initDebugCanvas(micContainer);
      startLiveVisualization(stream);
      
      updateMicStatus({ status: 'active' });
      log('[mic] Microphone capture started');
    } catch (e) {
      updateMicStatus({ status: 'error', message: e.message });
      log(`[mic] Error: ${e.message}`);
    }
  });
  
  // Start system audio
  document.getElementById('startSystem').addEventListener('click', async () => {
    try {
      if (window.evia && window.evia.systemAudio) {
        const result = await window.evia.systemAudio.start();
        if (result.ok) {
          state.systemAudioEnabled = true;
          
          // Start visualization for system audio
          const systemContainer = document.getElementById('systemVisualizerContainer');
          initDebugCanvas(systemContainer);
          startSystemVisualization(() => {
            if (pcmBuffers.system.length > 0) {
              const latestBuffer = pcmBuffers.system[pcmBuffers.system.length - 1];
              return new Int16Array(latestBuffer);
            }
            return null;
          });
          
          updateSystemStatus({ status: 'starting' });
          log('[system] System audio capture started');
        } else {
          updateSystemStatus({ status: 'error', message: 'Failed to start system audio' });
          log('[system] Failed to start system audio capture');
        }
      } else {
        updateSystemStatus({ status: 'error', message: 'System audio not available' });
        log('[system] System audio not available in this build');
      }
    } catch (e) {
      updateSystemStatus({ status: 'error', message: e.message });
      log(`[system] Error: ${e.message}`);
    }
  });
  
  // Stop capture
  document.getElementById('stopCapture').addEventListener('click', () => {
    stopCapture();
    log('[audio] Capture stopped');
  });
  
  // Export WAVs
  document.getElementById('exportMicWav').addEventListener('click', () => {
    const dataUrl = exportBufferToWav('mic');
    if (dataUrl) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `evia-mic-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
      a.click();
      log('[mic] WAV exported');
    } else {
      log('[mic] No audio data to export');
    }
  });
  
  document.getElementById('exportSystemWav').addEventListener('click', () => {
    const dataUrl = exportBufferToWav('system');
    if (dataUrl) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `evia-system-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
      a.click();
      log('[system] WAV exported');
    } else {
      log('[system] No audio data to export');
    }
  });
  
  // Run diagnostics
  document.getElementById('runDiagnostics').addEventListener('click', () => {
    const diagnosticsHtml = generateDiagnosticsReport(state);
    document.getElementById('diagnosticsOutput').innerHTML = diagnosticsHtml;
    log('[diagnostics] Generated report');
  });
  
  // Test tone
  document.getElementById('testTone').addEventListener('click', () => {
    playTestTone();
    log('[audio] Test tone played');
  });
  
  // Launch main app
  document.getElementById('launchMain').addEventListener('click', async () => {
    if (window.evia && window.evia.launchMain) {
      const result = await window.evia.launchMain();
      if (result.ok) {
        log('[app] Launching main app');
      } else {
        log(`[app] Failed to launch main app: ${result.error}`);
      }
    }
  });
  
  // Clear logs
  document.getElementById('clearLogs').addEventListener('click', () => {
    state.logs = [];
    document.getElementById('logOutput').textContent = '';
  });
  
  // Export logs
  document.getElementById('exportLogs').addEventListener('click', () => {
    const blob = new Blob([state.logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evia-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
  });
  
  // Generate spectrograms
  document.getElementById('generateSpectrograms').addEventListener('click', () => {
    generateSpectrograms();
    log('[audio] Generated spectrograms');
  });
  
  // Request mic permission
  document.getElementById('requestMicPermission').addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(track => track.stop());
      log('[permissions] Microphone permission granted');
    } catch (e) {
      log(`[permissions] Microphone permission denied: ${e.message}`);
    }
  });
  
  // Open system preferences
  document.getElementById('openSystemPrefs').addEventListener('click', () => {
    if (window.evia && window.evia.openSystemPreferences) {
      window.evia.openSystemPreferences('screen');
      log('[permissions] Opening system preferences for screen recording');
    }
  });
}

// Initialize visualizers
function setupVisualizers() {
  const micContainer = document.getElementById('micVisualizerContainer');
  const systemContainer = document.getElementById('systemVisualizerContainer');
  
  initDebugCanvas(micContainer);
  initDebugCanvas(systemContainer);
}

// Stop all capture
function stopCapture() {
  // Stop microphone
  if (state.micStream) {
    state.micStream.getTracks().forEach(track => track.stop());
    state.micStream = null;
    state.micEnabled = false;
  }
  
  // Stop system audio
  if (window.evia && window.evia.systemAudio && state.systemAudioEnabled) {
    window.evia.systemAudio.stop().catch(console.error);
    state.systemAudioEnabled = false;
  }
  
  // Stop visualizations
  stopLiveVisualization();
  
  updateMicStatus({ status: 'inactive' });
  updateSystemStatus({ status: 'inactive' });
}

// Play test tone
function playTestTone() {
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.5);
}

// Generate spectrograms
function generateSpectrograms() {
  const micContainer = document.getElementById('micSpectrogramContainer');
  const systemContainer = document.getElementById('systemSpectrogramContainer');
  
  // Clear containers
  micContainer.innerHTML = '';
  systemContainer.innerHTML = '';
  
  // Generate mic spectrogram
  if (pcmBuffers.mic.length > 0) {
    const combinedLength = pcmBuffers.mic.reduce((sum, buf) => sum + buf.byteLength, 0) / 2;
    const combined = new Int16Array(combinedLength);
    let offset = 0;
    
    for (const buffer of pcmBuffers.mic) {
      const view = new Int16Array(buffer);
      combined.set(view, offset);
      offset += view.length;
    }
    
    const micSpectrogram = createSpectrogram(combined, SAMPLE_RATE);
    micContainer.appendChild(micSpectrogram);
  } else {
    micContainer.innerHTML = '<p>No microphone data available</p>';
  }
  
  // Generate system spectrogram
  if (pcmBuffers.system.length > 0) {
    const combinedLength = pcmBuffers.system.reduce((sum, buf) => sum + buf.byteLength, 0) / 2;
    const combined = new Int16Array(combinedLength);
    let offset = 0;
    
    for (const buffer of pcmBuffers.system) {
      const view = new Int16Array(buffer);
      combined.set(view, offset);
      offset += view.length;
    }
    
    const systemSpectrogram = createSpectrogram(combined, SAMPLE_RATE);
    systemContainer.appendChild(systemSpectrogram);
  } else {
    systemContainer.innerHTML = '<p>No system audio data available</p>';
  }
}

// Update metrics display
function updateMetrics() {
  document.getElementById('micSampleRate').textContent = `${state.micSampleRate} Hz`;
  document.getElementById('micRmsLevel').textContent = state.micRMS.toFixed(4);
  document.getElementById('micBufferSize').textContent = state.micBufferSize;
  document.getElementById('micWsStatus').textContent = state.micWsConnected ? 'Connected' : 'Disconnected';
  document.getElementById('micDgStatus').textContent = state.micDgOpen ? 'Open' : 'Closed';
  
  document.getElementById('systemSampleRate').textContent = `${state.systemSampleRate} Hz`;
  document.getElementById('systemRmsLevel').textContent = state.systemRMS.toFixed(4);
  document.getElementById('systemBufferSize').textContent = state.systemBufferSize;
  document.getElementById('systemWsStatus').textContent = state.systemWsConnected ? 'Connected' : 'Disconnected';
  document.getElementById('systemDgStatus').textContent = state.systemDgOpen ? 'Open' : 'Closed';
  
  // Update buffer size counters
  state.micBufferSize = pcmBuffers.mic.length;
  state.systemBufferSize = pcmBuffers.system.length;
}

// Update mic status indicator
function updateMicStatus(status) {
  const micStatus = document.getElementById('micStatus');
  
  if (status.status === 'active') {
    micStatus.className = 'status-good';
    micStatus.innerHTML = '<span class="status active"></span> <span class="status-text">Microphone active</span>';
  } else if (status.status === 'inactive') {
    micStatus.className = 'status-warning';
    micStatus.innerHTML = '<span class="status inactive"></span> <span class="status-text">Microphone inactive</span>';
  } else if (status.status === 'error') {
    micStatus.className = 'status-error';
    micStatus.innerHTML = `<span class="status inactive"></span> <span class="status-text">Error: ${status.message || 'Unknown error'}</span>`;
  }
}

// Update system audio status indicator
function updateSystemStatus(status) {
  const systemStatus = document.getElementById('systemStatus');
  
  if (status.status === 'capture_started' || status.status === 'running') {
    systemStatus.className = 'status-good';
    systemStatus.innerHTML = '<span class="status active"></span> <span class="status-text">System audio active</span>';
  } else if (status.status === 'starting' || status.status === 'starting_capture') {
    systemStatus.className = 'status-warning';
    systemStatus.innerHTML = '<span class="status active"></span> <span class="status-text">Starting system audio...</span>';
  } else if (status.status === 'inactive') {
    systemStatus.className = 'status-warning';
    systemStatus.innerHTML = '<span class="status inactive"></span> <span class="status-text">System audio inactive</span>';
  } else if (status.status === 'error' || status.status === 'capture_error') {
    systemStatus.className = 'status-error';
    systemStatus.innerHTML = `<span class="status inactive"></span> <span class="status-text">Error: ${status.message || 'Unknown error'}</span>`;
  }
}

// Log function
function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} ${message}`;
  state.logs.push(logLine);
  
  const logOutput = document.getElementById('logOutput');
  logOutput.textContent += logLine + '\n';
  logOutput.scrollTop = logOutput.scrollHeight;
}
