import { MODULES } from '@papi/modules';
import { Card } from '@/components/ui/card';

const PKG = { refleks: 'Refleks', sistem: 'Sistem', operasyon: 'Operasyon', ozel: 'Özel' } as const;

/** Teslim modülleri (K-14.1): catalog; setup files live in packages/modules. */
export function ModulesPage() {
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Teslim modülleri</h1>
      <p className="text-sm text-muted">
        Müşteri sistemleri müşterinin kendi hesaplarında, kendi anahtarlarıyla kurulur. Her projenin
        Claude Code promptu ve kontrol listesi bu modüllerden üretilir.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Modüller">
        {MODULES.map((m) => (
          <li key={m.code}>
            <Card className="flex h-full flex-col gap-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{m.name}</h2>
                {m.reference && (
                  <span className="rounded-full bg-violet/20 px-2 py-0.5 text-xs text-violet">
                    Çalışan örnek
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">{m.summary}</p>
              <p className="text-xs text-muted">
                Paketler: {m.packages.map((p) => PKG[p]).join(', ')}
              </p>
              <p className="text-xs text-muted">
                Dosyalar: <code>packages/modules/{m.code}</code>
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
