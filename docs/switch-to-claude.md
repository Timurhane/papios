# Claude'a (veya başka ücretli modele) geçiş

Beyin katmanı sağlayıcıdan bağımsızdır (K-2.4). Anthropic adaptörü hazırdır ama kapalıdır (K-4.2).
Geçiş kod değişikliği gerektirmez:

1. **Anahtar:** console.anthropic.com'dan API anahtarı al → GitHub secret `ANTHROPIC_API_KEY`.
   API deploy iş akışına bu secret'ı eklemek için `.github/workflows/api-deploy.yml` → "Sync Worker secrets"
   adımındaki listeye `ANTHROPIC_API_KEY` eklenir.
2. **Özellik bayrağı:** `feature_flags` tablosunda `adapter_anthropic = true`.
3. **Kota kovası:** `settings.llm.quotas.anthropic` → `enabled: true`, `rpm`/`rpd` hesabının limitleri,
   `free_tier: false`. (`free_tier: false` olduğu için kişisel veri sınıfı bu sağlayıcıya gidebilir; K-4.7.)
4. **Yönlendirme:** `settings.llm.routing.<light|medium|heavy>` için `provider: "anthropic"` ve güncel model adı
   (ör. `claude-sonnet-5-5`). İstersen yalnızca `heavy` seviyesini Claude'a ver, diğerleri Gemini'de kalsın.
5. Ertesi gün `llm.verify_models` uyarısı gelmediyse geçiş tamamdır. Kullanım `llm_calls` tablosunda görünür.

Geri dönmek için 4. adımdaki yönlendirmeyi eski haline getirmek yeterli.
