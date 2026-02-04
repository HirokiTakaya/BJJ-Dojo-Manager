"use client";

import React, { useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import styles from "./landing.module.css";

const SWIPE_THRESHOLD = 60;
const NEXT_PATH = "/login";

export default function LandingPage() {
  const router = useRouter();
  const pathname = usePathname();

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
      aria-label="Continue to login"
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

      <div className={styles.shell}>
        <header className={styles.top}>
          <div className={styles.brand}>
            <div className={styles.mark} aria-hidden="true">
              <span className={styles.kanji}>道</span>
              <span className={styles.ring} />
            </div>
            <div className={styles.brandText}>
              <div className={styles.product}>Dojo Manager</div>
              <div className={styles.tag}>BJJ 운영을 더 빠르고 정확하게</div>
            </div>
          </div>

          <div className={styles.pills} aria-hidden="true">
            <span className={styles.pill}>Tap</span>
            <span className={styles.pill}>Swipe ←</span>
            <span className={styles.pill}>Enter</span>
          </div>
        </header>

        <section className={styles.hero}>
          <p className={styles.kicker}>OPERATE • TRACK • GROW</p>

          <h1 className={styles.title}>
            <span className={styles.titleLine}>Train</span>
            <span className={styles.titleLine}>Smarter.</span>
            <span className={styles.titleLineMuted}>Run the dojo like a product.</span>
          </h1>

          <p className={styles.sub}>
            Attendance, memberships, schedules, and staff workflows — streamlined for modern gyms.
          </p>

          <div className={styles.ctaWrap} aria-hidden="true">
            <div className={styles.ctaHint}>
              <span className={styles.ctaDot} />
              <span className={styles.ctaText}>Tap anywhere to continue</span>
            </div>

            <div className={styles.swipe}>
              <div className={styles.swipeTrack}>
                <div className={styles.swipeFill} />
              </div>
              <div className={styles.swipeRow}>
                <span className={styles.arrow} />
                <span className={styles.swipeText}>Swipe left</span>
              </div>
            </div>
          </div>
        </section>

        <footer className={styles.bottom}>
          <div className={styles.micro} aria-hidden="true">
            <span className={styles.microItem}>Secure auth</span>
            <span className={styles.microSep}>•</span>
            <span className={styles.microItem}>Role-based access</span>
            <span className={styles.microSep}>•</span>
            <span className={styles.microItem}>Realtime updates</span>
          </div>

          <p className={styles.a11y}>
            Tip: press Enter / Space to continue. Swipe left on mobile.
          </p>
        </footer>
      </div>
    </main>
  );
}
