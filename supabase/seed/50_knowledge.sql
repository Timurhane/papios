-- AJNA identity knowledge base (K-6.3, K-6.5, K-6.6). Seeded only when the tenant has no items yet.
insert into public.knowledge_items (tenant_id, kind, title, content, is_template)
select '00000000-0000-4000-8000-00000000a1a0', k.kind::public.knowledge_kind, k.title, k.content, k.is_template
from (values
  ('brand', 'Marka', 'AJNA Digital. Alt başlık: "AI. SYSTEMS. GROWTH. CREATIVE." Alan adı: ajnadigitalagency.com. Instagram: @ajnadigitalagency.', false),
  ('brand', 'Slogan', 'Personel değil, refleks kuruyoruz.', false),
  ('brand', 'Konumlandırma', 'Premium, minimal, global. Spiritüel konumlandırma kullanılmaz.', false),
  ('service', 'Hizmet kolları', 'AJNA Systems, AJNA Growth, AJNA Creative.', false),
  ('brand', 'İş modeli', 'AJNA, işletmelere abonelik modeliyle yapay zeka otomasyonları satar. Müşteriye kurulan sistemler müşterinin kendi hesaplarında ve kendi API anahtarlarıyla çalışır.', false),
  ('icp', 'İdeal müşteri', 'Müşteri başı değeri yüksek işletmeler. Örnekler: emlak, klinikler, oto galeri ve bayiler, inşaat ve tadilat, özel eğitim kurumları, oteller, OSB''deki üreticiler. Tek sektöre kilitlenme yok.', false),
  ('brand', 'İçerik mesajı', 'Tanıtım içeriklerinde şehir adı geçmez. Ana mesaj: her işletme ve KOBİ''ye özgün çözümler.', false),
  ('objection', 'İtiraz şablonu', 'İtiraz: ...\nCevap: ...', true),
  ('case_study', 'Vaka çalışması şablonu', 'Müşteri / sektör: ...\nSorun: ...\nKurulan sistem: ...\nSonuç: ...', true),
  ('module_catalog', 'Hazır modül şablonu', 'Modül adı: ...\nNe yapar: ...\nHangi pakette: ...\nKurulum süresi: ...', true)
) as k(kind, title, content, is_template)
where not exists (
  select 1 from public.knowledge_items ki where ki.tenant_id = '00000000-0000-4000-8000-00000000a1a0'
);
