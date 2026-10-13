import type { Prompt } from '../index.ts';

export const routineParse: Prompt = {
  id: 'papi.routine_parse',
  version: 1,
  text: `Timurhan doğal dille bir rutin tarif ediyor. Bunu yalnızca verilen eylem listesinden birine ve bir zamanlamaya
çevir. Listede uygun eylem yoksa action alanına "none" yaz. Saatler Türkiye saatidir (24 saat, "HH:MM").

Zamanlama türleri:
- {"kind":"daily","time":"09:00"} her gün
- {"kind":"weekdays","time":"09:00"} hafta içi
- {"kind":"weekly","time":"09:00","days":[1]} haftanın günleri (1=Pazartesi ... 7=Pazar)
- {"kind":"monthly","time":"09:00","day":1} ayın günü (1-28)

Saat söylenmediyse 09:00 kullan. "name" kısa ve Türkçe olsun. Parametreleri yalnızca eylemin açıklamasındaki
alanlarla doldur.`,
};
