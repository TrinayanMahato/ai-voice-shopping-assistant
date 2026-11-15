// ─────────────────────────────────────────────────────────────────────────────
// parseAuth — pull a mobile number / OTP out of free-form user text.
//
// The in-transcript verification lets people answer naturally, e.g.
//   "my phone number is 98765 43210"   → "9876543210"
//   "sure, the otp is 1 2 3 4 5 6"      → "123456"
//   "123456"                            → "123456"
// so we can't assume the input is just digits.
// ─────────────────────────────────────────────────────────────────────────────

// Best-effort mobile number. Strips everything non-numeric, drops an optional
// leading country/trunk code (e.g. +91, 0091, 0) and returns the trailing
// 10-digit local number — or null if there aren't 10 digits to work with.
export function extractPhone(text) {
  if (!text) return null;
  const digits = String(text).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return local.length === 10 ? local : null;
}

// Best-effort OTP. Prefers a contiguous 4–8 digit run (typical of an OTP sitting
// inside a sentence); falls back to spaced/dashed digits ("1 2 3 4 5 6").
export function extractOtp(text) {
  if (!text) return null;
  const raw = String(text);
  const run = raw.match(/\d{4,8}/);
  if (run) return run[0];
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 4 && digits.length <= 8 ? digits : null;
}

// "9876543210" → "•••••• 3210" for a friendly, privacy-safe confirmation line.
export function maskPhone(mobile) {
  return mobile && mobile.length === 10 ? `•••••• ${mobile.slice(-4)}` : mobile;
}
