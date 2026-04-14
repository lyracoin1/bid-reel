// ─── Haversine distance ────────────────────────────────────────────────────────

/** Returns the great-circle distance in metres between two coordinates. */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Format a distance in metres for display. Uses Arabic by default. */
export function formatDistance(metres: number, lang = "ar"): string {
  if (metres < 1000) {
    const m = Math.round(metres);
    return lang === "ar" ? `${m} م` : `${m} m`;
  }
  const km = metres / 1000;
  const str = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return lang === "ar" ? `${str} كم` : `${str} km`;
}

// ─── Country → currency mapping ───────────────────────────────────────────────

export interface CurrencyInfo {
  code: string;
  label: string;
  labelAr: string;
}

const COUNTRY_CURRENCY: Record<string, CurrencyInfo> = {
  // Arab world
  eg: { code: "EGP", label: "Egyptian Pound",     labelAr: "الجنيه المصري" },
  sa: { code: "SAR", label: "Saudi Riyal",         labelAr: "الريال السعودي" },
  ae: { code: "AED", label: "UAE Dirham",          labelAr: "الدرهم الإماراتي" },
  kw: { code: "KWD", label: "Kuwaiti Dinar",       labelAr: "الدينار الكويتي" },
  bh: { code: "BHD", label: "Bahraini Dinar",      labelAr: "الدينار البحريني" },
  qa: { code: "QAR", label: "Qatari Riyal",        labelAr: "الريال القطري" },
  om: { code: "OMR", label: "Omani Rial",          labelAr: "الريال العُماني" },
  jo: { code: "JOD", label: "Jordanian Dinar",     labelAr: "الدينار الأردني" },
  lb: { code: "LBP", label: "Lebanese Pound",      labelAr: "الليرة اللبنانية" },
  sy: { code: "SYP", label: "Syrian Pound",        labelAr: "الليرة السورية" },
  iq: { code: "IQD", label: "Iraqi Dinar",         labelAr: "الدينار العراقي" },
  ly: { code: "LYD", label: "Libyan Dinar",        labelAr: "الدينار الليبي" },
  tn: { code: "TND", label: "Tunisian Dinar",      labelAr: "الدينار التونسي" },
  dz: { code: "DZD", label: "Algerian Dinar",      labelAr: "الدينار الجزائري" },
  ma: { code: "MAD", label: "Moroccan Dirham",     labelAr: "الدرهم المغربي" },
  sd: { code: "SDG", label: "Sudanese Pound",      labelAr: "الجنيه السوداني" },
  ye: { code: "YER", label: "Yemeni Rial",         labelAr: "الريال اليمني" },
  ps: { code: "ILS", label: "Israeli New Shekel",  labelAr: "الشيكل الإسرائيلي" },
  // Other common
  us: { code: "USD", label: "US Dollar",           labelAr: "الدولار الأمريكي" },
  gb: { code: "GBP", label: "British Pound",       labelAr: "الجنيه الإسترليني" },
  tr: { code: "TRY", label: "Turkish Lira",        labelAr: "الليرة التركية" },
  pk: { code: "PKR", label: "Pakistani Rupee",     labelAr: "الروبية الباكستانية" },
  in: { code: "INR", label: "Indian Rupee",        labelAr: "الروبية الهندية" },
  ng: { code: "NGN", label: "Nigerian Naira",      labelAr: "النايرا النيجيرية" },
  ke: { code: "KES", label: "Kenyan Shilling",     labelAr: "الشلن الكيني" },
  ru: { code: "RUB", label: "Russian Ruble",       labelAr: "الروبل الروسي" },
  cn: { code: "CNY", label: "Chinese Yuan",        labelAr: "اليوان الصيني" },
  jp: { code: "JPY", label: "Japanese Yen",        labelAr: "الين الياباني" },
  au: { code: "AUD", label: "Australian Dollar",   labelAr: "الدولار الأسترالي" },
  ca: { code: "CAD", label: "Canadian Dollar",     labelAr: "الدولار الكندي" },
  ch: { code: "CHF", label: "Swiss Franc",         labelAr: "الفرنك السويسري" },
  // EUR fallback handled below
};

const EU_COUNTRIES = new Set([
  "at","be","cy","ee","fi","fr","de","gr","ie","it",
  "lv","lt","lu","mt","nl","pt","sk","si","es",
]);

const EUR: CurrencyInfo = { code: "EUR", label: "Euro", labelAr: "اليورو" };
const USD_FALLBACK: CurrencyInfo = { code: "USD", label: "US Dollar", labelAr: "الدولار الأمريكي" };

export function getCurrencyForCountry(countryCode: string): CurrencyInfo {
  const cc = countryCode.toLowerCase();
  if (EU_COUNTRIES.has(cc)) return EUR;
  return COUNTRY_CURRENCY[cc] ?? USD_FALLBACK;
}

// ─── Reverse geocoding (Nominatim — free, no key) ─────────────────────────────

/**
 * Returns a human-readable city/region name for the given coordinates.
 * Uses zoom=10 (city level) to get the most useful place name.
 * Returns null on error or when no recognisable place is found.
 */
export async function reverseGeocodeCity(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en", "User-Agent": "BidReel/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        suburb?: string;
        county?: string;
        state?: string;
      };
    };
    const addr = data.address;
    if (!addr) return null;
    const place = addr.city ?? addr.town ?? addr.village ?? addr.suburb ?? addr.county;
    if (!place) return addr.state ?? null;
    return place;
  } catch {
    return null;
  }
}

/** Returns the ISO 3166-1 alpha-2 country code (lower-case) for given coords. */
export async function reverseGeocodeCountry(lat: number, lng: number): Promise<string> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=3`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en", "User-Agent": "BidReel/1.0" },
    });
    if (!res.ok) return "us";
    const data = await res.json() as { address?: { country_code?: string } };
    return (data.address?.country_code ?? "us").toLowerCase();
  } catch {
    return "us";
  }
}

// ─── Price formatting ─────────────────────────────────────────────────────────

/**
 * Format a stored auction price using the creator's stored currency code.
 * No conversion — just format the raw number with its code.
 */
export function formatAuctionPrice(amount: number, currencyCode = "USD"): string {
  const formatted = new Intl.NumberFormat("en-US").format(Math.round(amount));
  return `${formatted} ${currencyCode}`;
}
