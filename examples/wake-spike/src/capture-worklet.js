/* global AudioWorkletProcessor, registerProcessor */
// The page's microphone tap (an AudioWorklet): collects the first channel of the input, 128 samples at a time, into
// batches of about 85 ms and posts each to the page, which hands it to the detector's worker. It does nothing else, so the
// audio thread stays free. Plain JavaScript on purpose: a worklet module is loaded by URL, not bundled.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(4096);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.batch[this.filled++] = channel[i];
      if (this.filled === this.batch.length) {
        this.port.postMessage(this.batch, [this.batch.buffer]);
        this.batch = new Float32Array(4096);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('wake-capture', CaptureProcessor);
