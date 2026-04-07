/**
 * Phone number normalisation — shared across auth routes.
 *
 * Handles the following input formats:
 *   - E.164 already:   "+14155550001"  →  "+14155550001"
 *   - 00-prefix:       "00201060088141" → "+201060088141"
 *   - Local Egyptian:  "01060088141"   →  "+201060088141"
 *   - Bare digits:     "14155550001"   →  "+14155550001"
 *
 * Egyptian/Arab mobile numbers (starting with 0, 9-10 trailing digits) are
 * assumed to use +20 (Egypt). All other digit-only inputs get a bare "+"
 * prefix — callers must include their country code for non-Egyptian numbers.
 */
export function normalizePhoneNumber(raw: string): string {
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, "");

  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);

  // Local format: starts with 0 and has 9-11 digits → strip leading 0, add +20
  if (/^0\d{9,10}$/.test(cleaned)) {
    return "+20" + cleaned.slice(1);
  }

  // Bare digits — assume the caller included the country code without "+"
  return "+" + cleaned;
}

export const E164_REGEX = /^\+[1-9]\d{7,14}$/;
