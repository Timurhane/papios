-- K-13.5 preset routines (local Europe/Istanbul times). next_run_at is computed by the Worker on first sight.
insert into public.routines (tenant_id, code, name, schedule, action, params) values
  ('00000000-0000-4000-8000-00000000a1a0', 'sabah_brifingi', 'Sabah brifingi',
   '{"kind":"weekdays","time":"08:45"}', 'morning_brief', '{}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'kimi_aramaliyim', 'Bugün kimi aramalıyım',
   '{"kind":"weekdays","time":"09:00"}', 'whom_to_call', '{"limit":5}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'sinyal_taramasi', 'Sinyal taraması',
   '{"kind":"weekly","time":"07:00","days":[1]}', 'signal_scan', '{"site_limit":40,"news_limit":20}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'rakip_taramasi', 'Haftalık rakip taraması',
   '{"kind":"weekly","time":"07:30","days":[1]}', 'competitor_scan', '{}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'sektor_haberleri', 'Sektör haberlerinden fırsat',
   '{"kind":"weekly","time":"08:00","days":[3]}', 'sector_news', '{}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'odeme_gecikme', 'Ödeme gecikme kontrolü',
   '{"kind":"daily","time":"09:05"}', 'payment_check', '{}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'aylik_musteri_raporlari', 'Aylık müşteri raporları',
   '{"kind":"monthly","time":"09:20","day":1}', 'monthly_reports', '{}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'haftalik_patron_ozeti', 'Haftalık patron özeti',
   '{"kind":"weekly","time":"17:00","days":[5]}', 'weekly_summary', '{}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'haftalik_icerik', 'Haftalık içerik planı (Kalem)',
   '{"kind":"weekly","time":"10:00","days":[1]}', 'content_plan', '{"per_platform":2}'),
  ('00000000-0000-4000-8000-00000000a1a0', 'ogrenme_gozden_gecirme', 'Öğrenen sistem önerileri',
   '{"kind":"weekly","time":"18:00","days":[5]}', 'learning_review', '{}')
on conflict (tenant_id, code) do nothing;
