import "./globals.css";
import { AuthProvider } from "@/providers/AuthProvider";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { allMessages } from "@/i18n/messages";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Note: lang="en" is the SSR default; LocaleProvider swaps it on the client
  // once it reads localStorage / navigator.languages. This avoids a hydration
  // mismatch error.
  return (
    <html lang="en">
      <body>
        <LocaleProvider messages={allMessages}>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
