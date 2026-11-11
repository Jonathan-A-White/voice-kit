// The phone's audio inputs and what opening one does. Labels come only once the microphone is allowed, so the list is
// refreshed after any open (packages/composer/src/micInput.ts does the same). 'Default' is the browser's own choice:
// getUserMedia with no deviceId. Any other input is opened with an exact deviceId. The level meter is an AnalyserNode
// on the opened track, not connected to any output, so the spike adds no sound of its own.

export interface InputChoice {
  /** The select's value: '' for Default, else the deviceId. */
  value: string;
  label: string;
}

/** The pseudo-input a desktop browser lists for 'whatever the system default is'; the page's own 'Default' stands for it. */
const DEFAULT_ID = 'default';

/** 'Default' first, then each audio input the browser lists. Unnamed ones (before the microphone is allowed) get a number. */
export function listInputs(devices: readonly Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]): InputChoice[] {
  const inputs = devices.filter((device) => device.kind === 'audioinput' && device.deviceId !== DEFAULT_ID);
  return [
    { value: '', label: 'Default' },
    ...inputs.map((device, i) => ({ value: device.deviceId, label: device.label || `Input ${i + 1} (name shows once the microphone is allowed)` })),
  ];
}

export interface OpenedInput {
  stream: MediaStream;
  track: MediaStreamTrack;
  label: string;
  settings: MediaTrackSettings;
  close(): void;
}

/** Opens Default (no deviceId) or one input by exact deviceId. Throws what getUserMedia throws. */
export async function openInput(media: Pick<MediaDevices, 'getUserMedia'>, deviceId: string): Promise<OpenedInput> {
  const audio: MediaTrackConstraints | boolean = deviceId ? { deviceId: { exact: deviceId } } : true;
  const stream = await media.getUserMedia({ audio });
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((each) => each.stop());
    throw new Error('the browser opened no audio track');
  }
  return { stream, track, label: track.label, settings: track.getSettings(), close: () => stream.getTracks().forEach((each) => each.stop()) };
}

/** The loudest sample of a frame of byte time-domain data (128 is silence), 0 to 1. */
export function peakOf(frame: Uint8Array): number {
  let top = 0;
  for (const sample of frame) top = Math.max(top, Math.abs(sample - 128) / 128);
  return top;
}

/** Watches a stream's level on every animation frame; the returned function stops it. */
export function startMeter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  void context.resume();
  const frame = new Uint8Array(analyser.fftSize);
  let handle = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(frame);
    onLevel(peakOf(frame));
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(handle);
    void context.close();
  };
}
