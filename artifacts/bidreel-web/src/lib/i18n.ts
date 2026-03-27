export type Language = "en" | "ar" | "ru" | "es" | "fr";
export type Direction = "ltr" | "rtl";
export type CurrencyMode = "usd" | "local";

/** Per-language local currency display info */
export const CURRENCY_MAP: Record<Language, { flag: string; symbol: string; after: boolean }> = {
  en: { flag: "🇺🇸", symbol: "$",    after: false }, // $500
  ar: { flag: "🇸🇦", symbol: "ر.س", after: true  }, // 500 ر.س
  ru: { flag: "🇷🇺", symbol: "₽",    after: true  }, // 500 ₽
  es: { flag: "🇪🇸", symbol: "€",    after: true  }, // 500 €
  fr: { flag: "🇫🇷", symbol: "€",    after: true  }, // 500 €
};

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  ar: "العربية",
  ru: "Русский",
  es: "Español",
  fr: "Français",
};

export const LANGUAGE_DIR: Record<Language, Direction> = {
  en: "ltr",
  ar: "rtl",
  ru: "ltr",
  es: "ltr",
  fr: "ltr",
};

export type TKey =
  // Nav
  | "nav_feed" | "nav_explore" | "nav_sell" | "nav_profile"
  // Feed card
  | "share" | "chat" | "bid" | "bids_count" | "ended"
  // Auction detail
  | "current_bid" | "whatsapp_cta" | "about" | "bid_history"
  | "no_bids" | "place_bid" | "auction_closed" | "leading"
  | "min_bid" | "confirm_bid" | "processing" | "outbid"
  | "contact_seller"
  // Create
  | "new_listing" | "step_1_label" | "step_2_label"
  | "upload_hint" | "video" | "photos"
  | "tap_to_select_video" | "tap_to_select_photos"
  | "record_now" | "continue" | "add_photos"
  | "item_title" | "item_title_placeholder"
  | "starting_bid" | "description" | "description_placeholder"
  | "publish" | "publishing" | "auction_duration_title" | "auction_duration_body"
  | "authenticity_note"
  // Profile
  | "listings" | "my_bids" | "bids_won" | "rating" | "log_out" | "language"
  | "no_listings" | "create_first" | "settings"
  // Currency
  | "currency_mode" | "currency_usd" | "currency_local"
  // Follow
  | "follow" | "following"
  // Auction states
  | "starts_in" | "upcoming_badge" | "final_price" | "remind_me" | "reminded"
  | "bid_opens_soon" | "winner" | "starting_at"
  // Search / Explore
  | "search_placeholder" | "no_results" | "search_hint"
  // Interests onboarding
  | "interests_title" | "interests_subtitle" | "interests_skip" | "interests_done"
  // Time
  | "time_ended" | "time_s" | "time_m" | "time_h" | "time_d";

type Translations = Record<TKey, string>;

const en: Translations = {
  nav_feed: "Feed", nav_explore: "Explore", nav_sell: "Sell", nav_profile: "Profile",
  share: "Share", chat: "Chat", bid: "Bid", bids_count: "bids", ended: "Ended",
  current_bid: "current bid", whatsapp_cta: "Message Seller on WhatsApp",
  about: "About", bid_history: "Bid History", no_bids: "No bids yet — be the first!",
  place_bid: "Place a Bid", auction_closed: "Auction Closed", leading: "Leading",
  min_bid: "Minimum bid", confirm_bid: "Confirm Bid", processing: "Processing…",
  outbid: "Outbid", contact_seller: "Contact Seller",
  new_listing: "New Listing", step_1_label: "Upload your content", step_2_label: "Add listing details",
  upload_hint: "Upload a short vertical video (up to 60 seconds) showing off your item.",
  video: "Video", photos: "Photos",
  tap_to_select_video: "Tap to select video", tap_to_select_photos: "Tap to select photos",
  record_now: "Record Now", continue: "Continue", add_photos: "Add Photos",
  item_title: "Item Title", item_title_placeholder: "e.g. Vintage Rolex Submariner",
  starting_bid: "Starting Bid", description: "Description",
  description_placeholder: "Condition, history, included accessories…",
  publish: "Publish Auction", publishing: "Publishing…",
  auction_duration_title: "3-day auction",
  auction_duration_body: "Your listing runs for exactly 72 hours. The winner contacts you via WhatsApp.",
  authenticity_note: "By listing, you confirm this item is authentic and accurately described.",
  listings: "Listings", my_bids: "My Bids", bids_won: "Bids Won", rating: "Rating",
  log_out: "Log Out", language: "Language",
  no_listings: "No listings yet.", create_first: "Create your first listing", settings: "Settings",
  time_ended: "Ended", time_s: "s", time_m: "m left", time_h: "h left", time_d: "d left",
  currency_mode: "Currency", currency_usd: "USD ($)", currency_local: "Local Currency",
  follow: "Follow", following: "Following",
  starts_in: "Starts in", upcoming_badge: "Upcoming", final_price: "Final Price",
  remind_me: "Remind Me", reminded: "Reminded ✓", bid_opens_soon: "Bidding opens soon",
  winner: "Winner", starting_at: "Starting at",
  search_placeholder: "Search for anything…", no_results: "No results found", search_hint: "Try a title or description",
  interests_title: "Choose what interests you", interests_subtitle: "Select topics you'd love to bid on",
  interests_skip: "Skip", interests_done: "Done",
};

const ar: Translations = {
  nav_feed: "الرئيسية", nav_explore: "استكشاف", nav_sell: "بيع", nav_profile: "الملف الشخصي",
  share: "مشاركة", chat: "دردشة", bid: "مزايدة", bids_count: "مزايدات", ended: "انتهى",
  current_bid: "المزايدة الحالية", whatsapp_cta: "مراسلة البائع عبر واتساب",
  about: "عن العنصر", bid_history: "سجل المزايدات", no_bids: "لا توجد مزايدات بعد — كن الأول!",
  place_bid: "ضع مزايدتك", auction_closed: "المزاد مغلق", leading: "في الصدارة",
  min_bid: "الحد الأدنى للمزايدة", confirm_bid: "تأكيد المزايدة", processing: "جارٍ المعالجة…",
  outbid: "تجاوزتك مزايدة", contact_seller: "تواصل مع البائع",
  new_listing: "إدراج جديد", step_1_label: "ارفع المحتوى", step_2_label: "أضف تفاصيل الإدراج",
  upload_hint: "ارفع مقطع فيديو رأسي قصير (حتى 60 ثانية) يعرض العنصر.",
  video: "فيديو", photos: "صور",
  tap_to_select_video: "انقر لاختيار فيديو", tap_to_select_photos: "انقر لاختيار صور",
  record_now: "تسجيل الآن", continue: "متابعة", add_photos: "إضافة صور",
  item_title: "عنوان العنصر", item_title_placeholder: "مثال: ساعة رولكس كلاسيكية",
  starting_bid: "سعر البداية", description: "الوصف",
  description_placeholder: "الحالة، التاريخ، الملحقات المشمولة…",
  publish: "نشر المزاد", publishing: "جارٍ النشر…",
  auction_duration_title: "مزاد لمدة 3 أيام",
  auction_duration_body: "ينتهي إدراجك خلال 72 ساعة بالضبط. الفائز يتواصل معك عبر واتساب.",
  authenticity_note: "بالإدراج تؤكد أن العنصر أصلي وموصوف بدقة.",
  listings: "الإدراجات", my_bids: "مزايداتي", bids_won: "مزايدات فائزة", rating: "التقييم",
  log_out: "تسجيل الخروج", language: "اللغة",
  no_listings: "لا توجد إدراجات بعد.", create_first: "أنشئ إدراجك الأول", settings: "الإعدادات",
  time_ended: "انتهى", time_s: "ث", time_m: "د متبقية", time_h: "س متبقية", time_d: "ي متبقية",
  currency_mode: "العملة", currency_usd: "دولار أمريكي ($)", currency_local: "العملة المحلية",
  follow: "متابعة", following: "تتابعه",
  starts_in: "يبدأ في", upcoming_badge: "قادم", final_price: "السعر النهائي",
  remind_me: "ذكّرني", reminded: "تم التذكير ✓", bid_opens_soon: "المزايدة تفتح قريباً",
  winner: "الفائز", starting_at: "يبدأ من",
  search_placeholder: "ابحث عن أي منتج...", no_results: "لا توجد نتائج", search_hint: "ابحث بالعنوان أو الوصف",
  interests_title: "اختر ما يهمك", interests_subtitle: "حدد مواضيع تريد المزايدة عليها",
  interests_skip: "تخطى", interests_done: "تم",
};

const ru: Translations = {
  nav_feed: "Лента", nav_explore: "Обзор", nav_sell: "Продать", nav_profile: "Профиль",
  share: "Поделиться", chat: "Чат", bid: "Ставка", bids_count: "ставок", ended: "Завершён",
  current_bid: "текущая ставка", whatsapp_cta: "Написать продавцу в WhatsApp",
  about: "О лоте", bid_history: "История ставок", no_bids: "Ставок нет — будьте первым!",
  place_bid: "Сделать ставку", auction_closed: "Аукцион закрыт", leading: "Лидирует",
  min_bid: "Минимальная ставка", confirm_bid: "Подтвердить ставку", processing: "Обработка…",
  outbid: "Перебит", contact_seller: "Связаться с продавцом",
  new_listing: "Новый лот", step_1_label: "Загрузите контент", step_2_label: "Добавьте детали",
  upload_hint: "Загрузите короткое вертикальное видео (до 60 секунд) с вашим товаром.",
  video: "Видео", photos: "Фото",
  tap_to_select_video: "Выбрать видео", tap_to_select_photos: "Выбрать фото",
  record_now: "Записать", continue: "Далее", add_photos: "Добавить фото",
  item_title: "Название лота", item_title_placeholder: "Например: Rolex Submariner",
  starting_bid: "Начальная ставка", description: "Описание",
  description_placeholder: "Состояние, история, что входит в комплект…",
  publish: "Опубликовать аукцион", publishing: "Публикация…",
  auction_duration_title: "Аукцион на 3 дня",
  auction_duration_body: "Лот активен ровно 72 часа. Победитель свяжется с вами через WhatsApp.",
  authenticity_note: "Размещая лот, вы подтверждаете его подлинность и правильность описания.",
  listings: "Лоты", my_bids: "Мои ставки", bids_won: "Выиграно", rating: "Рейтинг",
  log_out: "Выйти", language: "Язык",
  no_listings: "Нет лотов.", create_first: "Создать первый лот", settings: "Настройки",
  time_ended: "Завершён", time_s: "с", time_m: "м осталось", time_h: "ч осталось", time_d: "д осталось",
  currency_mode: "Валюта", currency_usd: "USD ($)", currency_local: "Местная валюта",
  follow: "Подписаться", following: "Подписан",
  starts_in: "Начнётся через", upcoming_badge: "Скоро", final_price: "Финальная цена",
  remind_me: "Напомнить", reminded: "Напомнено ✓", bid_opens_soon: "Торги откроются скоро",
  winner: "Победитель", starting_at: "Старт от",
  search_placeholder: "Поиск товаров…", no_results: "Ничего не найдено", search_hint: "Попробуйте название или описание",
  interests_title: "Выберите интересы", interests_subtitle: "Темы, на которые вы хотите делать ставки",
  interests_skip: "Пропустить", interests_done: "Готово",
};

const es: Translations = {
  nav_feed: "Inicio", nav_explore: "Explorar", nav_sell: "Vender", nav_profile: "Perfil",
  share: "Compartir", chat: "Chat", bid: "Pujar", bids_count: "pujas", ended: "Finalizado",
  current_bid: "puja actual", whatsapp_cta: "Contactar al vendedor por WhatsApp",
  about: "Acerca del artículo", bid_history: "Historial de pujas", no_bids: "Sin pujas aún — ¡sé el primero!",
  place_bid: "Realizar una puja", auction_closed: "Subasta cerrada", leading: "Ganando",
  min_bid: "Puja mínima", confirm_bid: "Confirmar puja", processing: "Procesando…",
  outbid: "Superado", contact_seller: "Contactar al vendedor",
  new_listing: "Nuevo anuncio", step_1_label: "Sube tu contenido", step_2_label: "Añade detalles",
  upload_hint: "Sube un vídeo vertical corto (hasta 60 segundos) mostrando tu artículo.",
  video: "Vídeo", photos: "Fotos",
  tap_to_select_video: "Seleccionar vídeo", tap_to_select_photos: "Seleccionar fotos",
  record_now: "Grabar ahora", continue: "Continuar", add_photos: "Añadir fotos",
  item_title: "Título del artículo", item_title_placeholder: "Ej: Rolex Submariner vintage",
  starting_bid: "Puja inicial", description: "Descripción",
  description_placeholder: "Estado, historial, accesorios incluidos…",
  publish: "Publicar subasta", publishing: "Publicando…",
  auction_duration_title: "Subasta de 3 días",
  auction_duration_body: "Tu anuncio estará activo exactamente 72 horas. El ganador te contacta por WhatsApp.",
  authenticity_note: "Al publicar confirmas que el artículo es auténtico y está bien descrito.",
  listings: "Anuncios", my_bids: "Mis pujas", bids_won: "Pujas ganadas", rating: "Valoración",
  log_out: "Cerrar sesión", language: "Idioma",
  no_listings: "Sin anuncios aún.", create_first: "Crea tu primer anuncio", settings: "Ajustes",
  time_ended: "Finalizado", time_s: "s", time_m: "m restante", time_h: "h restante", time_d: "d restante",
  currency_mode: "Moneda", currency_usd: "USD ($)", currency_local: "Moneda local",
  follow: "Seguir", following: "Siguiendo",
  starts_in: "Empieza en", upcoming_badge: "Próximamente", final_price: "Precio final",
  remind_me: "Recuérdame", reminded: "Recordado ✓", bid_opens_soon: "Las pujas abren pronto",
  winner: "Ganador", starting_at: "Sale desde",
  search_placeholder: "Buscar cualquier producto…", no_results: "Sin resultados", search_hint: "Prueba con un título o descripción",
  interests_title: "Elige tus intereses", interests_subtitle: "Selecciona temas en los que quieres pujar",
  interests_skip: "Saltar", interests_done: "Hecho",
};

const fr: Translations = {
  nav_feed: "Fil", nav_explore: "Explorer", nav_sell: "Vendre", nav_profile: "Profil",
  share: "Partager", chat: "Chat", bid: "Enchérir", bids_count: "enchères", ended: "Terminé",
  current_bid: "enchère actuelle", whatsapp_cta: "Contacter le vendeur sur WhatsApp",
  about: "À propos", bid_history: "Historique", no_bids: "Pas d'enchères — soyez le premier !",
  place_bid: "Placer une enchère", auction_closed: "Vente clôturée", leading: "En tête",
  min_bid: "Enchère minimale", confirm_bid: "Confirmer l'enchère", processing: "Traitement…",
  outbid: "Surenchéri", contact_seller: "Contacter le vendeur",
  new_listing: "Nouvelle annonce", step_1_label: "Téléchargez votre contenu", step_2_label: "Ajoutez les détails",
  upload_hint: "Téléchargez une courte vidéo verticale (max 60 secondes) présentant votre article.",
  video: "Vidéo", photos: "Photos",
  tap_to_select_video: "Sélectionner une vidéo", tap_to_select_photos: "Sélectionner des photos",
  record_now: "Enregistrer", continue: "Continuer", add_photos: "Ajouter des photos",
  item_title: "Titre de l'article", item_title_placeholder: "Ex : Rolex Submariner vintage",
  starting_bid: "Mise de départ", description: "Description",
  description_placeholder: "État, historique, accessoires inclus…",
  publish: "Publier l'enchère", publishing: "Publication…",
  auction_duration_title: "Vente aux enchères 3 jours",
  auction_duration_body: "Votre annonce est active pendant 72 heures. Le gagnant vous contacte par WhatsApp.",
  authenticity_note: "En publiant, vous confirmez que l'article est authentique et correctement décrit.",
  listings: "Annonces", my_bids: "Mes enchères", bids_won: "Enchères gagnées", rating: "Note",
  log_out: "Se déconnecter", language: "Langue",
  no_listings: "Aucune annonce.", create_first: "Créer votre première annonce", settings: "Paramètres",
  time_ended: "Terminé", time_s: "s", time_m: "m restant", time_h: "h restant", time_d: "j restant",
  currency_mode: "Devise", currency_usd: "USD ($)", currency_local: "Devise locale",
  follow: "Suivre", following: "Abonné",
  starts_in: "Débute dans", upcoming_badge: "À venir", final_price: "Prix final",
  remind_me: "Me rappeler", reminded: "Rappelé ✓", bid_opens_soon: "Les enchères ouvrent bientôt",
  winner: "Gagnant", starting_at: "Départ à",
  search_placeholder: "Rechercher un produit…", no_results: "Aucun résultat", search_hint: "Essayez un titre ou une description",
  interests_title: "Choisissez vos intérêts", interests_subtitle: "Sélectionnez les sujets sur lesquels vous souhaitez enchérir",
  interests_skip: "Ignorer", interests_done: "Terminer",
};

export const TRANSLATIONS: Record<Language, Translations> = { en, ar, ru, es, fr };
