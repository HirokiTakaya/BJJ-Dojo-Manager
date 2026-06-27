// src/i18n/request.ts
//
// next-intl の SSR / 静的生成用設定。
// このファイルは Server Component で useTranslations() / getTranslations() を
// 使えるようにするために必要です。
// LocaleProvider (Client) と組み合わせて動作します。
//
// SSR/build 時はデフォルトロケール (en) で実行され、
// クライアント側で LocaleProvider が hydrate 時に正しいロケールに切り替えます。

import { getRequestConfig } from "next-intl/server";
import { defaultLocale } from "./config";
import { messages as allMessages } from "./messages";

export default getRequestConfig(async () => {
  // SSR/build 時は常に defaultLocale を使う。
  // クライアントの LocaleProvider が hydrate 後に正しい locale に切り替える。
  const locale = defaultLocale;

  return {
    locale,
    messages: allMessages[locale],
  };
});