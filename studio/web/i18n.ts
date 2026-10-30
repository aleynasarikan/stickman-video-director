import type {
  ActionId, CameraId, EmotionId, PropId, SettingId, StyleId, VoiceId,
} from "../shared/schema";

// UI copy lives here so a second language can be added by adding a dictionary.
export const tr = {
  appName: "Stickman Video Stüdyosu",
  steps: ["Hikâye", "Storyboard", "Video"],
  newProject: "Yeni proje",
  myProjects: "Projelerim",
  noProjects: "Henüz proje yok",
  storyTitle: "Hikâyeni anlat",
  storyHint: "Hikâyeni yaz ya da yapıştır. Karakter adlarını, mekânları ve ne yaptıklarını yazman sahneleri daha isabetli yapar. Sahne sahne kontrol istersen JSON da yapıştırabilirsin.",
  jsonDetected: "JSON algılandı",
  jsonInvalid: "JSON gibi görünüyor ama okunamadı; düz metin olarak işlenecek",
  jsonTemplate: "JSON şablonu",
  newsTitle: "Haberlerden bülten",
  newsHint: "Bir RSS/Atom adresi veya tek bir haber sayfası girin. Yalnızca başlık, kaynağın kendi kısa özeti ve link alınır; haber metni kopyalanmaz. Kaynak her sahnede alt bantta görünür.",
  newsUrl: "RSS veya haber adresi",
  newsFetch: "Haberleri getir",
  newsFetching: "Getiriliyor…",
  newsSelected: (n: number, max: number) => `${n}/${max} haber seçili`,
  newsBulletinTitle: "Bülten adı",
  newsAnchor: "Spiker adı",
  newsPresenter: "Spiker",
  newsFemale: "Kadın",
  newsMale: "Erkek",
  newsBuild: "Bülten metnini hazırla",
  newsBuilding: "Hazırlanıyor…",
  newsMode: "Bülten türü",
  newsClassic: "Klasik bülten",
  newsComic: "Komik bülten (canlandırmalı)",
  newsInterview: "Komik röportaj",
  newsMeme: "Meme / caps bülteni",
  newsTopic: "Konu",
  newsTopicAuto: "Otomatik",
  newsTopicGeneral: "Genel",
  newsTopicFootball: "Futbol",
  newsSubject: "Röportaj konusu (haber seçmeden de olur)",
  newsSubjectPlaceholder: "ör. Derbi sonrası taraftar ne diyor?",
  newsInterviewOnly: "Röportaj hazırla",
  newsComicNote: (mode: "comic" | "interview" | "meme", ai: string | null) =>
    `${mode === "meme"
      ? 'Meme sayfası havası: "Son dakika! … yine şutu uzaya yolladı." Her habere bir gag (top uzaya gider, dramatik zoom + vine boom, hüzünlü trombon, klakson, plak cızırtısı) ve caps yazısı. Haberde adı geçen sporcular anılabilir; yalnızca saha içi olaylar abartılır, uydurma iddia/alıntı yok. Ekranda MİZAH etiketi ve uyarı notu çıkar.'
      : mode === "comic"
      ? 'Her haberde spiker "İşte o görüntüler!" der, haber çöp adamlarla canlandırılır (ekranda CANLANDIRMA yazar), sonra spiker tepki verir.'
      : 'Spiker "İşte o röportaj!" der; mikrofonlu muhabir hayalî kişilere (taraftar, futbolcu, teyze…) sorar, her konuşanın kendi sesi olur.'} ${ai ? `Esprileri ${ai} yazar.` : "Esprilerde hazır kalıplar kullanılır (yapay zekâ planlayıcı seçilirse o yazar)."} Ölüm, yaralanma, şiddet, kaza, dava gibi haberler şakaya alınmaz. Ekrandaki kişiler hayalîdir; gerçek kişilere söz yazılmaz.`,
  newsTerms: "Yayınlamadan önce kaynağın kullanım koşullarını kontrol edin.",
  storyPlaceholder: "Örnek: Ali sabah parkta yürüyordu. Birden Ayşe'yi gördü ve el salladı. Ayşe elinde bir kahveyle bankta oturuyordu…",
  duration: "Hedef süre",
  aspect: "En-boy oranı",
  landscape: "Yatay 16:9",
  portrait: "Dikey 9:16",
  style: "Görsel stil",
  language: "Anlatım dili",
  voiceover: "Seslendirme",
  subtitles: "Altyazı",
  planner: "Senaryo planlayıcı",
  plannerAi: { qwen: "Yapay zekâ (Qwen)", groq: "Yapay zekâ (Groq)", deepseek: "Yapay zekâ (DeepSeek)", claude: "Yapay zekâ (Claude)" },
  plannerAiNote: "Hikâyeyi anlayarak sahneler, diyalog ve hareket planlar. API kullanımı ücretlidir (bir planlama genellikle birkaç sent).",
  plannerAiFreeNote: "Hikâyeyi anlayarak sahneler, diyalog ve hareket planlar. Ücretsiz erişim üzerinden çalışır.",
  paid: "Ücretli",
  plannerOffline: "Çevrimdışı (ücretsiz)",
  plannerOfflineNote: "Anahtar kelimelerle hızlı bir taslak çıkarır. Sonucu storyboard'da düzenlemen gerekebilir.",
  plannerAiMissing: {
    qwen: "Qwen kullanmak için studio/.env dosyasına QWEN_API_KEY ekleyip sunucuyu yeniden başlat.",
    groq: "Groq kullanmak için console.groq.com adresinden ücretsiz anahtar alıp studio/.env dosyasına GROQ_API_KEY olarak ekle ve sunucuyu yeniden başlat.",
    deepseek: "DeepSeek kullanmak için studio/.env dosyasına DEEPSEEK_API_KEY (ve gerekirse DEEPSEEK_BASE_URL) ekleyip sunucuyu yeniden başlat.",
    claude: "Claude kullanmak için studio/.env dosyasına ANTHROPIC_API_KEY ekleyip sunucuyu yeniden başlat.",
  },
  createStoryboard: "Storyboard oluştur",
  planning: "Sahneler planlanıyor…",
  characters: "Karakterler",
  scenes: "Sahneler",
  scene: "Sahne",
  approve: "Onayla",
  approved: "Onaylandı",
  approveAll: "Tümünü onayla",
  regenerate: "Yeniden üret",
  regenerateHint: "İsteğe bağlı: bu sahne için ne değişsin?",
  remove: "Sil",
  addScene: "Sahne ekle",
  addActor: "Karakter ekle",
  narration: "Anlatım (seslendirme metni)",
  sceneTitle: "Başlık",
  visualNote: "Görsel not",
  seconds: "sn",
  setting: "Mekân",
  timeOfDay: "Zaman",
  camera: "Kamera",
  transition: "Geçiş",
  actions: "Hareketler (sırayla)",
  emotion: "Duygu",
  prop: "Eşya",
  from: "Başlangıç",
  to: "Bitiş",
  facing: "Yön",
  left: "Sola",
  right: "Sağa",
  hat: "Şapka",
  hair: "Saç",
  outfit: "Kıyafet",
  color: "Renk",
  name: "Ad",
  saved: "Kaydedildi",
  saving: "Kaydediliyor…",
  unsaved: "Kaydedilmedi",
  previewSilent: "Önizleme sessizdir; seslendirme ve kesin süreler video üretiminde eklenir.",
  toVideo: "Video adımına geç",
  approvalNeeded: (n: number) => `Video üretmek için ${n} sahnenin daha onaylanması gerekiyor.`,
  render: "Videoyu üret",
  rerender: "Yeniden üret",
  rendering: "Video üretiliyor…",
  phases: { queued: "Sırada", voice: "Seslendirme hazırlanıyor", frames: "Kareler çiziliyor", encode: "MP4 kodlanıyor" } as Record<string, string>,
  downloadMp4: "MP4 indir",
  downloadSrt: "Altyazı (.srt) indir",
  previousRenders: "Önceki üretimler",
  localEngineNote: "Bu video bilgisayarınızda, yerel stickman animasyon motoruyla üretildi. Harici bir yapay zekâ video servisi kullanılmadı ve ücret alınmadı.",
  back: "Geri",
  error: "Hata",
  plannerBadge: { qwen: "Qwen ile planlandı", groq: "Groq ile planlandı", deepseek: "DeepSeek ile planlandı", claude: "Claude ile planlandı", offline: "Çevrimdışı planlandı" },
  voiceAvailable: "Türkçe ses hazır",
  voiceMissing: "Seslendirme motoru yok",
  engineLabels: { kizagan: "Kızağan TTS", "ema-lightning": "EMA Lightning", "macos-say": "macOS (Yelda)" } as Record<string, string>,
  narratorVoice: "Anlatıcı sesi",
  sceneVoice: "Ses",
  sceneVoiceDefault: "Anlatıcı",
  sfx: "Ses efektleri",
  headline: "Ekran yazısı / alt bant",
  headlinePlaceholder: "2-5 kelime (boş = yok)",
  preview: "20 sn önizleme",
  previewNote: "Önizleme: ilk 20 saniye, ses ve efektlerle. Tam video için aşağıdaki düğmeyi kullanın.",
  voicesNeedEma: "Ses seçenekleri EMA Lightning kurulu olduğunda çalışır; şu an tek ses kullanılıyor.",
};

export const STYLE_LABELS: Record<StyleId, { name: string; note: string }> = {
  cinematic: { name: "Sinematik", note: "Detaylı mekânlar, ifadeli karakterler" },
  news: { name: "Haber Bülteni", note: "Stüdyo, spiker masası, alt bant, kayan yazı" },
  sketch: { name: "El Çizimi", note: "Kareli kâğıt, ince figürler, el yazısı" },
  "classic-light": { name: "Klasik Açık", note: "Beyaz zemin, siyah çizgi" },
  "classic-dark": { name: "Klasik Koyu", note: "Siyah zemin, beyaz çizgi" },
  "modern-pop": { name: "Modern Pop", note: "Kırmızı bereli, canlı renkler" },
  cozy: { name: "Sıcak Hikâye", note: "Renkli gündelik mekânlar" },
  prehistoric: { name: "Tarih Öncesi", note: "Mağara, ateş, toprak tonları" },
};

export const SETTING_LABELS: Record<SettingId, string> = {
  blank: "Boş sahne", park: "Park", street: "Sokak", city: "Şehir", room: "Oda", office: "Ofis",
  classroom: "Sınıf", kitchen: "Mutfak", forest: "Orman", beach: "Plaj", mountain: "Dağ", cave: "Mağara", stage: "Sahne (tiyatro)",
  "japanese-room": "Japon evi", "egypt-temple": "Mısır tapınağı", desert: "Çöl ve piramitler", village: "Köy", castle: "Kale salonu",
  "japanese-street": "Edo sokağı", "japanese-castle": "Japon şatosu", dojo: "Dojo", "egypt-market": "Mısır pazarı", "news-studio": "Haber stüdyosu", stadium: "Stadyum", space: "Uzay",
};

export const TIME_LABELS = { day: "Gündüz", sunset: "Gün batımı", night: "Gece" } as const;

export const CAMERA_LABELS: Record<CameraId, string> = {
  wide: "Geniş", medium: "Orta", close: "Yakın", "pan-left": "Sola kaydır", "pan-right": "Sağa kaydır",
  "zoom-in": "Yakınlaş", "zoom-out": "Uzaklaş", "punch-in": "Dramatik zoom (meme)",
};

export const VOICE_LABELS: Record<VoiceId, string> = {
  kadin: "Kadın",
  "kadin-olgun": "Kadın (olgun)",
  erkek: "Erkek",
  "erkek-kalin": "Erkek (kalın)",
  cocuk: "Çocuk",
};

export const TRANSITION_LABELS = { cut: "Kesme", fade: "Kararma" } as const;

export const ACTION_LABELS: Record<ActionId, string> = {
  idle: "Bekle", walk: "Yürü", run: "Koş", jump: "Zıpla", wave: "El salla", talk: "Konuş", point: "İşaret et",
  think: "Düşün", sit: "Otur", sleep: "Uyu", dance: "Dans et", cheer: "Sevin", cry: "Ağla", fall: "Düş",
  push: "İt", fight: "Kavga et", kick: "Şut çek", miss: "Iska (top uzaya)",
};

export const EMOTION_LABELS: Record<EmotionId, string> = {
  neutral: "Nötr", happy: "Mutlu", sad: "Üzgün", angry: "Kızgın", surprised: "Şaşkın", scared: "Korkmuş", thinking: "Düşünceli",
};

export const PROP_LABELS: Record<PropId, string> = {
  none: "Yok", phone: "Telefon", book: "Kitap", cup: "Fincan", ball: "Top", bag: "Çanta", flower: "Çiçek",
  laptop: "Dizüstü", umbrella: "Şemsiye", gift: "Hediye", sword: "Kılıç", lightbulb: "Fikir ampulü", heart: "Kalp", spear: "Mızrak",
  microphone: "Mikrofon", trophy: "Kupa", card: "Hakem kartı",
};

export const HAT_LABELS = {
  none: "Yok", beanie: "Bere", cap: "Kasket", crown: "Taç", bow: "Fiyonk", tophat: "Silindir", headband: "Mısır bandı", straw: "Hasır şapka",
} as const;

export const HAIR_LABELS = {
  none: "Kel", short: "Kısa", spiky: "Dikenli", curly: "Kıvırcık", bob: "Küt", long: "Uzun", ponytail: "At kuyruğu", bun: "Topuz", topknot: "Samuray topuzu",
} as const;

export const OUTFIT_LABELS = {
  casual: "Tişört ve pantolon", suit: "Takım elbise", dress: "Elbise", hoodie: "Kapüşonlu", labcoat: "Önlük",
  kimono: "Kimono", hakama: "Kimono ve hakama", tunic: "Mısır tuniği", toga: "Toga", armor: "Zırh", pelt: "Post (taş devri)", jersey: "Futbol forması", referee: "Hakem",
} as const;

export const t = tr;
