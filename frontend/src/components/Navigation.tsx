"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth } from "@/firebase";

export type NavItem = {
  id: string;
  label: string;
  icon: string;
  href: string | ((dojoId: string) => string);
  staffOnly?: boolean;
  studentOnly?: boolean;
};

const DEFAULT_NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    label: "Home",
    icon: "🏠",
    href: "/home",
  },
  {
    id: "timetable",
    label: "Timetable",
    icon: "📅",
    href: (dojoId) => `/dojos/${dojoId}/timetable`,
  },
  {
    id: "notices-staff",
    label: "Announcements",
    icon: "📣",
    href: (dojoId) => `/dojos/${dojoId}/notices`,
    staffOnly: true,
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: "✉️",
    href: (dojoId) => `/dojos/${dojoId}/inbox`,
    studentOnly: true,
  },
  {
    id: "members",
    label: "Members",
    icon: "👥",
    href: (dojoId) => `/dojos/${dojoId}/members`,
    staffOnly: true,
  },

  // ✅ NEW: Billing / Settings（staffOnly）
  // Billingを先に置くと /settings/billing でモバイル中央ラベルが Billing になりやすい
  {
    id: "billing",
    label: "Billing",
    icon: "💳",
    href: (dojoId) => `/dojos/${dojoId}/settings/billing`,
    staffOnly: true,
  },
  {
    id: "settings",
    label: "Settings",
    icon: "⚙️",
    href: (dojoId) => `/dojos/${dojoId}/settings`,
    staffOnly: true,
  },

  {
    id: "profile",
    label: "Profile",
    icon: "👤",
    href: "/profile",
  },
];

type NavigationProps = {
  dojoId?: string | null;
  isStaff?: boolean;
  userName?: string;
  userEmail?: string;
  customItems?: NavItem[];
};

// ✅ pathnameから dojoId を推定（propsが無い/渡せないケースの保険）
// 例: /dojos/ABC123/timetable -> ABC123
// 除外: /dojos/search, /dojos/attendance-dashboard, /dojos/members/xxx など
function deriveDojoIdFromPathname(pathname?: string | null): string | null {
  if (!pathname) return null;

  const parts = pathname.split("/").filter(Boolean); // ["dojos", "ABC123", "timetable"]
  if (parts.length < 2) return null;
  if (parts[0] !== "dojos") return null;

  const candidate = parts[1];
  if (!candidate) return null;

  // DojoIDではなく「固定ルート名」になりうるものを除外
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = customItems || DEFAULT_NAV_ITEMS;

  // ✅ dojoId のフォールバック（既存propsを優先し、無ければ pathname から推定）
  const effectiveDojoId = useMemo(() => {
    return dojoId ?? deriveDojoIdFromPathname(pathname);
  }, [dojoId, pathname]);

  // フィルターされたナビゲーションアイテム
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

      // 完全一致または前方一致（サブページ対応）
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

  return (
    <>
      {/* Desktop Navigation Bar */}
      <nav className="hidden md:block sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            {/* Left: Logo & Nav Items */}
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
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Right: User Info & Sign Out */}
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
              <button
                onClick={handleSignOut}
                className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
              >
                Sign Out
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
            {filteredItems.find((item) => isActive(item))?.label || "Menu"}
          </div>

          {/* Right: User Avatar or Sign Out */}
          <button onClick={handleSignOut} className="p-2 rounded-lg hover:bg-slate-100 transition-all">
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
                    <span className="font-medium">{item.label}</span>
                  </button>
                );
              })}

              {/* User Info */}
              {(userName || userEmail) && (
                <div className="mt-2 px-4 py-3 border-t border-slate-100">
                  <div className="text-sm text-slate-600">
                    Signed in as{" "}
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
// ✅ シンプルなボトムナビゲーション（モバイル用の代替案）
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

  // ✅ BottomNavigation 側もフォールバックを入れておく（既存挙動は維持しつつ、渡し忘れに強く）
  const effectiveDojoId = useMemo(() => {
    return dojoId ?? deriveDojoIdFromPathname(pathname);
  }, [dojoId, pathname]);

  const items = [
    { id: "home", label: "Home", icon: "🏠", href: "/home" },
    {
      id: "timetable",
      label: "Schedule",
      icon: "📅",
      href: effectiveDojoId ? `/dojos/${effectiveDojoId}/timetable` : null,
    },
    {
      id: "notices",
      label: isStaff ? "Announce" : "Inbox",
      icon: isStaff ? "📣" : "✉️",
      href: effectiveDojoId ? `/dojos/${effectiveDojoId}/${isStaff ? "notices" : "inbox"}` : null,
    },
    { id: "profile", label: "Profile", icon: "👤", href: "/profile" },
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
