-- Initial playbook set (K-11.3). Step details not spelled out in the brief are assumptions
-- V-13..V-17 in docs/decisions.md. Idempotent.
insert into public.playbooks (tenant_id, code, name, description, trigger, duration_days) values
  ('00000000-0000-4000-8000-00000000a1a0', 'soguk_ana', 'Soğuk Ana',
   'Puanı 70+ olan soğuk adaylar için ana dizi.', 'score_gte_cold_main', 21),
  ('00000000-0000-4000-8000-00000000a1a0', 'hafif_soguk', 'Hafif Soğuk',
   'Puanı 50-69 olan adaylar için Soğuk Ana''nın 4 temaslı kısa versiyonu.', 'score_between_light_cold', 14),
  ('00000000-0000-4000-8000-00000000a1a0', 'sinyal', 'Sinyal',
   'Yeni açılış, iş ilanı, kötü yorum dalgası gibi bir tetikleyiciyle başlar; her mesaj sinyale atıf yapar.', 'signal_detected', 10),
  ('00000000-0000-4000-8000-00000000a1a0', 'sicak_gelen', 'Sıcak Gelen',
   'Analiz aracı, site formu veya DM ile gelen aday. Hedef: en kısa sürede ilk insan teması.', 'inbound_lead', 5),
  ('00000000-0000-4000-8000-00000000a1a0', 'ziyaret_sonrasi', 'Ziyaret Sonrası',
   'Yüz yüze ziyaretten sonra takip.', 'visit_completed', 10),
  ('00000000-0000-4000-8000-00000000a1a0', 'teklif_takibi', 'Teklif Takibi',
   'Teklif gönderildikten sonra, her temas farklı açıdan.', 'proposal_sent', 20),
  ('00000000-0000-4000-8000-00000000a1a0', 'uyandirma', 'Uyandırma',
   '60-90 gün cevap vermeyenlere yeni bulgu veya yeni sinyalle 2-3 temas.', 'no_reply_60_90_days', 10),
  ('00000000-0000-4000-8000-00000000a1a0', 'simdi_degil', 'Şimdi Değil',
   '"Sonra" diyene 90 gün sonra tek mesaj.', 'reply_later', 90),
  ('00000000-0000-4000-8000-00000000a1a0', 'referans', 'Referans',
   'Kazanılan müşteriye 30. gün memnuniyet sorusu, olumluysa referans isteği.', 'client_won', 33),
  ('00000000-0000-4000-8000-00000000a1a0', 'referans_ortak', 'Referans — Ortaklar',
   'Muhasebeci, web ajansı gibi iş ortakları için ayrı referans dizisi.', 'partner_added', 14),
  ('00000000-0000-4000-8000-00000000a1a0', 'musteri_yasami', 'Müşteri Yaşamı',
   'Kurulum sonrası 1. hafta kontrolü, aylık rapor, sözleşme bitimine 30 gün kala yenileme.', 'client_onboarded', null)
on conflict (tenant_id, code) do nothing;

insert into public.playbook_steps
  (tenant_id, playbook_id, position, day_offset, anchor, repeat_every_days, channel, angle,
   conditions, requires_approval, approval_exempt_kind)
select p.tenant_id, p.id, s.position, s.day_offset, s.anchor, s.repeat_every_days, s.channel::public.channel,
       s.angle, s.conditions::jsonb, s.requires_approval, s.approval_exempt_kind
from (values
  -- Soğuk Ana (K-11.7: 8th touch is a LinkedIn message on day 17)
  ('soguk_ana', 1, 1, 'start', null::int, 'email', 'Analizden tek somut bulgu, en fazla 80 kelime', '{"requires": ["email"]}', true, null::text),
  ('soguk_ana', 2, 3, 'start', null, 'whatsapp', 'Maile kısa atıf', '{"requires": ["phone"]}', true, null),
  ('soguk_ana', 3, 5, 'start', null, 'instagram_dm', 'Kısa, samimi DM', '{"requires": ["instagram"]}', true, null),
  ('soguk_ana', 4, 7, 'start', null, 'demo', 'Kişiye özel 60 sn ekran kaydı demo veya kişiye özel demo linki', '{}', true, null),
  ('soguk_ana', 5, 10, 'start', null, 'phone_call', 'Timurhan arar; Papi konuşma notu hazırlar', '{"requires": ["phone"]}', false, null),
  ('soguk_ana', 6, 14, 'start', null, 'email', 'Kısa fikir veya örnek', '{"requires": ["email"]}', true, null),
  ('soguk_ana', 7, 17, 'start', null, 'linkedin', 'Kısa LinkedIn mesajı, önceki temaslara atıf', '{"requires": ["linkedin"]}', true, null),
  ('soguk_ana', 8, 21, 'start', null, 'email', '"Dosyanızı kapatayım mı" kapanış maili', '{"requires": ["email"]}', true, null),
  -- Hafif Soğuk (V-14)
  ('hafif_soguk', 1, 1, 'start', null, 'email', 'Analizden tek somut bulgu, en fazla 80 kelime', '{"requires": ["email"]}', true, null),
  ('hafif_soguk', 2, 4, 'start', null, 'whatsapp', 'Maile kısa atıf', '{"requires": ["phone"]}', true, null),
  ('hafif_soguk', 3, 8, 'start', null, 'instagram_dm', 'Kısa fikir', '{"requires": ["instagram"]}', true, null),
  ('hafif_soguk', 4, 14, 'start', null, 'email', '"Dosyanızı kapatayım mı" kapanış maili', '{"requires": ["email"]}', true, null),
  -- Sinyal (V-15)
  ('sinyal', 1, 1, 'start', null, 'email', 'Sinyale doğrudan atıf + somut öneri', '{"requires": ["email"]}', true, null),
  ('sinyal', 2, 3, 'start', null, 'whatsapp', 'Sinyale atıf, kısa', '{"requires": ["phone"]}', true, null),
  ('sinyal', 3, 5, 'start', null, 'instagram_dm', 'Sinyale atıf, örnek', '{"requires": ["instagram"]}', true, null),
  ('sinyal', 4, 7, 'start', null, 'phone_call', 'Sinyal üzerinden arama', '{"requires": ["phone"]}', false, null),
  ('sinyal', 5, 10, 'start', null, 'email', 'Sinyale atıfla kapanış', '{"requires": ["email"]}', true, null),
  -- Sıcak Gelen (K-11.4)
  ('sicak_gelen', 1, 0, 'start', null, 'email', 'Analiz raporu (anında, onaysız)', '{"requires": ["email"]}', false, 'analysis_tool_report'),
  ('sicak_gelen', 2, 0, 'start', null, 'phone_call', 'Aynı gün arama görevi', '{"requires": ["phone"]}', false, null),
  ('sicak_gelen', 3, 2, 'start', null, 'email', 'Görüşme teklifi', '{"requires": ["email"]}', true, null),
  ('sicak_gelen', 4, 5, 'start', null, 'email', 'Takip', '{"requires": ["email"]}', true, null),
  -- Ziyaret Sonrası
  ('ziyaret_sonrasi', 1, 0, 'start', null, 'whatsapp', 'Teşekkür + tek sayfalık analiz', '{"requires": ["phone"]}', true, null),
  ('ziyaret_sonrasi', 2, 2, 'start', null, 'email', 'Görüşme özeti', '{"requires": ["email"]}', true, null),
  ('ziyaret_sonrasi', 3, 5, 'start', null, 'email', 'Takip', '{"requires": ["email"]}', true, null),
  ('ziyaret_sonrasi', 4, 10, 'start', null, 'phone_call', 'Takip araması', '{"requires": ["phone"]}', false, null),
  -- Teklif Takibi (K-11.5; channels V-16)
  ('teklif_takibi', 1, 2, 'start', null, 'email', 'Soru: teklifle ilgili aklınıza takılan var mı', '{}', true, null),
  ('teklif_takibi', 2, 5, 'start', null, 'whatsapp', 'Benzer bir işletmeden örnek', '{"requires": ["phone"]}', true, null),
  ('teklif_takibi', 3, 10, 'start', null, 'email', 'Kurucu müşteri kontenjanı (yalnızca gerçekten doluysa)', '{"requires_founder_slots_true_state": true}', true, null),
  ('teklif_takibi', 4, 20, 'start', null, 'email', 'Son takip', '{}', true, null),
  -- Uyandırma (V-17)
  ('uyandirma', 1, 0, 'start', null, 'email', 'Yeni bulgu veya yeni sinyal', '{"requires": ["email"]}', true, null),
  ('uyandirma', 2, 4, 'start', null, 'whatsapp', 'Yeni bulguya kısa atıf', '{"requires": ["phone"]}', true, null),
  ('uyandirma', 3, 10, 'start', null, 'email', 'Kapanış', '{"requires": ["email"]}', true, null),
  -- Şimdi Değil
  ('simdi_degil', 1, 90, 'start', null, 'email', '"Sonra" dediğiniz için tekrar yazıyorum; tek mesaj', '{}', true, null),
  -- Referans
  ('referans', 1, 30, 'start', null, 'whatsapp', 'Memnuniyet sorusu', '{}', true, null),
  ('referans', 2, 33, 'start', null, 'whatsapp', 'Referans isteği', '{"only_if": "satisfaction_positive"}', true, null),
  -- Referans — Ortaklar (V-17)
  ('referans_ortak', 1, 1, 'start', null, 'email', 'Tanışma ve iş birliği önerisi', '{"requires": ["email"]}', true, null),
  ('referans_ortak', 2, 5, 'start', null, 'whatsapp', 'Kısa takip', '{"requires": ["phone"]}', true, null),
  ('referans_ortak', 3, 14, 'start', null, 'email', 'Somut örnek + referans karşılığı', '{"requires": ["email"]}', true, null),
  -- Müşteri Yaşamı
  ('musteri_yasami', 1, 7, 'start', null, 'whatsapp', '1. hafta kontrolü', '{}', true, null),
  ('musteri_yasami', 2, 30, 'start', 30, 'email', 'Aylık performans raporu', '{}', true, null),
  ('musteri_yasami', 3, -30, 'contract_end', null, 'email', 'Yenileme görüşmesi', '{}', true, null)
) as s(code, position, day_offset, anchor, repeat_every_days, channel, angle, conditions, requires_approval, approval_exempt_kind)
join public.playbooks p
  on p.tenant_id = '00000000-0000-4000-8000-00000000a1a0' and p.code = s.code
on conflict (playbook_id, position) do nothing;
