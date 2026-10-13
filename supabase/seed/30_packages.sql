-- Service packages and prices (K-7.3). Prices in kuruş. Editable from settings later.
insert into public.service_packages
  (tenant_id, code, name, monthly_price_kurus, price_is_starting_from, has_payment_paths, includes_package_code, summary, features, position)
values
  ('00000000-0000-4000-8000-00000000a1a0', 'refleks', 'Refleks', 1750000, false, true, null,
   'Gelen her mesaja anında cevap ve takip.',
   '["WhatsApp, Instagram ve siteden gelen mesajlara anında cevap veren asistan",
     "İlgilenen her kişinin kaydı ve sahibine bildirim",
     "Cevapsız adaylara otomatik takip dizisi",
     "Aylık performans raporu"]'::jsonb, 1),
  ('00000000-0000-4000-8000-00000000a1a0', 'sistem', 'Sistem', 2550000, false, true, 'refleks',
   'Refleks''in tamamı + satış, randevu ve yorum otomasyonları.',
   '["Teklif ve satış takibi",
     "Randevu ve ödeme hatırlatmaları",
     "Google yorum toplama ve cevaplama",
     "İşletmenin kullandığı bir programla bağlantı",
     "İki haftada bir iyileştirme"]'::jsonb, 2),
  ('00000000-0000-4000-8000-00000000a1a0', 'operasyon', 'Operasyon', 4000000, true, true, 'sistem',
   'Sistem''in tamamı + işletmeye özel iç süreç otomasyonları.',
   '["İşletmeye özel iç süreç otomasyonları",
     "Ayda belirli saat yeni otomasyon geliştirme",
     "Aylık strateji görüşmesi",
     "Öncelikli destek"]'::jsonb, 3),
  ('00000000-0000-4000-8000-00000000a1a0', 'ozel', 'Özel', null, true, false, null,
   'Pakete sığmayan işler: 50.000 TL''den başlayan proje + isteğe bağlı aylık bakım.',
   '["Tek seferlik proje bedeli",
     "İsteğe bağlı aylık bakım (proje bedelinin %8-10''u)",
     "Kapsam dışı her talep ayrı fiyatlanır"]'::jsonb, 4)
on conflict (tenant_id, code) do nothing;
