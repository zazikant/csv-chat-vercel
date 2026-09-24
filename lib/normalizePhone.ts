/**
 * normalizePhone — convert Excel's scientific-notation phone numbers back to
 * plain digit strings.
 *
 * Excel auto-converts large numbers (typically >11 digits) like
 *   971529000000   →   "9.71529E+11"
 *   9197152900000  →   "9.1971529E+12"
 * when exporting to CSV. This module detects that pattern and expands it
 * back to the original digit string.
 *
 * Edge cases handled:
 *   - "9.71529E+11"      → "971529000000"
 *   - "9.1971529E+12"    → "9197152900000"
 *   - "1.23E+10"         → "1230000000"
 *   - "-9.71529E+11"     → "-971529000000" (rare for phones, but consistent)
 *   - "9.71529e+11"      → "971529000000" (lowercase 'e')
 *   - "9.71529E11"       → "971529000000" (no sign)
 *   - Plain numbers and strings are returned unchanged (after trim).
 *
 * NOTE: Excel stores numbers with at most 15 significant digits. If the
 * original phone number had more than 15 digits, the trailing digits are
 * already lost in Excel and cannot be recovered — the expanded result will
 * have zeros in those positions. There's nothing we can do about that
 * here; the user should format the column as Text in Excel before export.
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Detect scientific notation: optional sign, mantissa (int or decimal),
  // 'e' or 'E', optional sign, integer exponent.
  const sci = s.match(/^([-+]?)\s*(\d+(?:\.\d+)?)\s*[eE]\s*([-+]?)\s*(\d+)$/);
  if (sci) {
    const [, sign, mantissa, expSign, expStr] = sci;
    const exp = (expSign === "-" ? -1 : 1) * parseInt(expStr, 10);

    const [intPart, fracPart = ""] = mantissa.split(".");
    const allDigits = intPart + fracPart;
    const decimalPos = intPart.length + exp;

    let digits: string;
    if (decimalPos <= 0) {
      // Number < 1 — phone numbers shouldn't land here, but expand anyway.
      digits = "0".repeat(-decimalPos) + allDigits;
    } else if (decimalPos >= allDigits.length) {
      // All digits left of decimal — pad with zeros on the right.
      digits = allDigits + "0".repeat(decimalPos - allDigits.length);
    } else {
      // Decimal point lands inside the digit string — phone numbers shouldn't
      // have fractional parts, so take only the integer portion.
      digits = allDigits.slice(0, decimalPos);
    }

    // Strip leading zeros (keep at least one digit).
    digits = digits.replace(/^0+/, "") || "0";

    s = (sign === "-" ? "-" : "") + digits;
  }

  return s;
}
