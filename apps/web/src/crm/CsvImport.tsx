import { csvToImportRows } from '@papi/core';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';

const MAX_ROWS = 2000;

/** K-8.5: CSV upload. Rows are parsed in the browser and queued; the Actions worker de-duplicates and analyses. */
export function CsvImport({ onDone }: { onDone?: () => void }) {
  const api = usePanelApi();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{
    rows: Record<string, string>[];
    unknown: string[];
    file: string;
  } | null>(null);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setStatus('idle');
    const { rows, unknownHeaders } = csvToImportRows(await file.text());
    if (rows.length === 0) {
      setError('Dosyada işletme adı sütunu bulunamadı (ör. "Firma Adı", "İsim").');
      setPreview(null);
      return;
    }
    if (rows.length > MAX_ROWS) {
      setError(`En fazla ${MAX_ROWS} satır yüklenebilir; dosyayı bölün.`);
      return;
    }
    setPreview({
      rows: rows as unknown as Record<string, string>[],
      unknown: unknownHeaders,
      file: file.name,
    });
  }

  async function send() {
    if (!preview) return;
    setStatus('sending');
    try {
      await api.queueCsvImport(preview.rows);
      setStatus('sent');
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme başarısız.');
      setStatus('idle');
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">CSV ile aday yükle</h2>
          <p className="text-sm text-muted">
            Sütunlar: Firma adı, web sitesi, telefon, e-posta, şehir, adres, Instagram, sektör.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden /> Dosya seç
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="CSV dosyası"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>
      <ErrorText>{error}</ErrorText>
      {preview && status !== 'sent' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 p-3 text-sm">
          <span>
            <b>{preview.file}</b>: {preview.rows.length} satır
            {preview.unknown.length > 0 && (
              <span className="text-muted">
                {' '}
                · tanınmayan sütunlar: {preview.unknown.join(', ')}
              </span>
            )}
          </span>
          <Button size="sm" onClick={() => void send()} disabled={status === 'sending'}>
            {status === 'sending' ? 'Gönderiliyor…' : 'Kuyruğa ekle'}
          </Button>
        </div>
      )}
      {status === 'sent' && (
        <p role="status" className="text-sm text-success">
          Kuyruğa eklendi. Mükerrerler ayıklanıp analiz edilecek; bittiğinde Telegram'dan haber
          vereceğim.
        </p>
      )}
    </Card>
  );
}
