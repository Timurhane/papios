import { base64ToFloat32, pcm16Base64 } from './live-protocol';

/** Browser audio for live voice: 16 kHz microphone in, 24 kHz model audio out. */
export interface Mic {
  stop(): void;
}

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { this.buf.push(new Float32Array(ch)); this.n += ch.length; }
    if (this.n >= 1600) { // 100 ms at 16 kHz
      const out = new Float32Array(this.n); let o = 0;
      for (const b of this.buf) { out.set(b, o); o += b.length; }
      this.port.postMessage(out, [out.buffer]); this.buf = []; this.n = 0;
    }
    return true;
  }
}
registerProcessor('papi-capture', Capture);`;

export async function startMic(onChunk: (base64: string) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'papi-capture');
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(pcm16Base64(e.data));
  src.connect(node);
  return {
    stop() {
      node.disconnect();
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

export class Player {
  private ctx = new AudioContext({ sampleRate: 24000 });
  private at = 0;
  private sources: AudioBufferSourceNode[] = [];

  play(base64: string): void {
    const samples = base64ToFloat32(base64);
    const buf = this.ctx.createBuffer(1, samples.length, 24000);
    buf.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    this.at = Math.max(this.at, this.ctx.currentTime);
    src.start(this.at);
    this.at += buf.duration;
    this.sources.push(src);
    src.onended = () => (this.sources = this.sources.filter((s) => s !== src));
  }

  /** Timurhan spoke over Papi: drop what is queued. */
  interrupt(): void {
    for (const s of this.sources) s.stop();
    this.sources = [];
    this.at = 0;
  }

  close(): void {
    this.interrupt();
    void this.ctx.close();
  }
}
