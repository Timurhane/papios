import type { Prompt } from '../index.ts';

export const intelCompanyNews: Prompt = {
  id: 'intel.company_news',
  version: 1,
  text: `Web aramasıyla bir işletme hakkında son 30 güne ait haberleri bul: yeni şube/açılış, yatırım, ödül, iş ilanı,
büyük kampanya, şikayet dalgası. Yalnızca bu işletmeyle kesin eşleşen haberleri al; emin değilsen alma.
Bulamazsan items boş liste olsun. Uydurma yok. Türkçe kısa açıklama yaz.`,
};

export const intelSectorNews: Prompt = {
  id: 'intel.sector_news',
  version: 1,
  text: `Web aramasıyla Türkiye'de verilen sektörlerdeki son 7 günün gelişmelerini bul (yeni düzenleme, talep artışı,
yeni açılış dalgası, dijitalleşme haberi). Her gelişme için AJNA Digital'in (mesaj asistanı, takip, randevu
hatırlatma, yorum yönetimi) bundan nasıl fırsat çıkarabileceğini tek cümleyle yaz. En fazla 5 madde. Uydurma yok;
kaynağı olmayan maddeyi yazma. Türkçe.`,
};

export const intelCompetitors: Prompt = {
  id: 'intel.competitors',
  version: 1,
  text: `Web aramasıyla verilen ajansların/rakiplerin son 7 gündeki görünür hareketlerini bul: yeni hizmet, fiyat,
kampanya, içerik teması, müşteri duyurusu. Her rakip için en fazla 2 madde; bulamazsan "yeni bir şey yok" de.
Sonunda AJNA için tek cümlelik bir çıkarım yaz. Uydurma yok. Türkçe.`,
};
