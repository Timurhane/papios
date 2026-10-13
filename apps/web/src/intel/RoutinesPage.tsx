import { ACTION_LABEL, describeSchedule } from '@papi/core';
import { useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePanelApi } from '@/data/PanelApiContext';
import type { RoutineItem, RoutineParseResult } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { formatDateTime } from '@/outreach/labels';

const SOURCE = { preset: 'hazır', telegram: 'Telegram', panel: 'panel' } as const;

/** Rutinler (K-13.5): presets and custom routines; times change here, new ones come from plain language. */
export function RoutinesPage() {
  const api = usePanelApi();
  const { data, error, reload } = useAsync(() => api.listRoutines(), 'routines');
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Rutinler</h1>
      <ErrorText>{error}</ErrorText>
      <NewRoutine onSaved={reload} />
      <ul className="flex flex-col gap-2" aria-label="Rutinler">
        {data?.map((r) => (
          <RoutineRow key={r.id} routine={r} onChanged={reload} />
        ))}
      </ul>
      <p className="text-xs text-muted">
        Rutinler yalnızca izinli eylemleri çalıştırır; zamanlar İstanbul saatine göredir. Saat
        değişikliği bir sonraki dakikada geçerli olur.
      </p>
    </section>
  );
}

function RoutineRow({ routine: r, onChanged }: { routine: RoutineItem; onChanged: () => void }) {
  const api = usePanelApi();
  const [time, setTime] = useState(r.schedule.time);
  const [error, setError] = useState<string | null>(null);
  const run = async (patch: Partial<Pick<RoutineItem, 'enabled' | 'schedule'>>) => {
    try {
      await api.updateRoutine(r.id, patch);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <li>
      <Card className="flex flex-col gap-2 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{r.name}</p>
            <p className="text-xs text-muted">
              {describeSchedule(r.schedule)} · {ACTION_LABEL[r.action]} · {SOURCE[r.source]}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={r.enabled}
              aria-label={`${r.name} açık`}
              onChange={(e) => run({ enabled: e.target.checked })}
            />
            {r.enabled ? 'Açık' : 'Kapalı'}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="time"
            aria-label={`${r.name} saati`}
            className="w-32"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={time === r.schedule.time || !/^\d{2}:\d{2}$/.test(time)}
            onClick={() => run({ schedule: { ...r.schedule, time } })}
          >
            Saati kaydet
          </Button>
          {r.next_run_at && (
            <span className="text-xs text-muted">Sıradaki: {formatDateTime(r.next_run_at)}</span>
          )}
        </div>
        {r.last_result && (
          <p className="line-clamp-2 text-xs whitespace-pre-wrap text-muted">
            Son sonuç ({formatDateTime(r.last_run_at)}): {r.last_result}
          </p>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>
    </li>
  );
}

function NewRoutine({ onSaved }: { onSaved: () => void }) {
  const api = usePanelApi();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<RoutineParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!api.workerAvailable())
    return (
      <Card className="p-4 text-sm text-muted">
        Doğal dille rutin için sunucu bağlantısı (VITE_API_URL) gerekli. Telegram'da /rutin ile de
        olur.
      </Card>
    );
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="font-semibold">Yeni rutin</h2>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Rutin isteği"
          className="min-w-64 flex-1"
          placeholder="Her pazartesi 9'da bana sıcak adayları özetle"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setParsed(null);
          }}
        />
        <Button
          size="sm"
          disabled={busy || text.trim().length < 3}
          onClick={() =>
            guard(async () =>
              setParsed(
                await api.worker<RoutineParseResult>('routine.parse', { text: text.trim() }),
              ),
            )
          }
        >
          Anla
        </Button>
      </div>
      {parsed && !parsed.spec && (
        <p className="text-sm text-muted">
          Bunu izinli rutinlerden birine çeviremedim; başka türlü anlatmayı dene.
        </p>
      )}
      {parsed?.spec && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{parsed.description}</span>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              guard(async () => {
                await api.worker('routine.save', { spec: parsed.spec });
                setText('');
                setParsed(null);
                onSaved();
              })
            }
          >
            Kaydet
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
