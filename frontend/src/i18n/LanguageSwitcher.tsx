"use client";

// src/i18n/LanguageSwitcher.tsx
// Drop-in language switcher. Lightweight <select> by default — keeps mobile UX clean.
// Pass `variant="buttons"` if you want side-by-side toggles instead.

import React from 'react';
import { useLocale } from './LocaleProvider';
import { locales, localeNames, type Locale } from './config';

type Variant = 'select' | 'buttons';

type Props = {
  variant?: Variant;
  className?: string;
};

export function LanguageSwitcher({ variant = 'select', className = '' }: Props) {
  const { locale, setLocale } = useLocale();

  if (variant === 'buttons') {
    return (
      <div className={`flex gap-1 ${className}`} role="group" aria-label="Language">
        {locales.map((l) => {
          const active = l === locale;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              aria-pressed={active}
              className={
                active
                  ? 'px-2 py-1 text-xs rounded bg-black text-white'
                  : 'px-2 py-1 text-xs rounded bg-gray-200 text-gray-800 hover:bg-gray-300'
              }
            >
              {l.toUpperCase()}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className={`text-sm bg-transparent border border-gray-300 rounded px-2 py-1 ${className}`}
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {localeNames[l]}
        </option>
      ))}
    </select>
  );
}
