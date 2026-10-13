/**
 * Gemini Live (constrained, ephemeral token) message handling, separated from audio so it can be tested.
 * The token already fixes model, instructions and tools (K-15.7); the client only sends audio.
 */
export const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
}

export interface FunctionCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface LiveHandlers {
  /** Base64 PCM16 audio from the model (24 kHz). */
  onAudio(base64: string): void;
  /** Runs a tool on the Worker; the result goes back to the model. */
  runTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  onTranscript(line: { who: 'Timurhan' | 'Papi'; text: string }): void;
  onInterrupted?(): void;
  onClosed(reason: string): void;
}

interface ServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  toolCall?: { functionCalls?: FunctionCall[] };
}

async function textOf(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data);
}

export class LiveProtocol {
  private ready = false;
  private input = '';
  private output = '';
  readonly transcript: string[] = [];

  constructor(
    private readonly socket: SocketLike,
    private readonly model: string,
    private readonly h: LiveHandlers,
  ) {
    socket.onopen = () => socket.send(JSON.stringify({ setup: { model: `models/${model}` } }));
    socket.onmessage = (ev) => void this.receive(ev.data);
    socket.onclose = (ev) => {
      this.flush();
      h.onClosed(ev.reason || `bağlantı kapandı (${ev.code})`);
    };
    socket.onerror = () => h.onClosed('bağlantı hatası');
  }

  get isReady(): boolean {
    return this.ready;
  }

  sendAudio(base64Pcm16k: string): void {
    if (!this.ready) return;
    this.socket.send(
      JSON.stringify({
        realtimeInput: { audio: { data: base64Pcm16k, mimeType: 'audio/pcm;rate=16000' } },
      }),
    );
  }

  close(): void {
    this.flush();
    this.socket.close();
  }

  private flush() {
    if (this.input.trim()) this.push('Timurhan', this.input);
    if (this.output.trim()) this.push('Papi', this.output);
    this.input = '';
    this.output = '';
  }

  private push(who: 'Timurhan' | 'Papi', text: string) {
    const line = { who, text: text.trim() };
    this.transcript.push(`${line.who}: ${line.text}`);
    this.h.onTranscript(line);
  }

  async receive(data: unknown): Promise<void> {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(await textOf(data)) as ServerMessage;
    } catch {
      return;
    }
    if (msg.setupComplete !== undefined) this.ready = true;
    const sc = msg.serverContent;
    if (sc) {
      if (sc.inputTranscription?.text) this.input += sc.inputTranscription.text;
      if (sc.outputTranscription?.text) {
        // the model started answering: Timurhan's sentence is complete
        if (this.input.trim()) {
          this.push('Timurhan', this.input);
          this.input = '';
        }
        this.output += sc.outputTranscription.text;
      }
      for (const p of sc.modelTurn?.parts ?? [])
        if (p.inlineData?.data) this.h.onAudio(p.inlineData.data);
      if (sc.interrupted) this.h.onInterrupted?.();
      if (sc.turnComplete) this.flush();
    }
    const calls = msg.toolCall?.functionCalls ?? [];
    if (calls.length) {
      const functionResponses = await Promise.all(
        calls.map(async (c) => {
          try {
            return { id: c.id, name: c.name, response: await this.h.runTool(c.name, c.args ?? {}) };
          } catch (e) {
            return {
              id: c.id,
              name: c.name,
              response: { error: e instanceof Error ? e.message : 'araç çalışmadı' },
            };
          }
        }),
      );
      this.socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
    }
  }
}

/** Float32 [-1, 1] samples → little-endian PCM16 → base64. */
export function pcm16Base64(samples: Float32Array): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}

/** base64 PCM16 → Float32 samples for playback. */
export function base64ToFloat32(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Float32Array(bin.length / 2);
  for (let i = 0; i < out.length; i++) {
    const lo = bin.charCodeAt(i * 2);
    const hi = bin.charCodeAt(i * 2 + 1);
    const v = (hi << 8) | lo;
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
  }
  return out;
}
