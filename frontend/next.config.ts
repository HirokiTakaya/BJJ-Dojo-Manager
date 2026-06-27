import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl プラグイン:
// src/i18n/request.ts を SSR 用設定として読み込む
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },

  output: "standalone",

  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withNextIntl(nextConfig);