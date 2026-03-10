class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.bufferIndex++] = channelData[i];
        if (this.bufferIndex >= this.bufferSize) {
          const pcmData = new Int16Array(this.bufferSize);
          for (let j = 0; j < this.bufferSize; j++) {
            const s = Math.max(-1, Math.min(1, this.buffer[j]));
            pcmData[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
