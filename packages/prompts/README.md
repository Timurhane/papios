# @papi/prompts

Ajan (Papi, Kaşif, Analist, Ulak, Satıcı, Operatör, Kalem) ve görev promptları. Kural: metin değişirse `version` artırılır.
Kural: prompt metni kod içine gömülmez; her prompt `id` + `version` ile saklanır ve `llm_calls` kaydına yazılır.
