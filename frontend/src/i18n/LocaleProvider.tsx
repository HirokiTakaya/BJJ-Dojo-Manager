"use client";

// src/i18n/LocaleProvider.tsx
// Client-side locale state + next-intl provider. Non-routing mode:
//  - locale lives in React state (not URL)
//  - persisted via localStorage on user toggle
//  - on first run, falls back to navigator.languages -> browser detect
//  - dynamically updates <html lang="..."> for accessibility / SEO

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { NextIntlClientProvider } from 'next-intl';
import {
  defaultLocale,
  detectBrowserLocale,
  isLocale,
  type Locale,
} from './config';

const STORAGE_KEY = 'dojo.locale';

type Ctx = {
  locale: Locale;
  setLocale: (loc: Locale) => void;
};

const LocaleCtx = createContext<Ctx>({
  locale: defaultLocale,
  setLocale: () => {},
});

type Messages = Record<string, unknown>;
type AllMessages = Record<Locale, Messages>;

export function LocaleProvider({
  children,
  messages,
}: {
  children: React.ReactNode;
  messages: AllMessages;
}) {
  // SSR-safe initial value: always defaultLocale.
  // Real detection happens in useEffect (client only).
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Read persisted choice first
    let chosen: Locale = defaultLocale;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(saved)) {
        chosen = saved;
      } else if (typeof navigator !== 'undefined') {
        chosen = detectBrowserLocale(navigator.languages ?? [navigator.language]);
      }
    } catch {
      // localStorage may be unavailable (private mode, etc) — fall through
    }
    setLocaleState(chosen);
    setHydrated(true);
  }, []);

  // Keep <html lang> in sync
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((loc: Locale) => {
    setLocaleState(loc);
    try {
      window.localStorage.setItem(STORAGE_KEY, loc);
    } catch {
      // ignore
    }
  }, []);

  const ctxValue = useMemo<Ctx>(() => ({ locale, setLocale }), [locale, setLocale]);

  // Avoid a flash of wrong-locale text on first paint by waiting for hydration.
  // We still render children either way to avoid a blocking spinner.
  const activeMessages = messages[locale] ?? messages[defaultLocale];

  return (
    <LocaleCtx.Provider value={ctxValue}>
      <NextIntlClientProvider
        locale={locale}
        messages={activeMessages as Messages}
        // The app uses Date.now() in many places; keep timeZone explicit-free
        // so user's machine time zone is used (which is what dojos want).
      >
        {/* hydrated flag is intentionally not gating render — first paint shows
            English (default) and swaps once hydrated. This is the standard
            non-routing pattern and avoids layout shift for logged-in users. */}
        <span data-i18n-hydrated={hydrated ? '1' : '0'} hidden />
        {children}
      </NextIntlClientProvider>
    </LocaleCtx.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleCtx);
}
