class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frameSize = 1024;
    this._buffer = new Int16Array(this._frameSize);
    this._offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length) {
      for (let i = 0; i < channel.length; i++) {
        const sample = Math.max(-1, Math.min(1, channel[i]));
        this._buffer[this._offset++] = sample * 32767;
        if (this._offset >= this._frameSize) {
          this.port.postMessage(this._buffer.buffer, [this._buffer.buffer]);
          this._buffer = new Int16Array(this._frameSize);
          this._offset = 0;
        }
      }
    }

    const output = outputs[0];
    if (output) {
      for (let c = 0; c < output.length; c++) {
        output[c].fill(0);
      }
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorkletProcessor);
