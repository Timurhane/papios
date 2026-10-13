# @papi/modules

Müşteriye teslim edilen otomasyon modülleri (K-14.1) ve Operatör şablonları (K-14.2).

| Modül                | Paketler                   | Durum                                       |
| -------------------- | -------------------------- | ------------------------------------------- |
| `cevap-asistani`     | Refleks, Sistem, Operasyon | Çalışan referans implementasyon (`worker/`) |
| `takip-dizisi`       | Refleks, Sistem, Operasyon | Şablon + rehber                             |
| `randevu-hatirlatma` | Sistem, Operasyon          | Şablon + rehber                             |
| `google-yorum`       | Sistem, Operasyon          | Şablon + rehber                             |
| `aylik-rapor`        | Refleks, Sistem, Operasyon | Şablon + rehber (Papi uç noktası hazır)     |

Her modülde: `README.md`, `SETUP.md` (müşteri hesaplarında kurulum), `TESTS.md`, `config.schema.json`
(`src/config.ts`'ten üretilir: `pnpm --filter @papi/modules gen:schemas`).

`src/`:

- `catalog.ts` modül listesi ve kurulum adımları
- `form.ts` kurulum formu alanları ve doğrulama (K-14.4)
- `config.ts` müşteri yapılandırma şeması
- `operator.ts` yapılandırma dosyası, Claude Code promptu ve kontrol listesi (şablonla; model yok)

Müşteri sistemleri müşterinin kendi hesaplarında, kendi anahtarlarıyla çalışır (K-7.6).
