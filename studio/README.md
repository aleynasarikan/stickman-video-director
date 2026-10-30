# Stickman Video Stüdyosu

Hikâyeni yaz, sahneleri düzenle ve onayla, bilgisayarında **gerçek bir MP4 stickman animasyonu** al.

Bu klasör, depodaki `directing-stickman-videos` Skill'inin (yalnızca harici video modelleri için prompt üreten bir talimat seti) üzerine kurulmuş, tarayıcıdan kullanılan yerel bir web uygulamasıdır. Skill'in yönetmenlik kuralları (kanca → gerilim → sonuç, sahneler arası süreklilik, sürekli somut hareket, uydurma bilgi yok) Claude planlayıcısının sistem promptuna uyarlandı. Görüntü ise harici bir servis yerine **yerel, deterministik 2D animasyon motoruyla** çizilir.

```
Hikâye ─► Planlayıcı ─► Storyboard (düzenle/onayla) ─► Seslendirme ─► Kare çizimi ─► FFmpeg ─► MP4 + SRT
      Qwen / Claude /      tarayıcıda canlı önizleme     macOS "say"     @napi-rs/canvas   H.264/AAC
           çevrimdışı
```

## Hızlı başlangıç

Gereksinim: Node.js 20+ (macOS'ta Türkçe seslendirme ek kurulum gerektirmez).

```bash
cd studio
npm install
cp .env.example .env     # isteğe bağlı: QWEN_API_KEY ve/veya ANTHROPIC_API_KEY ekleyin
npm run dev              # http://localhost:5173
```

Tek sunucu olarak çalıştırmak için: `npm run build && npm start` → http://127.0.0.1:5174

## Neler ücretsiz, neler ücretli?

| Bileşen | Nasıl çalışır | Maliyet |
|---|---|---|
| Stickman animasyonu ve MP4 üretimi | Yerel (canvas + FFmpeg, `ffmpeg-static` paketiyle gelir) | Ücretsiz |
| Türkçe seslendirme | [EMA Lightning](https://huggingface.co/canberkkkkkk/ema-lightning) (yerel, çevrimdışı); yoksa macOS `say` "Yelda" | Ücretsiz |
| Altyazı | Videoya gömülü + ayrı `.srt` dosyası | Ücretsiz |
| Çevrimdışı planlayıcı | Anahtar kelime tabanlı taslak | Ücretsiz |
| Qwen planlayıcı | Hikâyeyi anlayarak sahne/hareket planlar | Alibaba Cloud üzerinden ücretli; kurum içi sunucuda ücretsiz olabilir (`QWEN_PAID=false` etiketi kaldırır) |
| Groq planlayıcı | Hikâyeyi anlayarak sahne/hareket planlar | Ücretsiz katman (kredi kartı yok, günlük istek sınırı var); API verisiyle model eğitmez |
| DeepSeek planlayıcı | Hikâyeyi anlayarak sahne/hareket planlar | DeepSeek API'si ücretli; ücretsiz/kurum içi erişimde `DEEPSEEK_PAID=false` |
| Claude planlayıcı | Hikâyeyi anlayarak sahne/hareket planlar | Ücretli (Anthropic API, kullanım başına) |

Hiçbir anahtar tanımlı değilse uygulama tamamen ücretsiz modda çalışır. Yapay zekâ çağrısı başarısız olursa çevrimdışı planlayıcıya geçilir ve kullanıcıya nedeniyle birlikte bildirilir.

### Qwen kurulumu

1. [Alibaba Cloud Model Studio](https://modelstudio.console.alibabacloud.com/) konsolundan bir API anahtarı alın.
2. `studio/.env` dosyasına ekleyin: `QWEN_API_KEY=sk-...` (`DASHSCOPE_API_KEY` adı da kabul edilir).
3. Model varsayılan olarak `qwen-plus`; `QWEN_MODEL` ile değiştirilebilir (örn. `qwen-max`, `qwen-flash`).
4. Uluslararası bölge (`dashscope-intl`) varsayılandır. Anahtarınız Çin bölgesindense `QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1` yapın; yanlış bölge "geçersiz anahtar" hatası verir.
5. Sunucuyu yeniden başlatın. Arayüzde "Yapay zekâ (Qwen)" seçeneği etkinleşir.

**Kurum içi ağ geçidi (OpenAI uyumlu):** Anahtar Alibaba'dan değil de kurumunuzun kendi sunucusundan alındıysa `QWEN_BASE_URL` o sunucunun `/v1` adresi, `QWEN_MODEL` ise sunucunun `/v1/models` listesindeki ad olmalıdır (büyük/küçük harf önemlidir, örn. `Qwen3.8-27B`). Sunucu ara sertifikasını göndermiyorsa Node.js bağlanamaz (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`); eksik ara sertifikayı `certs/` altına koyup `EXTRA_CA_CERTS` ile gösterin. Doğrulama kapatılmaz. `certs/geotrust-tls-rsa-ca-g1.pem`, DigiCert'ın yayımladığı herkese açık GeoTrust TLS RSA CA G1 ara sertifikasıdır (DigiCert Global Root G2'ye bağlı).

**DeepSeek:** `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` ve `DEEPSEEK_MODEL` ile aynı şekilde bağlanır (varsayılan: `https://api.deepseek.com`, `deepseek-flash`). Qwen ve DeepSeek aynı OpenAI uyumlu istemciyi (`server/planner/openai-compat.ts`) kullanır; başka bir OpenAI uyumlu sağlayıcı da birkaç satırla eklenebilir.

Qwen, OpenAI uyumlu uç noktanın JSON modu üzerinden çağrılır (ek paket gerekmez). JSON modu şemaya tam uyumu garanti etmediği için sunucu, listede olmayan değerleri (örn. bilinmeyen bir hareket adı) güvenli varsayılanlara çevirir.

## Mimari

- `shared/` — Tarayıcı ve sunucunun **ortak** kodu. Önizleme ile dışa aktarılan video aynı çizim fonksiyonunu (`render/frame.ts`) kullanır, bu yüzden önizlemede gördüğünüz videoda da aynıdır.
  - `schema.ts` — Proje/sahne veri modeli (Zod). Planlayıcılar yalnızca motorun çizebildiği değerleri seçebilir.
  - `rig.ts` — İskelet ve 16 hareket (yürü, koş, zıpla, el salla, konuş, otur, uyu, dans, kavga…).
  - `render/` — 6 stil, 18 mekân, yüz ifadeleri, şapkalar, eşyalar, kamera hareketleri, geçişler, altyazı.
  - `render/cinematic/` — Varsayılan "Sinematik" stil: büyük kafalı, kalın hatlı karakterler (9 saç modeli, 10 kıyafet: kimono, Mısır tuniği, toga, zırh, takım elbise…), göz kapağı/kaş/allık ile ifadeler, göz kırpma; perspektifli, gölgeli ve dokulu mekânlar (Japon evi, Mısır tapınağı, çöl, köy, kale salonu dahil), ışık ve renk düzeltmesi. Dikey videoda sahne yatay ölçekte çizilip ortası kadraja alınır.
  - `draft.ts` — Planlayıcı çıktısını doğrulayıp sınırlandıran dönüştürücü.
- `server/` — Express API, proje deposu (`data/projects/*/project.json`), planlayıcılar, TTS, MP4 üretimi.
  - `planner/types.ts` — Yeni planlayıcı (örn. başka bir LLM) eklemek için arayüz. `planner/prompt.ts` tüm LLM'lerin ortak yönetmen promptudur; `qwen.ts` ve `claude.ts` bunu kullanır.
  - `tts.ts` — `TtsEngine` arayüzü; EMA Lightning (kalıcı Python işçisi `scripts/ema_tts_worker.py`), macOS `say` ve aralarında yedekleme.
- `web/` — React arayüzü. Metinler `web/i18n.ts` içinde; yeni dil sözlükle eklenir.

### Harici video modelleri (Flow, Veo, Gemini Omni vb.)

Bu sürüm **yalnızca yerel animasyon** üretir; harici bir yapay zekâ video servisi çağrılmaz. Harici sağlayıcı eklemek için önerilen yol: `server/render.ts` yanına aynı `Project`'i alıp sahne başına klip üreten bir adaptör yazmak, klipleri yine FFmpeg ile birleştirmek ve arayüzde bu modu maliyet uyarısıyla ayrı bir seçenek olarak sunmak. Orijinal Skill'in prompt kuralları (`skills/directing-stickman-videos/references/omni-flash-prompt-contract.md`) bu adaptörün prompt üretiminde doğrudan kullanılabilir.

## Komutlar

```bash
npm test             # birim + entegrasyon testleri (gerçek MP4 üretimi dahil)
npm run typecheck
npm run snapshot -- /tmp/kareler 9:16   # her stil için örnek kareler üretir
```

## Bilinen sınırlamalar

- İngilizce seslendirme yalnızca macOS'ta var (EMA Lightning yalnızca Türkçe). Ses motoru yoksa video sessiz üretilir ve bu kullanıcıya söylenir.
- Çevrimdışı planlayıcı hikâyeyi "anlamaz"; kim ne yapıyor sorusunu anahtar kelimelerle tahmin eder. Storyboard'da düzeltme gerekebilir.
- Tarayıcıdaki canlı önizleme sessizdir; sesli kontrol için video adımındaki **20 sn önizleme** düğmesi ilk 20 saniyeyi ses, efekt ve altyazıyla üretir (`preview-*.mp4`, video listesinde görünmez). Seslendirme süresine göre sahneler üretim sırasında uzayabilir (asla kısalmaz).
- Haber çekme yalnızca RSS/Atom akışlarını ve tek haber sayfalarının başlık/özet etiketlerini okur; her sitenin HTML'ini kazımaz. Giriş gerektiren veya JavaScript ile yüklenen sayfalar okunamaz.
- Sunucu kimlik doğrulaması olmadığı için yalnızca `127.0.0.1` üzerinde dinler. İnternete açmayın.

## Haber bülteni (spiker ve stüdyo)

Hikâye adımındaki **Haberlerden bülten** paneli bir RSS/Atom adresinden (ya da tek bir haber sayfasından) haberleri getirir; seçtiğiniz haberlerden (en fazla 8) bir bülten JSON'u hazırlanıp hikâye kutusuna konur, isterseniz düzenleyip storyboard'a geçersiniz. Hazır kısayollar: AA Güncel, TRT Haber Manşet.

- **Görünüm:** *Haber Bülteni* stili (`news`): haber stüdyosu (video duvarı, grafik ve dünya ekranları, spiker masası), sol üstte kanal etiketi, her sahnede kırmızı kaynak etiketi + başlıklı **alt bant**, altta tüm başlıkların aktığı **kayan yazı**. Spiker takım elbiseli; kadın/erkek seçimi anlatıcı sesini de belirler.
- **Akış:** açılış → her haber için bir sahne → kaynaklar ve kapanış. Spiker masada konuşur; kamera orta/yakın planlar arasında değişir.
- **Telif ve doğruluk:** Haberin tam metni alınmaz, yalnızca başlık, yayıncının kendi kısa özeti (en fazla ~30 kelimelik tam cümleler) ve link kullanılır; kaynak her sahnede alt bantta yazar. Yayınlamadan önce kaynağın kullanım koşullarını kontrol edin. Özet metin kelimesi kelimesine okunur, yapay zekâ haberi yeniden yazmaz.
- **Güvenlik:** sunucu yalnızca herkese açık http(s) adreslerine gider; `localhost`, yerel ağ adresleri ve bunlara yönlendirmeler reddedilir; 12 sn zaman aşımı, 3 MB boyut sınırı vardır.
- **Komik bülten (canlandırmalı):** panelde "Bülten türü" olarak seçilir (varsayılan). Her haber için: spiker esprili bir girişle haberi verir ve **"İşte o görüntüler!"** der → haber çöp adamlarla **canlandırılır** (ekranda sarı **CANLANDIRMA** etiketi; yayıncının özeti dış ses olarak okunur) → spiker kısa bir tepki verir.
- **Komik röportaj:** spiker **"İşte o röportaj!"** der → mikrofonlu **muhabir** hayalî kişilere (taraftar, futbolcu, hakem, teyze, esnaf…) soru sorar; her konuşanın kendi sesi vardır (muhabir spikerin karşı cinsi, çocuk çocuk sesiyle…). Seçilen haberler (en fazla 3) hakkında ya da hiç haber seçmeden yazılan bir **konu** hakkında yapılır ("Derbi sonrası taraftar ne diyor?"). Ekranda "RÖPORTAJ · CANLANDIRMA" yazar.
- **Meme / caps bülteni** (varsayılan): meme sayfası havası — "Son dakika! … yine şutu uzaya yolladı. İşte o anlar!". Her hafif habere bir **gag** seçilir: *uzaya şut* (oyuncu topu göğe yollar → **uzay** sahnesinde top Dünya'nın yanından alevli kuyrukla geçer), *dramatik zoom* (ani yakınlaşma + sarsıntı + "vine boom"), *hüzün* (ağlama + hüzünlü trombon), *coşku* (sevinç + klakson), *kaos* (koşturma, düşme + plak cızırtısı). Üstte Impact tarzı **caps yazısı**, spikerin tek cümlelik tepkisi dramatik zoom'la gelir. Haberde adı geçen sporcu/kulüp alt bantta anılabilir (yapay zekânın önerdiği isim haberin metninde yoksa atılır); yalnızca saha içi olaylar **imkânsız ölçüde** abartılır (uzay, NASA), inandırıcı uydurma iddia, alıntı, özel hayat, görünüş vb. yoktur. Videoda mor **MİZAH** etiketi ve başta/sonda "Bu bir mizah içeriğidir; gerçek kişiler hakkında gerçek bir iddia içermez." notu görünür (`settings.satire`).
- Meme ögeleri elle de kullanılabilir: storyboard'da kamera **Dramatik zoom (meme)**, mekân **Uzay**, eylem **Iska (top uzaya)**; JSON'da sahneye `"caps": "OLMADI BE"`, `"efekt": "trombon, vine boom"` (boom, trombone, airhorn, scratch), en üste `"mizah": true`.
- **Konu: Genel / Futbol / Otomatik.** Futbolda canlandırmalar **stadyumda** (tribün, seyirci, bayraklar, reklam panoları, kale, gece projektörleri) ve kadro Futbolcu (numaralı forma), Kaleci, Teknik Direktör, Hakem (siyah forma, düdük, sarı/kırmızı kart), Taraftar'dır; şut hareketi (top ayaktan çıkar), tribün uğultusu, şut ve düdük sesleri eklenir. Otomatik, haberlerin çoğu futbolsa futbolu seçer. Hazır kısayollar: AA Spor, TRT Haber Spor.
- Esprileri seçili yapay zekâ planlayıcı yazar (`writeJson`, sıcaklık 0,85); yoksa ya da hata verirse hazır kalıplar kullanılır. İki kural her modda geçerlidir: **trajik ve adli haberler** (ölüm, yaralanma, şiddet, savaş, terör, afet, kaza, gözaltı/dava, hastalık) şakaya alınmaz, düz okunur — anahtar kelime denetimi yapay zekâyı yalnızca daha temkinli yapabilir ("kazandı", "bomba gibi gol", "şampiyonluk savaşı" ciddi sayılmaz); **gerçek kişiler ekrana çıkmaz ve onlara söz yazılmaz**: canlandırma ve röportajlarda yalnızca genel roller oynar, haberde olmayan bilgi uydurulmaz. Kod: `server/news-bulletin.ts`.
- Bülten storyboard'unda anlatımdaki yer/eylem sözcükleri (ör. "Bakan köye koştu") spikeri stüdyodan çıkarmaz; görsel düzeltme haber stilinde kapalıdır.

## Ekran yazısı, kelime kelime altyazı, ses efektleri

- **Ekran yazısı:** her sahnenin isteğe bağlı 2–5 kelimelik büyük başlığı (storyboard'da "Ekran yazısı / alt bant"; JSON'da `"ekranyazisi"`). Sahne başında belirir, altını fosforlu kalem çizgisi çizer; haber stilinde alt bant olur. Yapay zekâ planlayıcılar çoğu sahneye kendisi önerir.
- **Kelime kelime altyazı:** altyazı kısa ifadelere bölünür ve o an okunan kelime vurgulanır. EMA Lightning her kelimenin zamanını verir; macOS sesinde zamanlar hece sayısından tahmin edilir.
- **Ses efektleri:** zıplama, düşme, koşu, dövüş, sevinç, fikir (ampul), kalp, sahne geçişi ve ekran yazısı için efektler anlatımın altına karışır. Sesler dosya olarak gelmez, kodla sentezlenir (lisans gerektirmez). Hikâye adımındaki "Ses efektleri" kutusuyla kapatılabilir.

## Stiller ve dönem mekânları

- **El Çizimi** (`sketch`): kareli kâğıt zemin, ince mürekkep çöp adamlar, renkli pastel eşyalar, el yazısı (Caveat) başlık ve altyazılar.
- Yeni sinematik mekânlar: **Edo sokağı** (iki katlı ahşap evler, noren perdeler, kâğıt fenerler, ahşap kapı, uzakta Fuji), **Japon şatosu** (taş kaideli üç katlı kule, avlu duvarı, sakura), **dojo**, **Mısır pazarı** (kerpiç evler, tezgâhlar, palmiyeler, piramitler) ve **haber stüdyosu**. Yeni kıyafet: **hakama** (lacivert kimono, gri pileli pantolon, belde katana); kimonolar dönem renklerine yaklaştırıldı.
- Kadronun çoğu kimono/hakama giyiyorsa köy/sokak/kale gibi genel mekânlar otomatik olarak Japon sürümlerine, tunik giyiyorsa Mısır sürümlerine çevrilir (Avrupa evleri çıkmaz).

## JSON ile sahne sahne yönetmek

Hikâye kutusuna düz metin yerine JSON yapıştırabilirsiniz (arayüzdeki **JSON şablonu** bağlantısı örnek ekler). Anahtarlar Türkçe ya da İngilizce olabilir; değerler listedeki adlar (`japanese-room`, `close`) ya da serbest metin ("samuray evi", "yakın çekim", "takım elbise") olabilir, en yakın seçeneğe çevrilir.

```json
{
  "baslik": "…", "stil": "sinematik", "format": "dikey", "sure": 45,
  "karakterler": [{ "isim": "Hiro", "kiyafet": "kimono", "sac": "topknot" },
                  { "isim": "Yuki", "aciklama": "kimonolu, topuz saçlı genç kadın" }],
  "sahneler": [{
    "anlatim": "Seslendirilecek metin", "gorsel": "Ekranda ne görünecek",
    "mekan": "köy", "zaman": "gece", "kamera": "pan", "gecis": "fade", "sure": 6,
    "karakterler": [{ "isim": "Hiro", "eylem": ["sit", "think"], "duygu": "üzgün", "nesne": "kılıç" }, "Yuki (koşar, mektup)"]
  }]
}
```

JSON'da açıkça yazılan her değer planlayıcının seçiminin üstüne yazılır; boş bırakılanları yapay zekâ (ya da çevrimdışı planlayıcı) sahnenin anlatımına göre doldurur. Bir dizi (`[...]`) doğrudan sahne listesi sayılır.

## Görsellerin hikâyeye bağlılığı

Hangi planlayıcı kullanılırsa kullanılsın, her sahne anlatımıyla karşılaştırılır (`server/planner/grounding.ts`): anlatımda adı geçen karakter sahnede yoksa eklenir, adı geçen mekân/nesne/eylem/duygu/gece-gündüz görsele yansımıyorsa düzeltilir. Anlatımla zaten uyumlu seçimlere dokunulmaz. Türkçe ekleri tanıyan ortak sözlük `server/planner/lexicon.ts` içindedir ("kalesine" → kale, ama "kalem" değil).

## Türkçe seslendirme: Kızağan TTS

[Kızağan TTS](https://huggingface.co/AlicanKiraz0/Kizagan-TTS-v1.0) (Alican Kiraz, Apache-2.0) OpenBMB'nin VoxCPM2 modelinin Türkçe ince ayarıdır: ~2,3 milyar parametre, 48 kHz çıkış, tamamen bilgisayarda çalışır. Kuruluysa Türkçe videolarda **ilk tercih** odur; bir sahnede hata verirse o sahne EMA Lightning'e, o da olmazsa macOS sesine düşer. Kurulum (Python 3.12, ~5 GB model indirir):

```bash
cd studio
uv venv --python 3.12 .venv-kizagan
uv pip install --python .venv-kizagan/bin/python torch torchaudio soundfile numpy pyworld "setuptools<81" huggingface_hub \
  "voxcpm @ git+https://github.com/OpenBMB/VoxCPM.git@f772e498a45fbb5fb8e13fbf9b9c48be9fe33e69"
.venv-kizagan/bin/hf download AlicanKiraz0/Kizagan-TTS-v1.0 --local-dir models/Kizagan-TTS-v1.0
```

- `.venv-kizagan/` ve `models/` Git'e girmez. Sunucu ikisini görünce Kızağan'ı kullanır (`TTS_ENGINE=kizagan` ile zorlanabilir). Model ilk istekte yüklenir (birkaç dakika sürebilir), sonra sunucu açık kaldıkça bellekte kalır.
- Model kartındaki tarif uygulanır: metin **cümle cümle** üretilir (uzun paragraflarda ses bozuluyor), her cümlede aynı referans kayıt kullanılır, cümleler arasına kısa duraksama eklenir. Model sayıları kendisi okuyamadığı için önce yazıya çevrilir (`scripts/voice_tools.py`: "2-0" → "iki sıfır", "89. dakikada" → "seksen dokuzuncu dakikada", "%15" → "yüzde on beş", "3'te" → "üçte").
- **Sesler:** modelin kendi konuşmacısı erkektir (~105 Hz, referans: depodaki `examples/quickstart.wav`). "Erkek" doğal sestir; diğerleri WORLD ile türetilir (`KIZAGAN_PRESETS`, `server/tts.ts`). Daha doğal bir kadın/çocuk sesi için kullanma izniniz olan ~6 sn'lik temiz bir mono kaydı `KIZAGAN_REF_KADIN` (vb.) ile verin; o ses bu kayıttan klonlanır. Başkasının sesini izinsiz klonlamayın.
- Model kartı NVIDIA GPU (CUDA) ile ölçülmüştür (gerçek zamanın ~0,36 katı). Apple Silicon'da `mps`, olmazsa `cpu` kullanılır; hız ölçülmedi ve belirgin biçimde yavaş olabilir. `KIZAGAN_STEPS` (varsayılan 16) düşürülerek hızlandırılabilir.
- Kelime zamanları her cümlenin kendi süresine göre dağıtılır (karaoke altyazı için).

## Türkçe seslendirme: EMA Lightning

8,6M parametreli, ~34 MB'lık Türkçe TTS modeli; tamamen bilgisayarınızda çalışır, metin dışarı gönderilmez, anahtar gerekmez. Python 3.11+ ister; bir kez kurun:

```bash
cd studio
uv venv --python 3.12 .venv-tts          # uv yoksa: python3.12 -m venv .venv-tts
uv pip install --python .venv-tts/bin/python ema-lightning pyworld "setuptools<81"
```

Model ağırlıkları ilk kullanımda Hugging Face'ten iner. Sunucu `.venv-tts` klasörünü görünce Türkçe videolarda EMA'yı kullanır; model sunucu başına bir kez yüklenir (~10 sn), sonra her sahne bir saniyenin altında seslenir. EMA bir sahnede hata verirse o sahne macOS `say` ile seslendirilir.

**Sesler.** EMA Lightning'in tek bir (kadın) sesi vardır; seed değeri sesi değiştirmez, yalnızca küçük tonlama farkları yaratır (8 seed ölçüldü, hepsi ~245 Hz). Diğer sesler bu sesten WORLD vokoderiyle ([pyworld](https://github.com/JeremyCCHsu/Python-Wrapper-for-World-Vocoder), MIT) türetilir: perde (F0) ve ağız boşluğu tınısı (formant) ayrı ayrı değiştirilir.

| Ses | Perde | Formant | Hız | Ölçülen ortalama perde |
|---|---|---|---|---|
| Kadın (varsayılan) | 1 | 1 | 1 | ~245 Hz |
| Kadın (olgun) | 0,85 | 0,94 | 0,95 | ~206 Hz |
| Erkek | 0,56 | 0,84 | 1 | ~137 Hz |
| Erkek (kalın) | 0,48 | 0,80 | 0,93 | ~120 Hz |
| Çocuk | 1,3 | 1,12 | 1,05 | ~300 Hz |

Anlatıcı sesi hikâye adımında seçilir; storyboard'da her sahneye ayrı ses verilebilir (ör. çocuğun konuştuğu sahne). JSON'da `"ses": "erkek"` (genel) ya da sahne içinde `"ses": "çocuk"` yazılabilir. Ayarlar `shared/schema.ts` içindeki `VOICE_PRESETS`'tedir. Türetilmiş sesler gerçek bir erkek/çocuk sesi kadar doğal değildir. Model sahibi, yapay zekâ sesinin dinleyiciye belirtilmesini istiyor (ör. "Bu ses yapay zekâ ile üretilmiştir.").

## Lisans

MIT — bkz. depo kökündeki [LICENSE](../LICENSE). Claude sistem promptu, depodaki Skill'den (Stickman Video Director contributors, MIT) uyarlanmıştır. `ffmpeg-static` ile gelen FFmpeg ikili dosyası GPL lisanslıdır; uygulamayı dağıtacaksanız bu lisansı da dikkate alın. Ses dönüştürmede kullanılan pyworld MIT lisanslıdır. Kızağan TTS (Alican Kiraz) ve temeli VoxCPM2 (OpenBMB) Apache-2.0 lisanslıdır; ayrıca kurulur, depoya dahil edilmez — LICENSE/NOTICE dosyaları indirilen model klasöründedir. Türkçe seslendirme modeli EMA Lightning (Canberk Aslan, [canberk7/ema-lightning](https://github.com/canberk7/ema-lightning)) Apache-2.0 lisanslıdır; ayrıca kurulur, depoya dahil edilmez. El yazısı fontu Caveat (The Caveat Project Authors) SIL Open Font License 1.1 ile dağıtılır; lisans metni `web/public/fonts/Caveat-OFL.txt` dosyasındadır.
