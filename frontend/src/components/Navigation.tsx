"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { auth } from "@/firebase";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";

// NavItem now uses a translation key instead of a hardcoded label.
// labelKey is looked up under the "navigation" namespace.
export type NavItem = {
  id: string;
  labelKey: string;
  icon: string;
  href: string | ((dojoId: string) => string);
  staffOnly?: boolean;
  studentOnly?: boolean;
};

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { id: "home", labelKey: "home", icon: "🏠", href: "/home" },
  {
    id: "timetable",
    labelKey: "timetable",
    icon: "📅",
    href: (dojoId) => `/dojos/${dojoId}/timetable`,
  },
  {
    id: "notices-staff",
    labelKey: "inbox",
    icon: "📣",
    href: (dojoId) => `/dojos/${dojoId}/notices`,
    staffOnly: true,
  },
  {
    id: "inbox",
    labelKey: "inbox",
    icon: "✉️",
    href: (dojoId) => `/dojos/${dojoId}/inbox`,
    studentOnly: true,
  },
  // ✅ Tuition (member-facing monthly fee page)
  {
    id: "tuition",
    labelKey: "tuition",
    icon: "💴",
    href: (dojoId) => `/dojos/${dojoId}/tuition`,
    studentOnly: true,
  },
  // ✅ NEW: Tuition management for owner/staff (plan creation & payment status)
  // Placed BEFORE billing/settings so the mobile center label resolves to
  // "Tuition" on /settings/tuition (find() picks the first active item).
  {
    id: "tuition-staff",
    labelKey: "tuition",
    icon: "💴",
    href: (dojoId) => `/dojos/${dojoId}/settings/tuition`,
    staffOnly: true,
  },
  {
    id: "members",
    labelKey: "members",
    icon: "👥",
    href: (dojoId) => `/dojos/${dojoId}/members`,
    staffOnly: true,
  },
  // Billing first so the mobile center label shows "Billing" on /settings/billing
  {
    id: "billing",
    labelKey: "settings",
    icon: "💳",
    href: (dojoId) => `/dojos/${dojoId}/settings/billing`,
    staffOnly: true,
  },
  {
    id: "settings",
    labelKey: "settings",
    icon: "⚙️",
    href: (dojoId) => `/dojos/${dojoId}/settings`,
    staffOnly: true,
  },
  { id: "profile", labelKey: "profile", icon: "👤", href: "/profile" },
];

type NavigationProps = {
  dojoId?: string | null;
  isStaff?: boolean;
  userName?: string;
  userEmail?: string;
  customItems?: NavItem[];
};

// Derive dojoId from pathname when the prop wasn't passed.
// e.g. /dojos/ABC123/timetable -> ABC123
// Excludes fixed route names like /dojos/search, /dojos/attendance-dashboard.
function deriveDojoIdFromPathname(pathname?: string | null): string | null {
  if (!pathname) return null;

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] !== "dojos") return null;

  const candidate = parts[1];
  if (!candidate) return null;

  const RESERVED = new Set(["search", "attendance-dashboard", "members"]);
  if (RESERVED.has(candidate)) return null;

  return candidate;
}

export default function Navigation({
  dojoId,
  isStaff = false,
  userName,
  userEmail,
  customItems,
}: NavigationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("navigation");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = customItems || DEFAULT_NAV_ITEMS;

  // Fallback dojoId: prop first, otherwise derived from pathname.
  const effectiveDojoId = useMemo(() => {
    return dojoId ?? deriveDojoIdFromPathname(pathname);
  }, [dojoId, pathname]);

  const filteredItems = navItems.filter((item) => {
    if (item.staffOnly && !isStaff) return false;
    if (item.studentOnly && isStaff) return false;
    return true;
  });

  const getHref = useCallback(
    (item: NavItem): string | null => {
      if (typeof item.href === "string") {
        return item.href;
      }
      if (effectiveDojoId) {
        return item.href(effectiveDojoId);
      }
      return null;
    },
    [effectiveDojoId]
  );

  const isActive = useCallback(
    (item: NavItem): boolean => {
      const href = getHref(item);
      if (!href || !pathname) return false;

      if (pathname === href) return true;
      if (item.id !== "home" && pathname.startsWith(href)) return true;

      return false;
    },
    [getHref, pathname]
  );

  const handleNav = useCallback(
    (item: NavItem) => {
      const href = getHref(item);
      if (href) {
        router.push(href);
        setMobileMenuOpen(false);
      }
    },
    [getHref, router]
  );

  const handleSignOut = useCallback(async () => {
    await auth.signOut();
    router.replace("/login");
  }, [router]);

  // Helper: pull the translated label for an item. Falls back to the key
  // itself if missing — keeps the UI usable while a translation is added.
  const getLabel = (item: NavItem) => {
    try {
      return t(item.labelKey as any);
    } catch {
      return item.labelKey;
    }
  };

  return (
    <>
      {/* Desktop Navigation Bar */}
      <nav className="hidden md:block sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            {/* Left: Nav Items */}
            <div className="flex items-center gap-1">
              {filteredItems.map((item) => {
                const href = getHref(item);
                const active = isActive(item);
                const disabled = !href;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleNav(item)}
                    disabled={disabled}
                    className={[
                      "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      active
                        ? "bg-slate-900 text-white"
                        : disabled
                        ? "text-slate-400 cursor-not-allowed"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    ].join(" ")}
                  >
                    <span className="text-base">{item.icon}</span>
                    <span>{getLabel(item)}</span>
                  </button>
                );
              })}
            </div>

            {/* Right: User Info, Language, Sign Out */}
            <div className="flex items-center gap-3">
              {(userName || userEmail) && (
                <div className="text-sm text-slate-600">
                  <span className="font-medium text-slate-900">{userName || userEmail}</span>
                  {isStaff && (
                    <span className="ml-2 px-2 py-0.5 text-xs font-semibold rounded-full bg-violet-100 text-violet-700">
                      Staff
                    </span>
                  )}
                </div>
              )}
              <LanguageSwitcher />
              <button
                onClick={handleSignOut}
                className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
              >
                {t("signOut")}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation Bar */}
      <nav className="md:hidden sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="flex items-center justify-between h-14 px-4">
          {/* Hamburger Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? t("closeMenu") : t("openMenu")}
            className="p-2 rounded-lg hover:bg-slate-100 transition-all"
          >
            <svg className="w-6 h-6 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          {/* Center: Current Page */}
          <div className="font-semibold text-slate-900">
            {(() => {
              const active = filteredItems.find((item) => isActive(item));
              return active ? getLabel(active) : t("menu");
            })()}
          </div>

          {/* Right: Sign Out */}
          <button
            onClick={handleSignOut}
            aria-label={t("signOut")}
            className="p-2 rounded-lg hover:bg-slate-100 transition-all"
          >
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="absolute top-14 left-0 right-0 bg-white border-b border-slate-200 shadow-lg">
            <div className="p-2">
              {filteredItems.map((item) => {
                const href = getHref(item);
                const active = isActive(item);
                const disabled = !href;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleNav(item)}
                    disabled={disabled}
                    className={[
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all",
                      active
                        ? "bg-slate-900 text-white"
                        : disabled
                        ? "text-slate-400 cursor-not-allowed"
                        : "text-slate-700 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    <span className="text-xl">{item.icon}</span>
                    <span className="font-medium">{getLabel(item)}</span>
                  </button>
                );
              })}

              {/* Language switcher inside mobile menu */}
              <div className="mt-2 px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-sm text-slate-600">🌐</span>
                <LanguageSwitcher />
              </div>

              {/* User Info */}
              {(userName || userEmail) && (
                <div className="px-4 py-3 border-t border-slate-100">
                  <div className="text-sm text-slate-600">
                    <span className="font-semibold text-slate-900">{userName || userEmail}</span>
                  </div>
                  {isStaff && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-violet-100 text-violet-700">
                      Staff
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/20" onClick={() => setMobileMenuOpen(false)} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Simple bottom navigation (alternative for mobile)
// ─────────────────────────────────────────────────────────────
export function BottomNavigation({
  dojoId,
  isStaff = false,
}: {
  dojoId?: string | null;
  isStaff?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("navigation");

  const effectiveDojoId = useMemo(() => {
    return dojoId ?? deriveDojoIdFromPathname(pathname);
  }, [dojoId, pathname]);

  const items = [
    { id: "home", label: t("home"), icon: "🏠", href: "/home" },
    {
      id: "timetable",
      label: t("timetable"),
      icon: "📅",
      href: effectiveDojoId ? `/dojos/${effectiveDojoId}/timetable` : null,
    },
    {
      id: "notices",
      label: t("inbox"),
      icon: isStaff ? "📣" : "✉️",
      href: effectiveDojoId ? `/dojos/${effectiveDojoId}/${isStaff ? "notices" : "inbox"}` : null,
    },
    // ✅ Tuition tab for everyone:
    //   members -> payment page (/tuition)
    //   staff   -> tuition management (/settings/tuition)
    {
      id: "tuition",
      label: t("tuition"),
      icon: "💴",
      href: effectiveDojoId
        ? `/dojos/${effectiveDojoId}/${isStaff ? "settings/tuition" : "tuition"}`
        : null,
    },
    { id: "profile", label: t("profile"), icon: "👤", href: "/profile" },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 safe-area-pb">
      <div className="flex items-center justify-around h-16">
        {items.map((item) => {
          const active = pathname === item.href || (item.href && pathname?.startsWith(item.href));
          const disabled = !item.href;

          return (
            <button
              key={item.id}
              onClick={() => item.href && router.push(item.href)}
              disabled={disabled}
              className={[
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all",
                active
                  ? "text-slate-900"
                  : disabled
                  ? "text-slate-300"
                  : "text-slate-500",
              ].join(" ")}
            >
              <span className={["text-xl", active ? "scale-110" : ""].join(" ")}>{item.icon}</span>
              <span className={["text-[10px] font-medium", active ? "font-semibold" : ""].join(" ")}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}