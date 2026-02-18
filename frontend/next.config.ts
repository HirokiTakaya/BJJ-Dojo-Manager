import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Electron同梱では next/image 最適化を使わないケースが多い
  images: {
    unoptimized: true,
  },

  // ✅ 静的exportではなく、アプリ内でNextサーバーを動かす
  output: "standalone",

  // ここはあなたの方針でOK（本番はなるべくfalse推奨）
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
