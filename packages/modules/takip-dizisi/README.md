# Takip dizisi

Cevap asistanının kaydettiği ilgilenenlerden dönüş yapmayanlara, belirlenen günlerde kısa ve kişisel takip
mesajları gönderir (ör. 1., 3. ve 7. gün).

- Paketler: Refleks, Sistem, Operasyon
- Durum: şablon + rehber (referans implementasyon cevap asistanı üzerine kurulur)
- Kaynak: cevap asistanının ilgilenen kayıtları; kanal: müşterinin seçtiği (e-posta / WhatsApp, onaylıysa)

## Kurallar

- Cevap gelen kişiye takip durur.
- "Yazmayın" diyen bir daha yazılmaz (işletmenin kendi reddedenler listesi).
- Gönderilen her takip aylık sayılara `followups_sent` olarak eklenir.
