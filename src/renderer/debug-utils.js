/**
 * Audio debugging utilities for EVIA Desktop
 * Provides tools for analyzing and debugging audio issues
 */

let debugCanvas = null;
let debugCtx = null;
let debugAnimationFrame = null;

/**
 * Initialize the debug visualization canvas
 * @param {HTMLElement} container - Container element to append canvas to
 * @returns {Object} - Canvas and context objects
 */
function initDebugCanvas(container) {
  if (debugCanvas) return { canvas: debugCanvas, ctx: debugCtx };
  
  // Create canvas for visualization
  debugCanvas = document.createElement('canvas');
  debugCanvas.width = 800;
  debugCanvas.height = 200;
  debugCanvas.style.border = '1px solid #ccc';
  debugCanvas.style.backgroundColor = '#f0f0f0';
  container.appendChild(debugCanvas);
  
  // Get context
  debugCtx = debugCanvas.getContext('2d');
  
  return { canvas: debugCanvas, ctx: debugCtx };
}

/**
 * Visualize audio waveform on canvas
 * @param {Float32Array|Int16Array} audioData - Audio data to visualize
 * @param {string} color - Color of waveform
 */
function visualizeWaveform(audioData, color = '#2a9d8f') {
  if (!debugCanvas || !debugCtx) return;
  
  const width = debugCanvas.width;
  const height = debugCanvas.height;
  const centerY = height / 2;
  
  // Clear canvas
  debugCtx.clearRect(0, 0, width, height);
  
  // Draw waveform
  debugCtx.beginPath();
  debugCtx.strokeStyle = color;
  debugCtx.lineWidth = 2;
  
  const step = Math.ceil(audioData.length / width);
  let x = 0;
  
  // Normalize data based on type
  const normalize = (val) => {
    if (audioData instanceof Int16Array) {
      return val / 32768.0;
    }
    return val; // Float32Array is already normalized
  };
  
  for (let i = 0; i < audioData.length; i += step) {
    const y = centerY - (normalize(audioData[i]) * centerY);
    if (i === 0) {
      debugCtx.moveTo(x, y);
    } else {
      debugCtx.lineTo(x, y);
    }
    x++;
  }
  
  debugCtx.stroke();
  
  // Draw time axis
  debugCtx.strokeStyle = '#999';
  debugCtx.lineWidth = 1;
  debugCtx.beginPath();
  debugCtx.moveTo(0, centerY);
  debugCtx.lineTo(width, centerY);
  debugCtx.stroke();
  
  // Add RMS value
  let rms = calculateRMS(audioData);
  debugCtx.fillStyle = '#000';
  debugCtx.font = '12px Arial';
  debugCtx.fillText(`RMS: ${rms.toFixed(4)}`, 10, 20);
  debugCtx.fillText(`Length: ${audioData.length} samples`, 10, 40);
  debugCtx.fillText(`Type: ${audioData.constructor.name}`, 10, 60);
}

/**
 * Calculate RMS value of audio data
 * @param {Float32Array|Int16Array} data - Audio data
 * @returns {number} - RMS value
 */
function calculateRMS(data) {
  let sum = 0;
  let divisor = data instanceof Int16Array ? 32768.0 : 1.0;
  
  for (let i = 0; i < data.length; i++) {
    const normalized = data[i] / divisor;
    sum += normalized * normalized;
  }
  
  return Math.sqrt(sum / data.length);
}

/**
 * Start live visualization of microphone audio
 * @param {MediaStream} stream - Microphone stream
 */
function startLiveVisualization(stream) {
  if (!debugCanvas || !debugCtx) return;
  
  // Stop any existing visualization
  stopLiveVisualization();
  
  // Create audio context and analyzer
  const audioCtx = new AudioContext();
  const analyzer = audioCtx.createAnalyser();
  analyzer.fftSize = 2048;
  const bufferLength = analyzer.frequencyBinCount;
  const dataArray = new Float32Array(bufferLength);
  
  // Connect microphone to analyzer
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyzer);
  
  // Draw function
  function draw() {
    debugAnimationFrame = requestAnimationFrame(draw);
    
    analyzer.getFloatTimeDomainData(dataArray);
    visualizeWaveform(dataArray, '#e76f51');
    
    // Add live label
    debugCtx.fillStyle = '#e76f51';
    debugCtx.font = '14px Arial';
    debugCtx.fillText('LIVE MICROPHONE', debugCanvas.width - 150, 20);
  }
  
  // Start drawing
  draw();
}

/**
 * Start live visualization of system audio
 * @param {Function} dataCallback - Function that returns current system audio data
 */
function startSystemVisualization(dataCallback) {
  if (!debugCanvas || !debugCtx) return;
  
  // Stop any existing visualization
  stopLiveVisualization();
  
  // Draw function
  function draw() {
    debugAnimationFrame = requestAnimationFrame(draw);
    
    const data = dataCallback();
    if (data && data.length > 0) {
      visualizeWaveform(data, '#2a9d8f');
      
      // Add system label
      debugCtx.fillStyle = '#2a9d8f';
      debugCtx.font = '14px Arial';
      debugCtx.fillText('SYSTEM AUDIO', debugCanvas.width - 150, 20);
    }
  }
  
  // Start drawing
  draw();
}

/**
 * Stop live visualization
 */
function stopLiveVisualization() {
  if (debugAnimationFrame) {
    cancelAnimationFrame(debugAnimationFrame);
    debugAnimationFrame = null;
  }
}

/**
 * Create a spectrogram analysis of audio data
 * @param {Float32Array|Int16Array} audioData - Audio data
 * @param {number} sampleRate - Sample rate of audio
 * @returns {HTMLCanvasElement} - Canvas with spectrogram
 */
function createSpectrogram(audioData, sampleRate) {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  
  // Create audio context and analyzer
  const audioCtx = new OfflineAudioContext(1, audioData.length, sampleRate);
  const analyzer = audioCtx.createAnalyser();
  analyzer.fftSize = 2048;
  const bufferLength = analyzer.frequencyBinCount;
  
  // Create buffer and source
  const buffer = audioCtx.createBuffer(1, audioData.length, sampleRate);
  
  // Normalize data if needed
  if (audioData instanceof Int16Array) {
    const float32Data = new Float32Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      float32Data[i] = audioData[i] / 32768.0;
    }
    buffer.getChannelData(0).set(float32Data);
  } else {
    buffer.getChannelData(0).set(audioData);
  }
  
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(analyzer);
  analyzer.connect(audioCtx.destination);
  source.start();
  
  // Process chunks of audio
  const frequencyData = new Uint8Array(bufferLength);
  const timeChunks = Math.floor(audioData.length / bufferLength);
  const imageData = ctx.createImageData(timeChunks, bufferLength / 2);
  
  audioCtx.startRendering().then((renderedBuffer) => {
    for (let t = 0; t < timeChunks; t++) {
      analyzer.getByteFrequencyData(frequencyData);
      
      for (let f = 0; f < bufferLength / 2; f++) {
        const value = frequencyData[f];
        const index = (t + f * timeChunks) * 4;
        
        // Create color gradient from blue to red
        const intensity = value / 255;
        imageData.data[index] = Math.floor(intensity * 255); // R
        imageData.data[index + 1] = Math.floor((1 - intensity) * intensity * 255); // G
        imageData.data[index + 2] = Math.floor((1 - intensity) * 255); // B
        imageData.data[index + 3] = 255; // Alpha
      }
    }
    
    // Put image data on canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Draw frequency axis (vertical)
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    
    for (let i = 0; i < 5; i++) {
      const freq = Math.floor((i / 4) * sampleRate / 2);
      const y = bufferLength / 2 - (i / 4) * bufferLength / 2;
      ctx.fillText(`${freq} Hz`, 5, y);
    }
    
    // Draw time axis (horizontal)
    const duration = audioData.length / sampleRate;
    for (let i = 0; i < 5; i++) {
      const time = (i / 4) * duration;
      const x = (i / 4) * timeChunks;
      ctx.fillText(`${time.toFixed(1)}s`, x, bufferLength / 2 + 20);
    }
  });
  
  return canvas;
}

/**
 * Generate diagnostics report for audio issues
 * @param {Object} audioState - Current state of audio system
 * @returns {string} - HTML diagnostics report
 */
function generateDiagnosticsReport(audioState) {
  const report = document.createElement('div');
  
  // Header
  const header = document.createElement('h2');
  header.textContent = 'EVIA Audio Diagnostics Report';
  report.appendChild(header);
  
  // Timestamp
  const timestamp = document.createElement('p');
  timestamp.textContent = `Generated: ${new Date().toISOString()}`;
  report.appendChild(timestamp);
  
  // System info
  const sysInfo = document.createElement('div');
  sysInfo.innerHTML = `
    <h3>System Information</h3>
    <table>
      <tr><td>User Agent:</td><td>${navigator.userAgent}</td></tr>
      <tr><td>Platform:</td><td>${navigator.platform}</td></tr>
      <tr><td>Audio Context Sample Rate:</td><td>${audioState.sampleRate || 'Unknown'} Hz</td></tr>
      <tr><td>Target Sample Rate:</td><td>${audioState.targetRate || 24000} Hz</td></tr>
      <tr><td>Mic Enabled:</td><td>${audioState.micEnabled ? 'Yes' : 'No'}</td></tr>
      <tr><td>System Audio Enabled:</td><td>${audioState.systemAudioEnabled ? 'Yes' : 'No'}</td></tr>
    </table>
  `;
  report.appendChild(sysInfo);
  
  // Audio metrics
  const metrics = document.createElement('div');
  metrics.innerHTML = `
    <h3>Audio Metrics</h3>
    <table>
      <tr><td>Mic RMS:</td><td>${audioState.micRMS ? audioState.micRMS.toFixed(4) : 'N/A'}</td></tr>
      <tr><td>System RMS:</td><td>${audioState.systemRMS ? audioState.systemRMS.toFixed(4) : 'N/A'}</td></tr>
      <tr><td>Mic Buffer Size:</td><td>${audioState.micBufferSize || 0} frames</td></tr>
      <tr><td>System Buffer Size:</td><td>${audioState.systemBufferSize || 0} frames</td></tr>
    </table>
  `;
  report.appendChild(metrics);
  
  // Connection status
  const connection = document.createElement('div');
  connection.innerHTML = `
    <h3>Connection Status</h3>
    <table>
      <tr><td>Mic WebSocket:</td><td>${audioState.micWsConnected ? 'Connected' : 'Disconnected'}</td></tr>
      <tr><td>System WebSocket:</td><td>${audioState.systemWsConnected ? 'Connected' : 'Disconnected'}</td></tr>
      <tr><td>Deepgram Mic:</td><td>${audioState.micDgOpen ? 'Open' : 'Closed'}</td></tr>
      <tr><td>Deepgram System:</td><td>${audioState.systemDgOpen ? 'Open' : 'Closed'}</td></tr>
    </table>
  `;
  report.appendChild(connection);
  
  // Issues detected
  const issues = document.createElement('div');
  issues.innerHTML = '<h3>Potential Issues</h3><ul>';
  
  if (audioState.micRMS && audioState.micRMS < 0.001) {
    issues.innerHTML += '<li class="issue">Microphone signal is too low</li>';
  }
  
  if (audioState.systemRMS && audioState.systemRMS < 0.001) {
    issues.innerHTML += '<li class="issue">System audio signal is too low</li>';
  }
  
  if (!audioState.micWsConnected || !audioState.systemWsConnected) {
    issues.innerHTML += '<li class="issue">One or more WebSocket connections are down</li>';
  }
  
  if (!audioState.micDgOpen || !audioState.systemDgOpen) {
    issues.innerHTML += '<li class="issue">One or more Deepgram connections are not open</li>';
  }
  
  issues.innerHTML += '</ul>';
  report.appendChild(issues);
  
  return report.outerHTML;
}

// Export functions
export {
  initDebugCanvas,
  visualizeWaveform,
  calculateRMS,
  startLiveVisualization,
  startSystemVisualization,
  stopLiveVisualization,
  createSpectrogram,
  generateDiagnosticsReport
};
