# Duygusal seslendirme: araştırma ve mimari (2026-11-03)

Durum: **tasarım**. Kod henüz değişmedi. Ölçümler bu makinede (MacBook Air M4, 16 GB) yapıldı; ses kalitesi
dinlenerek değerlendirilmedi — aşağıdaki "duygu etkisi" sütunları nesnel akustik ölçümlerdir, algı testi değildir.

## 1. Modeller

| Model | Lisans (ağırlık) | Duygu kontrolü | Kelime zamanı | Donanım | Bu Mac'te | Karar |
|---|---|---|---|---|---|---|
| **EMA Lightning** (kurulu) | Apache-2.0 | Yok | **Var** (motor verir) | CPU, RTF ~0,05 (süreç içi), ~330 MB | Çalışıyor | Varsayılan ve güvenilir yedek kalır |
| **Pocket TTS Turkish** (kurulu) | CC-BY-4.0 | 5 etiket: mutlu, üzgün, kızgın, şaşkın, sakin | Yok (`align.ts`) | CPU, RTF ~0,17, ~1,3 GB | Çalışıyor | Etiketlerin etkisi ölçümde zayıf (aşağıda) |
| **Ahenk Cep** | CC-BY-4.0 (kod Apache-2.0) | 7 üslup: neutral, angry, calm, cheerful, empathetic, sad, surprised ("laughter" tabloda var ama eğitilmemiş) | **Muhtemelen var**: model EMA Lightning motorunun içinde çalışıyor (`EMA._from_parts`), `engine.say()` EMA'nın `speech.words` alanını döndürüyor; `AhenkCep.say()` bunu atıyor, worker doğrudan `engine.say()` çağırabilir. **Kurulumdan sonra doğrulanacak.** | CPU, RTF 0,14-0,20 (model kartı), 34 MB, `ema-lightning==1.1.2` (EMA ile aynı sürüm) | Kurulmadı | **Önerilen**: duygu + kelime zamanı + EMA ile aynı ekosistem |
| **Ahenk** (VoxCPM2 2B + 138 MB LoRA) | CC-BY-4.0 / taban Apache-2.0 | 6 duygu + gülerek konuşma | Yok | **GPU gerekli**; A100'de RTF 2,28 (gerçek zamandan yavaş); taban ~4,6 GB | Uygun değil | Elendi (16 GB M4'te pratik değil) |
| **Nefes 0.5** | Apache-2.0 (kod); VoxCPM2 + Whisper large-v3 + WavLM indirir | `[gül]`, `[iç çek]`, `[fısılda]` | Yok | NVIDIA GPU ~16 GB VRAM (tepe 14,9 GB), 6 sn cümle ~30 sn; ön sürüm | Uygun değil | Elendi; Nefes 1 (tek geçiş, açık ağırlık) çıkınca yeniden bakılmalı |
| **FreyaTTS-small** | Apache-2.0 | Yok (ses yalnızca seed ile) | Yok | CPU olur; 733 MB + AudioVAE2 377 MB + ağır `voxcpm` bağımlılıkları | Kurulmadı | Elendi (duygu kontrolü yok) |
| **XTTS-v2** | **CPML: ticari olmayan kullanım**, çıktı sesi dahil; Coqui kapandı, ticari lisans alınamaz | Referans sesle dolaylı | Yok | GPU önerilir | — | **Elendi (kurumsal kullanıma lisans uygun değil)** |

Kaynaklar: model kartları ve depolar (rapor sonunda bağlantılar).

## 2. Gerçek test: Pocket TTS duygu etiketleri

Altı cümle, kadın sesi (`female_1`), seed 7; ilk cümle beş etiketin hepsiyle; kızgın/nötr üç seed ile; erkek ses (`male_3`) ile üç etiket. Ölçüm ham 24 kHz çıktıda (loudnorm öncesi, yoksa enerji farkı silinir).

- Etiketler modele ulaşıyor: aynı metin ve seed ile her etiketin dalga biçimi farklı.
- **Ama ölçülen prozodi farkı seed farkından küçük.** "Seni tekrar gördüğüme çok sevindim!" beş etiketle: süre 2,32-2,40 sn, ortanca F0 258-264 Hz, enerji -19,1…-19,3 dB. Aynı cümle kızgın/nötr, seed 1-2-3: F0 229-245 Hz arasında oynuyor, etiketten bağımsız. Erkek seste kızgın ile üzgün: süre, F0 ve enerji aynı.
- Yorum: Pocket'ın duyguları perde/enerji/hızda belirgin değil; tınıda fark olabilir ama bu ölçümle görünmez. **Dinleme testi olmadan "duyguyu iletiyor" denemez.**
- Hız: RTF 0,16-0,18 (erkek seste ilk çağrı 0,27); süreç belleği tepe ~1,28 GB.

Karşılaştırma, EMA (aynı cümleler, nötr): RTF ~0,05, tepe ~330 MB, soru cümlesinde perde belirgin yükseliyor ("Burada ne oluyor?" ortanca F0 282 Hz; Pocket şaşkın etiketiyle 249 Hz).

Örnek sesler: `scratchpad/emotion/` (pocket-*.wav, ema-*.wav).

## 3. İstenen 13 duygu: ne gerçekten mümkün?

"Doğal" = modelin eğitildiği üslup. "Prozodi" = yalnızca hız/perde/enerji/duraklama ayarı; **duygu üretmez**, arayüzde öyle gösterilmeyecek. "Yok" = bu donanımda yerel ve lisansı uygun hiçbir modelle yapılamıyor.

| Duygu | Ahenk Cep | Pocket | EMA | Not |
|---|---|---|---|---|
| Mutlu | doğal (cheerful) | etiket (mutlu), etkisi zayıf | prozodi | |
| Üzgün | doğal (sad) | etiket (üzgün), etkisi zayıf | prozodi | |
| Öfkeli | doğal (angry) | etiket (kızgın), etkisi zayıf | prozodi | |
| Şaşkın | doğal (surprised) | etiket (şaşkın), etkisi zayıf | prozodi | |
| Sakin | doğal (calm) | etiket (sakin), etkisi zayıf | prozodi | |
| Heyecanlı | cheerful + prozodi | mutlu + prozodi | prozodi | ayrı üslup yok |
| Endişeli | empathetic? (yakın değil) | yok | prozodi | doğal karşılığı yok |
| Korkmuş | yok | yok | prozodi | doğal karşılığı yok |
| Alaycı | yok | yok | yok | prozodiyle taklit edilemez |
| Fısıltı | yok | yok | yok | yalnızca Nefes (GPU); ses kısmak fısıltı değildir |
| Ağlama | yok | yok | yok | |
| Kahkaha | yok ("laughter" eğitilmemiş) | yok | yok | Ahenk LoRA / Nefes (GPU) |
| İç çekme | yok | yok | yok | yalnızca Nefes (GPU) |

Desteklenmeyen duygu seçilirse: ses nötr üretilir, karakterin **yüz ifadesi** (Canvas, `Actor.emotion`) yine uygulanır ve arayüz "bu motor bu duyguyu seslendiremiyor" der. Sözsüz sesler (kahkaha, iç çekme, ağlama) istenirse ileride ayrı, açıkça "efekt" olarak etiketlenen sentetik ses efektleri değerlendirilebilir; bunlar konuşmacının sesi değildir.

## 4. Mimari: Emotional Speech Director

### 4.1 Şema (Zod, `shared/schema.ts`)

```ts
export const SPEECH_EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "calm", "excited",
  "worried", "afraid", "sarcastic", "whisper", "crying", "laughing", "sighing"] as const;

export const SpeechDirection = z.object({
  emotion: z.enum(SPEECH_EMOTIONS).default("neutral"),
  intensity: z.number().min(0).max(1).default(0.5),
  speakingRate: z.number().min(0.8).max(1.25).default(1),   // 1 = motorun doğal hızı
  pitch: z.number().min(-3).max(3).default(0),              // yarım ton
  energy: z.number().min(-6).max(4).default(0),             // dB, loudnorm sonrası
  pauseBeforeMs: z.number().int().min(0).max(1500).default(0),
  pauseAfterMs: z.number().int().min(0).max(2000).default(0),
  emphasis: z.array(z.string().max(40)).max(4).default([]), // vurgulanacak kelimeler (metinde geçmeli)
  nonverbal: z.enum(["none", "laugh", "sigh", "cry", "gasp"]).default("none"),
});
// Scene: speech: SpeechDirection.optional()  → mevcut projeler değişmeden açılır.
```

Doğrulama: planlayıcı çıktısı bu şemadan geçer; geçersiz ya da eksik alan **varsayılana** döner (sahne düşmez). `emphasis` metinde geçmeyen kelimeleri atar. Aralıklar bilinçli olarak dar: daha geniş değerler bu motorlarda bozuk ses üretir.

### 4.2 Akış

```
Qwen planlayıcı ──► sahne + speech (JSON) ──► Zod (varsayılana düşer) ──► storyboard'da düzenlenebilir
                                                              │
render: motor seçimi ──► yetenek tablosu ──► TTS (doğal üslup + hız [+ perde, WORLD])
                                         └► ses işleme (enerji, duraklama; Pocket'ta hız atempo)
                                         └► kelime zamanı (motor ya da align.ts) ──► ağız + altyazı
                                         └► karakter yüzü: speech.emotion → Actor.emotion (yalnızca konuşan)
```

- **Yetenek tablosu** (`server/tts.ts`): her motor `capabilities()` döndürür: hangi duygular doğal, `speed`/`pitch` yerel mi. Render bir duyguyu motora yalnızca doğal destek varsa iletir; yoksa nötr + not.
- **Hız**: EMA ve Ahenk Cep'in kendi `speed` parametresi (kelime zamanları buna göre gelir). Pocket'ta ffmpeg `atempo` (perdeyi korur); hizalama son ses üzerinde yapıldığı için zamanlar doğru kalır.
- **Perde**: EMA/Ahenk Cep worker'ında WORLD (pyworld, `.venv-tts`'te zaten var; zamanlamayı bozmaz). Pocket ortamında pyworld yok → Pocket'ta perde **uygulanmaz** (ffmpeg `asetrate` formantı da kaydırır, kabul edilmedi).
- **Enerji**: loudnorm'dan **sonra** ±dB kazanç, -1 dBTP sınırıyla; loudnorm'dan önce yapılırsa silinir.
- **Duraklama**: sahne başına mevcut `SPEECH_LEAD` yerine `pauseBeforeMs`; sonda `pauseAfterMs` (mevcut `MAX_HOLD` ile birleşir). Kelime zamanları kaydırılır, ağız senkronu korunur.
- **Vurgu**: hiçbir kurulu motorda kelime düzeyinde vurgu kontrolü yok. İlk sürümde yalnızca **görsel** (karaoke altyazıda vurgulu kelime) — ses vurgusu iddia edilmeyecek.
- **Yedek**: duygu motoru (Ahenk Cep/Pocket) başarısızsa EMA nötr; mevcut devre kesici aynen.

### 4.3 Planlayıcı (Qwen)

Prompt'a sahne başına `speech` bloğu eklenir: yalnızca şemadaki duygu adları, sayısal aralıklar ve "emin değilsen neutral" kuralı. Haber bülteni modlarında spiker için varsayılan `calm`/`neutral`; mizah modunda abartılı değerler aralıkla sınırlanır. Qwen yanıtı JSON değilse ya da alan geçersizse mevcut kontrollü yedek (çevrimdışı planlayıcı / varsayılan) çalışır.

### 4.4 Arayüz

Sahne editöründe "Ses yönetimi" (katlanır): duygu, yoğunluk, hız, duraklamalar. Seçilen motor bir duyguyu doğal desteklemiyorsa seçenek yanında "bu motorda yok" yazar; prozodi ile yapılanlar "yalnızca hız/perde" diye etiketlenir.

## 5. Riskler

- Ahenk Cep'in kelime zamanları kod okumasına dayanan bir çıkarım; kurulumdan sonra doğrulanmadan "var" denmeyecek. Yoksa `align.ts` kullanılır.
- Ahenk Cep tek (kadın) ses; erkek/çocuk sesler EMA'daki gibi WORLD ile türetilir — duygulu seste türetmenin kalitesi denenmeli.
- Pocket etiketlerinin etkisi ölçümde zayıf; Pocket'a duygu iletmek kullanıcıya fark yaratmayabilir.
- Yoğunluk (`intensity`): Ahenk Cep'te `cfg` (yönlendirme gücü) ile ilişkilendirilebilir; ölçülmeden bağlanmayacak.
- CC-BY-4.0 atıf yükümlülüğü (Ahenk Cep, Pocket) ve model kartlarının "yapay zekâ sesi olduğunu belirtin" isteği: video sonuna/altyazı dosyasına atıf notu eklenmeli.
