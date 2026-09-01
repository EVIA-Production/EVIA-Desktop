/**
 * Which audio device the call is actually running on, and when that changes.
 *
 * A rep who switches to AirPods mid-call moves the speaker away from the
 * microphone and replaces the whole acoustic path underneath AEC. The AEC work
 * spent weeks on readings that looked like cancellation was broken and turned
 * out to be a two-clock AirPods rig - with no signal anywhere saying the
 * hardware had changed. This is that signal.
 *
 * The logic is here rather than in the capture module because `devicechange`
 * fires far more often than the thing we care about, and getting "what actually
 * changed" wrong is how an event becomes noise nobody reads.
 */

export type AudioDeviceSnapshot = {
  /** Default input, as reported by enumerateDevices. */
  inputId: string;
  inputLabel: string;
  /** Default output. Empty on platforms that do not expose one. */
  outputId: string;
  outputLabel: string;
};

export type AudioDeviceChange = {
  device_type: 'input' | 'output';
  device_name: string;
  previous_device_name: string;
};

export const EMPTY_SNAPSHOT: AudioDeviceSnapshot = {
  inputId: '', inputLabel: '', outputId: '', outputLabel: '',
};

/**
 * Pick the default input and output out of an enumerateDevices() list.
 *
 * Chromium reports the active default first within each kind, and also exposes
 * a synthetic entry with deviceId 'default'. The synthetic one carries a label
 * like "Default - MacBook Pro Microphone", which names the real device and is
 * what a human would recognise, so it is preferred when present.
 */
export function snapshotDevices(devices: MediaDeviceInfo[]): AudioDeviceSnapshot {
  const pick = (kind: MediaDeviceKind) => {
    const ofKind = devices.filter((device) => device.kind === kind);
    const preferred = ofKind.find((device) => device.deviceId === 'default') ?? ofKind[0];
    return {
      id: preferred?.deviceId ?? '',
      // Labels are empty until a getUserMedia grant lands. An empty label is
      // reported as such rather than guessed at: "unknown" in the data is
      // honest, an invented name is not.
      label: preferred?.label?.trim() || '',
    };
  };
  const input = pick('audioinput');
  const output = pick('audiooutput');
  return {
    inputId: input.id, inputLabel: input.label,
    outputId: output.id, outputLabel: output.label,
  };
}

/**
 * What changed between two snapshots, as events worth sending.
 *
 * Returns nothing when a device was merely added or removed without the ACTIVE
 * one changing - `devicechange` fires for plugging in a monitor, and a call
 * whose audio path did not move has nothing to report.
 */
export function diffDevices(
  previous: AudioDeviceSnapshot,
  current: AudioDeviceSnapshot,
): AudioDeviceChange[] {
  const changes: AudioDeviceChange[] = [];

  for (const [type, prevId, prevLabel, curId, curLabel] of [
    ['input', previous.inputId, previous.inputLabel, current.inputId, current.inputLabel],
    ['output', previous.outputId, previous.outputLabel, current.outputId, current.outputLabel],
  ] as const) {
    // Nothing to compare against on the first read: that is the starting
    // hardware, not a change, and reporting it would make every call look like
    // the rep swapped devices the moment it began.
    if (!prevId && !prevLabel) continue;
    if (!curId && !curLabel) continue;

    // The id is the reliable half - Chromium keeps 'default' stable while the
    // label follows the hardware, so the label is what moves when a rep
    // switches. Either changing is a real change.
    if (prevId === curId && prevLabel === curLabel) continue;

    changes.push({
      device_type: type,
      device_name: curLabel || curId || 'unknown',
      previous_device_name: prevLabel || prevId || 'unknown',
    });
  }

  return changes;
}
