// src/i18n/config.ts
// Central configuration for next-intl (non-routing mode).
//
// Usage notes:
//   - We do NOT put locale in the URL. The user picks (or the browser picks for them)
//     and we persist in localStorage. This keeps Capacitor (iOS) friendly.
//   - To add a new locale later: add the code here AND drop a JSON file in messages/.

export const locales = ['en', 'ja'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
};

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

/**
 * Pick the best locale for a user given the browser's language list.
 * Falls back to defaultLocale.
 */
export function detectBrowserLocale(navigatorLanguages: readonly string[]): Locale {
  for (const lang of navigatorLanguages) {
    const lower = lang.toLowerCase();
    // Direct match (e.g. "ja", "en")
    if (isLocale(lower)) return lower;
    // Region match (e.g. "ja-JP" -> "ja", "en-US" -> "en")
    const base = lower.split('-')[0];
    if (isLocale(base)) return base;
  }
  return defaultLocale;
}
