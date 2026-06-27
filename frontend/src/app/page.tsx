"use client";

import React, { useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import styles from "./landing.module.css";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";

const SWIPE_THRESHOLD = 60;
const NEXT_PATH = "/login";

export default function LandingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("landing");

  const startX = useRef<number | null>(null);
  const handledByTouch = useRef(false);
  const isNavigating = useRef(false);

  const goNext = () => {
    if (isNavigating.current) return;
    if (pathname === NEXT_PATH) return;
    isNavigating.current = true;
    router.push(NEXT_PATH);
  };

  return (
    <main
      className={styles.root}
      role="button"
      aria-label={t("ariaContinue")}
      tabIndex={0}
      onClick={() => {
        if (handledByTouch.current) {
          handledByTouch.current = false;
          return;
        }
        goNext();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
          e.preventDefault();
          goNext();
        }
      }}
      onTouchStart={(e) => {
        startX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        const endX = e.changedTouches[0].clientX;
        const diff = (startX.current ?? endX) - endX; // left swipe => positive
        if (diff > SWIPE_THRESHOLD) {
          handledByTouch.current = true;
          e.preventDefault();
          e.stopPropagation();
          goNext();
        }
        startX.current = null;
      }}
      onTouchCancel={() => {
        startX.current = null;
      }}
    >
      {/* Background layers */}
      <div className={styles.bg} aria-hidden="true">
        <span className={styles.orb1} />
        <span className={styles.orb2} />
        <span className={styles.orb3} />
        <span className={styles.grid} />
        <span className={styles.grain} />
        <span className={styles.vignette} />
      </div>

      {/* Language switcher — pinned top-right, doesn't trigger swipe handler */}
      <div
        style={{ position: "absolute", top: 16, right: 16, zIndex: 10 }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <LanguageSwitcher />
      </div>

      <div className={styles.shell}>
        <header className={styles.top}>
          <div className={styles.brand}>
            <div className={styles.mark} aria-hidden="true">
              <span className={styles.kanji}>道</span>
              <span className={styles.ring} />
            </div>
            <div className={styles.brandText}>
              <div className={styles.product}>BJJ Dojo Manager</div>
              <div className={styles.tag}>{t("tag")}</div>
            </div>
          </div>

          <div className={styles.pills} aria-hidden="true">
            <span className={styles.pill}>{t("pillTap")}</span>
            <span className={styles.pill}>{t("pillSwipe")}</span>
            <span className={styles.pill}>{t("pillEnter")}</span>
          </div>
        </header>

        <section className={styles.hero}>
          <p className={styles.kicker}>{t("kicker")}</p>

          <h1 className={styles.title}>
            <span className={styles.titleLine}>{t("titleLine1")}</span>
            <span className={styles.titleLine}>{t("titleLine2")}</span>
            <span className={styles.titleLineMuted}>{t("titleLineMuted")}</span>
          </h1>

          <p className={styles.sub}>{t("sub")}</p>

          <div className={styles.ctaWrap} aria-hidden="true">
            <div className={styles.ctaHint}>
              <span className={styles.ctaDot} />
              <span className={styles.ctaText}>{t("ctaHint")}</span>
            </div>

            <div className={styles.swipe}>
              <div className={styles.swipeTrack}>
                <div className={styles.swipeFill} />
              </div>
              <div className={styles.swipeRow}>
                <span className={styles.arrow} />
                <span className={styles.swipeText}>{t("swipeLeft")}</span>
              </div>
            </div>
          </div>
        </section>

        <footer className={styles.bottom}>
          <div className={styles.micro} aria-hidden="true">
            <span className={styles.microItem}>{t("microSecure")}</span>
            <span className={styles.microSep}>•</span>
            <span className={styles.microItem}>{t("microRoles")}</span>
            <span className={styles.microSep}>•</span>
            <span className={styles.microItem}>{t("microRealtime")}</span>
          </div>

          <p className={styles.a11y}>{t("a11y")}</p>
        </footer>
      </div>
    </main>
  );
}
