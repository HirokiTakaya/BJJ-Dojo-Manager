// src/i18n/messages.ts
// Aggregator that bundles all locale JSON into a single object the
// LocaleProvider can hand to next-intl. We import statically so the
// messages end up in the bundle (works with static export & Capacitor).

import en from '../../messages/en.json';
import ja from '../../messages/ja.json';
import type { Locale } from './config';

export const allMessages: Record<Locale, Record<string, unknown>> = {
  en,
  ja,
};
