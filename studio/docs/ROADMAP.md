# Video Director: ana geliştirme planı

Son güncelleme: 2026-11-03. Ayrıntılı tasarımlar `docs/` altında. "Tamamlandı" yalnızca gerçek testle doğrulanmış işler içindir.

## Tamamlananlar

| Paket | Ne | Doğrulama |
|---|---|---|
| Arayüz (G, kısmi) | Storyboard masası tasarımı, sadeleştirilmiş sahne editörü, otomatik onay | Tarayıcıda; mobil 390 px |
| Ağız senkronu | Kelime zamanlarına bağlı ağız; konuşmaya göre kısalan sahneler | Gerçek EMA render'ı, kare karşılaştırması |
| Altyapı (A-1) | TTS sağlayıcı seçimi + devre kesici, sessizliğe dayalı hizalama, iş sırası, kapanışta worker kapatma | Testler + gerçek `say`/Pocket sesleri |
| Görsel altyapısı (C-1) | Sunucuya ait `background`, önizleme = video, aynı tarifte yeniden kullanım, arayüz kontrolü | Test sunucusu + gerçek önizleme/MP4 karşılaştırması (Draw Things henüz yok) |
| Pocket TTS (A-2) | `.venv-pocket`, sabit revizyon, çevrimdışı worker, ön normalleştirme, EMA'ya düşme | Gerçek model, gerçek render, ölçüm |
| Dayanıklılık (H-1) | Yarıda kalan render'da arayüz kilitlenmez; sahipli geçici klasör temizliği | Gerçek sunucu kesintisi |

## Sıradaki işler (bağımlılık sırasıyla)

1. **Duygusal seslendirme (A-3)** — `docs/emotional-speech.md`
   1. *Onay gerekiyor:* Ahenk Cep kurulumu (ayrı ortam, ~34 MB model).
   2. Ahenk Cep worker'ı; kelime zamanlarının gerçekten geldiğini doğrula; 7 üslubu ölç.
   3. `SpeechDirection` şeması + `Scene.speech` (geriye uyumlu) + Zod doğrulaması.
   4. Motor yetenek tablosu; render'da hız/perde/enerji/duraklama; konuşanın yüz ifadesi.
   5. Qwen prompt'una `speech` bloğu; geçersizde varsayılan.
   6. Sahne editöründe "Ses yönetimi"; desteklenmeyen duyguların açık etiketlenmesi.
   7. Dinleme testi (kullanıcı) → varsayılan motor kararı.
2. **Görsel üretimi (C-2)** — *onay gerekiyor:* Draw Things + SDXL base 1.0 (~7 GB). Gerçek API doğrulaması, çizgi film tarif şablonları, uzun işler için ilerleme kuyruğu.
3. **AI yönetmen (D)** — dramatik sahne bölme, süre, kamera ve geçiş önerileri; diyalog/anlatıcı ayrımı (duygusal seslendirmeyle aynı şema genişlemesine bağlanır).
4. **Karakter/animasyon (E)** — yeni ifadeler (korku, kahkaha yüzü), konuşan-dinleyen jestleri, nesne etkileşimleri.
5. **Ses tasarımı (F)** — konuşma/efekt/müzik seviyeleri (ducking), ambiyans, atıf notu.
6. **Arayüz (G-2)** — İngilizce arayüz, uzun işlerde gerçek ilerleme, hata mesajları.
7. **Kalite (H-2)** — uzun projelerde bellek ve süre ölçümü, kullanılmayan görsellerin temizliği.

## Elenenler (gerekçeli)

- XTTS-v2: ağırlık lisansı ticari kullanıma kapalı (CPML), lisans alınabilecek şirket yok.
- Ahenk (VoxCPM2 LoRA), Nefes 0.5: GPU gerektiriyor (A100'de bile gerçek zamandan yavaş / ~16 GB VRAM).
- FreyaTTS-small: duygu kontrolü yok, ~1,1 GB model + ağır bağımlılıklar.
- SDXL Turbo: ticari olmayan lisans.
