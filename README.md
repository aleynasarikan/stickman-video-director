# Stickman Haber Stüdyosu

Gündemi çek, komik bir bülten yap, bilgisayarında **gerçek bir MP4 stickman videosu** al.

Spiker stüdyoda haberi sunar, "İşte o görüntüler!" der ve haber stickman'lerle canlandırılır. Seslendirme, kelime kelime altyazı, ekran yazıları ve ses efektleri otomatik gelir.

```
Haber / hikâye ─► Planlayıcı ─► Storyboard (düzenle, onayla) ─► Seslendirme ─► Kare çizimi ─► FFmpeg ─► MP4 + SRT
 RSS · bağlantı    Qwen / Claude /    tarayıcıda canlı önizleme    Kızağan / EMA /   @napi-rs/canvas   H.264/AAC
                   çevrimdışı                                      macOS "say"
```

## Neler yapabiliyor?

- **Haber bülteni:** RSS adresi ya da haber bağlantısı verin, haberleri seçin, spikerli bir bülten hazırlansın.
- **Dört mod:**
  - **Meme:** "Şut yine uzaya gitti" havasında komedi programı.
  - **Komik:** Haber canlandırması.
  - **Röportaj:** Muhabir ve konuklar.
  - **Klasik:** Düz bülten.
- **Futbol:** Stadyum, forma, hakem kostümleri; şut, ıska, kart ve kupa gibi hareketler ve aksesuarlar.
- **Görünüm ve ses:**
  - Haber stüdyosu grafikleri: alt bant, kayan yazı, "CANLANDIRMA" ve "MİZAH" etiketleri.
  - Karaoke altyazı.
  - Meme yazıları ve sesleri (boom, trombon, korna).
  - 20 saniyelik hızlı önizleme.
- **Türkçe seslendirme:** Kızağan TTS ya da EMA Lightning, ikisi de isteğe bağlı. Yapay zekânın harfleri atlayarak yazdığı Türkçe metin ("bakalim", "basladi") otomatik düzeltilir.
- **Mizah kuralları:** Trajedi ve hukuki konular mizaha çevrilmez. Gerçek kişilere uydurma söz ya da iddia yazılmaz.

## Hızlı başlangıç

Gereksinim: Node.js 20+.

```bash
cd studio
npm install
cp .env.example .env     # isteğe bağlı: API anahtarlarınızı buraya ekleyin
npm run dev              # http://localhost:5173
```

Kurulum, ayarlar, JSON ile sahne yönetimi ve seslendirme motorları için **[studio/README.md](studio/README.md)** dosyasına bakın.

## Kaynak ve lisans

Bu proje, [kaomei/stickman-video-director](https://github.com/kaomei/stickman-video-director) deposu (MIT, Stickman Video Director contributors) temel alınarak geliştirildi. Orijinal stickman çizim stilleri ve `directing-stickman-videos` Skill'i `skills/` klasöründe duruyor. Orijinal tanıtım metni çok dilli olarak korunuyor:

[简体中文](README.zh-CN.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português do Brasil](README.pt-BR.md)

Lisans: MIT, bkz. [LICENSE](LICENSE). Üçüncü taraf bileşenlerin lisansları (FFmpeg, Kızağan/VoxCPM2, EMA Lightning, Caveat fontu) [studio/README.md](studio/README.md#lisans) dosyasında listelenmiştir.
