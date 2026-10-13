import { Mic as MicIcon, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import type { Player } from './audio';
import { LIVE_URL, LiveProtocol, type SocketLike } from './live-protocol';

export interface VoiceEngine {
  openSocket(url: string): SocketLike;
  startMic(onChunk: (b64: string) => void): Promise<{ stop(): void }>;
  player(): { play(b64: string): void; interrupt(): void; close(): void };
}

const browserEngine: VoiceEngine = {
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  startMic: async (onChunk) => (await import('./audio')).startMic(onChunk),
  player: () => {
    // created lazily on first use: audio.ts is only loaded on this page
    let p: Player | null = null;
    const ready = import('./audio').then((m) => (p = new m.Player()));
    return {
      play: (b) => void ready.then(() => p?.play(b)),
      interrupt: () => p?.interrupt(),
      close: () => p?.close(),
    };
  },
};

type StartReply =
  | { ok: true; token: string; model: string; seconds: number; remainingSeconds: number }
  | { ok: false; reason: 'limit' | 'not_configured' | 'provider'; remainingSeconds: number };

const REASON = {
  limit: 'Bugünkü sesli konuşma süren doldu.',
  not_configured: 'Sesli konuşma için Gemini anahtarı Worker’da tanımlı değil.',
  provider: 'Sesli konuşma başlatılamadı (sağlayıcı). Biraz sonra tekrar dene.',
} as const;

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

interface Session {
  protocol: LiveProtocol;
  mic: { stop(): void } | null;
  player: ReturnType<VoiceEngine['player']>;
  reserved: number;
  startedAt: number;
}

/** "Papi ile konuş" (K-15.6, K-15.7): live voice with read-only tools and a daily limit. */
export function VoicePage({ engine = browserEngine }: { engine?: VoiceEngine }) {
  const api = usePanelApi();
  const [state, setState] = useState<'idle' | 'connecting' | 'live'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<{ who: string; text: string }[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const session = useRef<Session | null>(null);

  const stop = async (reason?: string) => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    s.mic?.stop();
    s.protocol.close();
    s.player.close();
    setState('idle');
    if (reason) setError(reason);
    const used = Math.round((Date.now() - s.startedAt) / 1000);
    try {
      const r = await api.worker<{ remainingSeconds: number }>('voice.end', {
        reservedSeconds: s.reserved,
        usedSeconds: used,
        transcript: s.protocol.transcript.join('\n'),
      });
      setLeft(r.remainingSeconds);
    } catch {
      /* usage is reserved up front, so a failed report only costs unused time */
    }
  };

  useEffect(() => {
    if (state !== 'live') return;
    const t = setInterval(() => {
      const s = session.current;
      if (!s) return;
      const e = Math.round((Date.now() - s.startedAt) / 1000);
      setElapsed(e);
      if (e >= s.reserved) void stop('Bu oturumun süresi doldu; devam etmek için yeniden başlat.');
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => () => void stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError(null);
    setState('connecting');
    try {
      const r = await api.worker<StartReply>('voice.start', {});
      setLeft(r.remainingSeconds);
      if (!r.ok) {
        setError(REASON[r.reason]);
        setState('idle');
        return;
      }
      const player = engine.player();
      const socket = engine.openSocket(`${LIVE_URL}?access_token=${encodeURIComponent(r.token)}`);
      const protocol = new LiveProtocol(socket, r.model, {
        onAudio: (b) => player.play(b),
        onInterrupted: () => player.interrupt(),
        runTool: (name, args) => api.worker<Record<string, unknown>>('voice.tool', { name, args }),
        onTranscript: (l) => setLines((x) => [...x.slice(-40), l]),
        onClosed: (why) => {
          if (session.current) void stop(`Bağlantı kapandı: ${why}`);
        },
      });
      session.current = { protocol, mic: null, player, reserved: r.seconds, startedAt: Date.now() };
      session.current.mic = await engine.startMic((b) => protocol.sendAudio(b));
      setElapsed(0);
      setState('live');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await stop();
      setState('idle');
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Papi ile konuş</h1>
      <Card className="flex flex-col items-center gap-4 p-6 text-center">
        {!api.workerAvailable() ? (
          <p className="text-sm text-muted">
            Sesli konuşma için sunucu bağlantısı (VITE_API_URL) gerekli.
          </p>
        ) : state === 'live' ? (
          <Button onClick={() => void stop()} aria-label="Konuşmayı bitir">
            <Square className="h-4 w-4" /> Bitir · {mmss(elapsed)}
          </Button>
        ) : (
          <Button onClick={() => void start()} disabled={state === 'connecting'}>
            <MicIcon className="h-4 w-4" />
            {state === 'connecting' ? 'Bağlanıyor…' : 'Konuşmaya başla'}
          </Button>
        )}
        {left !== null && (
          <p className="text-xs text-muted" role="status">
            Bugün kalan süre: {mmss(left)}
          </p>
        )}
        <p className="text-xs text-muted">
          Papi bilgi bankasına, notlara ve CRM'e bakabilir, not alabilir. Mesaj göndermez, onay
          vermez; dışarı gidecek istekleri #taslak notu olarak kaydeder.
        </p>
        <ErrorText>{error}</ErrorText>
      </Card>
      {lines.length > 0 && (
        <Card className="p-4">
          <ul className="flex flex-col gap-1 text-sm" aria-label="Konuşma dökümü">
            {lines.map((l, i) => (
              <li key={i}>
                <strong>{l.who}:</strong> {l.text}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
