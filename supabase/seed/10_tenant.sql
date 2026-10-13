-- AJNA tenant (K-1.3). Fixed id, mirrored in packages/core/src/tenant.ts. Idempotent.
insert into public.tenants (id, slug, name)
values ('00000000-0000-4000-8000-00000000a1a0', 'ajna', 'AJNA Digital')
on conflict (id) do nothing;

insert into public.feature_flags (tenant_id, key, enabled, description) values
  ('00000000-0000-4000-8000-00000000a1a0', 'client_portal', false, 'Müşteri portalı (K-13.11). Açılmadıkça dış kullanıcı giriş yapamaz.'),
  ('00000000-0000-4000-8000-00000000a1a0', 'adapter_google_places', false, 'Google Places adaptörü (kart gerektirir, K-8.8).'),
  ('00000000-0000-4000-8000-00000000a1a0', 'adapter_whatsapp_business', false, 'WhatsApp Business Cloud API (ücretli mesaj, K-10.2).'),
  ('00000000-0000-4000-8000-00000000a1a0', 'adapter_payments', false, 'iyzico/PayTR ödeme adaptörü (K-13.8).'),
  ('00000000-0000-4000-8000-00000000a1a0', 'adapter_anthropic', false, 'Anthropic Claude LLM adaptörü (K-4.2).')
on conflict (tenant_id, key) do nothing;

insert into public.tone_profiles (tenant_id) values ('00000000-0000-4000-8000-00000000a1a0')
on conflict (tenant_id) do nothing;

insert into public.founder_discount
  (tenant_id, total_slots, used_slots, setup_discount_max_pct, monthly_discount_pct, monthly_discount_months)
values ('00000000-0000-4000-8000-00000000a1a0', 3, 0, 40, 20, 3)
on conflict (tenant_id) do nothing;
