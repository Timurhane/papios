import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PanelApiProvider } from '@/data/PanelApiContext';
import { FakePanelApi } from '@/test/fake-panel-api';
import { base64ToFloat32, LiveProtocol, pcm16Base64, type SocketLike } from './live-protocol';
import { VoicePage, type VoiceEngine } from './VoicePage';

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) {
    this.sent.push(JSON.parse(d) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
  }
}

describe('live protocol', () => {
  it('sends setup, audio after setupComplete, answers tool calls and keeps a transcript', async () => {
    const s = new FakeSocket();
    const audio: string[] = [];
    const lines: string[] = [];
    const p = new LiveProtocol(s, 'gemini-live', {
      onAudio: (b) => audio.push(b),
      runTool: async (name, args) => ({ ok: name, args }),
      onTranscript: (l) => lines.push(`${l.who}: ${l.text}`),
      onClosed: () => undefined,
    });
    s.onopen?.();
    expect(s.sent[0]).toEqual({ setup: { model: 'models/gemini-live' } });
    p.sendAudio('AAAA');
    expect(s.sent).toHaveLength(1); // not ready yet
    await p.receive(JSON.stringify({ setupComplete: {} }));
    p.sendAudio('AAAA');
    expect(s.sent[1]).toMatchObject({
      realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000' } },
    });

    await p.receive(JSON.stringify({ serverContent: { inputTranscription: { text: 'Bugün ' } } }));
    await p.receive(JSON.stringify({ serverContent: { inputTranscription: { text: 'ne var?' } } }));
    await p.receive(
      JSON.stringify({
        toolCall: { functionCalls: [{ id: 'f1', name: 'today_summary', args: {} }] },
      }),
    );
    expect(s.sent[2]).toEqual({
      toolResponse: {
        functionResponses: [
          { id: 'f1', name: 'today_summary', response: { ok: 'today_summary', args: {} } },
        ],
      },
    });
    await p.receive(
      JSON.stringify({
        serverContent: {
          outputTranscription: { text: '3 onay bekliyor.' },
          modelTurn: {
            parts: [{ inlineData: { data: 'UENN', mimeType: 'audio/pcm;rate=24000' } }],
          },
        },
      }),
    );
    await p.receive(JSON.stringify({ serverContent: { turnComplete: true } }));
    expect(audio).toEqual(['UENN']);
    expect(lines).toEqual(['Timurhan: Bugün ne var?', 'Papi: 3 onay bekliyor.']);
    expect(p.transcript).toEqual(lines);
  });

  it('converts PCM16 both ways', () => {
    const back = base64ToFloat32(pcm16Base64(new Float32Array([0, 0.5, -0.5, 1, -1])));
    expect([...back].map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 1, -1]);
  });
});

describe('Papi ile konuş', () => {
  function engine() {
    const socket = new FakeSocket();
    let micStopped = false;
    const e: VoiceEngine = {
      openSocket: () => socket,
      startMic: async () => ({ stop: () => void (micStopped = true) }),
      player: () => ({ play: () => undefined, interrupt: () => undefined, close: () => undefined }),
    };
    return { e, socket, micStopped: () => micStopped };
  }

  it('starts with a Worker token, ends and reports usage with the transcript', async () => {
    const api = new FakePanelApi();
    api.hasWorker = true;
    api.workerReplies['voice.start'] = {
      ok: true,
      token: 'auth_tokens/t',
      model: 'gemini-live',
      seconds: 600,
      remainingSeconds: 600,
    };
    api.workerReplies['voice.end'] = { remainingSeconds: 1140 };
    const { e, socket, micStopped } = engine();
    render(
      <PanelApiProvider api={api}>
        <MemoryRouter>
          <VoicePage engine={e} />
        </MemoryRouter>
      </PanelApiProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Konuşmaya başla/ }));
    expect(await screen.findByRole('button', { name: 'Konuşmayı bitir' })).toBeInTheDocument();
    socket.onopen?.();
    await userEvent.click(screen.getByRole('button', { name: 'Konuşmayı bitir' }));
    expect(socket.closed).toBe(true);
    expect(micStopped()).toBe(true);
    expect(api.workerCalls.map((c) => c.action)).toEqual(['voice.start', 'voice.end']);
    expect(await screen.findByText('Bugün kalan süre: 19:00')).toBeInTheDocument();
  });

  it('explains when the daily limit is used up', async () => {
    const api = new FakePanelApi();
    api.hasWorker = true;
    api.workerReplies['voice.start'] = { ok: false, reason: 'limit', remainingSeconds: 0 };
    render(
      <PanelApiProvider api={api}>
        <MemoryRouter>
          <VoicePage engine={engine().e} />
        </MemoryRouter>
      </PanelApiProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Konuşmaya başla/ }));
    expect(await screen.findByText('Bugünkü sesli konuşma süren doldu.')).toBeInTheDocument();
  });
});
