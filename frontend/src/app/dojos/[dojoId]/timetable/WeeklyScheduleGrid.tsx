"use client";

import React, { useMemo, useRef, forwardRef, useImperativeHandle, useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";

// ✅ クラスタイプの追加
export type ClassType = "adult" | "kids" | "mixed";

export type WeeklyClassItem = {
  id: string;
  title: string;
  weekday: number; // 0..6
  startMinute: number; // 0..1439
  durationMinute: number;
  dateKey?: string;
  status?: "available" | "reserved" | "past";
  instructor?: string;
  classType?: ClassType;
};

export type WeeklyScheduleGridProps = {
  weekStart: Date;
  classes: WeeklyClassItem[];
  onClickClass: (klass: WeeklyClassItem, dateKey: string) => void;
  onClickEmptySlot?: (args: { weekday: number; startMinute: number; dateKey: string }) => void;
  slotMin?: number; // default 30
  minHour?: number; // default 6
  maxHour?: number; // default 22
  filterType?: ClassType | "all";
};

export type WeeklyScheduleGridRef = {
  getGridElement: () => HTMLDivElement | null;
};

function toDateKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function minutesToHHMM(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const CLASS_TYPE_CONFIG: Record<
  ClassType,
  { label: string; emoji: string; bgColor: string; borderColor: string; textColor: string }
> = {
  adult: {
    label: "Adult",
    emoji: "🥋",
    bgColor: "rgba(59, 130, 246, 0.12)",
    borderColor: "rgba(59, 130, 246, 0.28)",
    textColor: "text-blue-700",
  },
  kids: {
    label: "Kids",
    emoji: "👶",
    bgColor: "rgba(251, 146, 60, 0.12)",
    borderColor: "rgba(251, 146, 60, 0.28)",
    textColor: "text-orange-700",
  },
  mixed: {
    label: "Mixed",
    emoji: "👨‍👩‍👧",
    bgColor: "rgba(168, 85, 247, 0.12)",
    borderColor: "rgba(168, 85, 247, 0.28)",
    textColor: "text-purple-700",
  },
};

function normalizeClassType(raw?: any, title?: string): ClassType {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "adult" || v === "kids" || v === "mixed") return v;
  if (v === "kid" || v === "child" || v === "children" || v === "youth") return "kids";
  if (v === "family") return "mixed";

  const t = String(title ?? "").toLowerCase();
  if (
    t.includes("kids") || t.includes("kid") || t.includes("children") ||
    t.includes("youth") || t.includes("キッズ") || t.includes("子供") ||
    t.includes("こども") || t.includes("ジュニア")
  ) return "kids";
  if (t.includes("mixed") || t.includes("family") || t.includes("親子")) return "mixed";
  return "adult";
}

// ─────────────────────────────────────────────
// Overlap detection
// ─────────────────────────────────────────────

type ClassWithLane = WeeklyClassItem & {
  lane: number;
  totalLanes: number;
};

function timeOverlaps(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

function assignLanes(items: WeeklyClassItem[]): ClassWithLane[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) =>
    a.startMinute !== b.startMinute ? a.startMinute - b.startMinute : b.durationMinute - a.durationMinute
  );

  const n = sorted.length;
  const overlaps: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (timeOverlaps(sorted[i].startMinute, sorted[i].durationMinute, sorted[j].startMinute, sorted[j].durationMinute)) {
        overlaps[i][j] = true;
        overlaps[j][i] = true;
      }
    }
  }

  const visited = new Array(n).fill(false);
  const groups: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const group: number[] = [];
    const queue = [i];
    visited[i] = true;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      group.push(cur);
      for (let j = 0; j < n; j++) {
        if (!visited[j] && overlaps[cur][j]) { visited[j] = true; queue.push(j); }
      }
    }
    groups.push(group);
  }

  const laneAssignment = new Array(n).fill(0);
  const totalLanesArr = new Array(n).fill(1);

  for (const group of groups) {
    if (group.length === 1) { laneAssignment[group[0]] = 0; totalLanesArr[group[0]] = 1; continue; }
    group.sort((a, b) => sorted[a].startMinute - sorted[b].startMinute);
    let maxLane = 0;
    for (const idx of group) {
      const usedLanes = new Set<number>();
      for (const other of group) {
        if (other !== idx && overlaps[idx][other]) usedLanes.add(laneAssignment[other]);
      }
      let lane = 0;
      while (usedLanes.has(lane)) lane++;
      laneAssignment[idx] = lane;
      maxLane = Math.max(maxLane, lane);
    }
    const totalLanes = maxLane + 1;
    for (const idx of group) totalLanesArr[idx] = totalLanes;
  }

  return sorted.map((item, i) => ({ ...item, lane: laneAssignment[i], totalLanes: totalLanesArr[i] }));
}

const MAT_LABELS = ["Mat A", "Mat B", "Mat C", "Mat D", "Mat E", "Mat F"];
const MAT_SHORT = ["A", "B", "C", "D", "E", "F"];
function getMatLabel(lane: number, short = false) {
  const labels = short ? MAT_SHORT : MAT_LABELS;
  return lane < labels.length ? labels[lane] : `Mat ${lane + 1}`;
}

// ─────────────────────────────────────────────
// Zoom controls
// ─────────────────────────────────────────────

const SCALE_MIN = 0.5;
const SCALE_MAX = 2.0;
const SCALE_STEP = 0.1;
const SCALE_DEFAULT = 1.0;

const SCALE_PRESETS = [
  { label: "S", value: 0.6 },
  { label: "M", value: 1.0 },
  { label: "L", value: 1.4 },
];

function ZoomControls({
  scale, onChange,
}: {
  scale: number;
  onChange: (s: number) => void;
}) {
  const clamp = (v: number) => Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, v)) * 100) / 100;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* Preset buttons */}
      <div className="flex rounded-full border border-slate-200 overflow-hidden">
        {SCALE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.value)}
            className={[
              "px-3 py-1.5 text-xs font-semibold transition",
              Math.abs(scale - p.value) < 0.05
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50",
            ].join(" ")}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* − button */}
      <button
        type="button"
        onClick={() => onChange(clamp(scale - SCALE_STEP))}
        disabled={scale <= SCALE_MIN}
        className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-base font-bold"
      >
        −
      </button>

      {/* Slider */}
      <input
        type="range"
        min={SCALE_MIN * 100}
        max={SCALE_MAX * 100}
        step={SCALE_STEP * 100}
        value={Math.round(scale * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-20 sm:w-28 h-1.5 accent-slate-900 cursor-pointer"
      />

      {/* + button */}
      <button
        type="button"
        onClick={() => onChange(clamp(scale + SCALE_STEP))}
        disabled={scale >= SCALE_MAX}
        className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-base font-bold"
      >
        +
      </button>

      {/* Percentage */}
      <span className="text-xs text-slate-500 font-medium w-10 text-center tabular-nums">
        {Math.round(scale * 100)}%
      </span>

      {/* Reset */}
      {Math.abs(scale - SCALE_DEFAULT) > 0.05 && (
        <button
          type="button"
          onClick={() => onChange(SCALE_DEFAULT)}
          className="text-xs text-slate-500 hover:text-slate-800 underline"
        >
          Reset
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

const WeeklyScheduleGrid = forwardRef<WeeklyScheduleGridRef, WeeklyScheduleGridProps>(
  function WeeklyScheduleGrid(
    {
      weekStart,
      classes,
      onClickClass,
      onClickEmptySlot,
      slotMin = 30,
      minHour = 6,
      maxHour = 22,
      filterType = "all",
    },
    ref
  ) {
    const gridContainerRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const dayRefs = useRef<Array<HTMLDivElement | null>>([]);

    const tT = useTranslations("timetable");
    const classTypeLabels: Record<ClassType, string> = {
      adult: tT("filterAdult"),
      kids: tT("filterKids"),
      mixed: tT("filterMixed"),
    };

    // ✅ Zoom state
    const [scale, setScale] = useState(SCALE_DEFAULT);

    // Pinch zoom
    const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = { dist: Math.hypot(dx, dy), scale };
      }
    }, [scale]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDist = Math.hypot(dx, dy);
        const ratio = newDist / pinchRef.current.dist;
        const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, pinchRef.current.scale * ratio));
        setScale(Math.round(newScale * 100) / 100);
      }
    }, []);

    const handleTouchEnd = useCallback(() => { pinchRef.current = null; }, []);

    // Ctrl+Scroll zoom
    useEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const handler = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP;
        setScale((prev) => Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, prev + delta)) * 100) / 100);
      };
      el.addEventListener("wheel", handler, { passive: false });
      return () => el.removeEventListener("wheel", handler);
    }, []);

    useImperativeHandle(ref, () => ({
      getGridElement: () => gridContainerRef.current,
    }));

    const dayDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
    const rows = useMemo(() => Math.floor(((maxHour - minHour) * 60) / slotMin), [maxHour, minHour, slotMin]);

    // ✅ Scale-aware dimensions
    const BASE_SLOT_H = 26;
    const slotH = Math.round(BASE_SLOT_H * scale);
    const headerH = Math.round(42 * Math.max(scale, 0.8));
    const timeColW = Math.round(52 * Math.max(scale, 0.7));
    const gridH = rows * slotH;
    const minColW = Math.round(100 * Math.max(scale, 0.6));

    const dateKeyToIndex = useMemo(() => {
      const m = new Map<string, number>();
      dayDates.forEach((d, idx) => m.set(toDateKey(d), idx));
      return m;
    }, [dayDates]);

    const filteredClasses = useMemo(() => {
      if (filterType === "all") return classes;
      return classes.filter((c) => normalizeClassType(c.classType, c.title) === filterType);
    }, [classes, filterType]);

    const groupedByColumnWithLanes = useMemo(() => {
      const m = new Map<number, WeeklyClassItem[]>();
      for (let i = 0; i < 7; i++) m.set(i, []);
      const weekStartDay = weekStart.getDay();

      for (const c of filteredClasses) {
        let col = -1;
        if (c.dateKey) {
          const idx = dateKeyToIndex.get(c.dateKey);
          if (typeof idx === "number") col = idx;
        }
        if (col < 0) col = (c.weekday - weekStartDay + 7) % 7;
        m.get(col)!.push(c);
      }

      const result = new Map<number, ClassWithLane[]>();
      for (let i = 0; i < 7; i++) {
        const dayItems = m.get(i)!;
        dayItems.sort((a, b) => a.startMinute - b.startMinute);
        result.set(i, assignLanes(dayItems));
      }
      return result;
    }, [filteredClasses, dateKeyToIndex, weekStart]);

    const timeLabels = useMemo(() => {
      const out: Array<{ minute: number; label: string }> = [];
      for (let h = minHour; h <= maxHour; h++) {
        out.push({ minute: h * 60, label: `${String(h).padStart(2, "0")}:00` });
      }
      return out;
    }, [minHour, maxHour]);

    // ✅ Font scaling helper
    const fs = (base: number) => Math.max(7, Math.round(base * Math.max(scale, 0.65)));

    return (
      <div className="space-y-3">
        {/* ✅ Zoom controls */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs font-semibold text-slate-500">🔍 Zoom</span>
          <ZoomControls scale={scale} onChange={setScale} />
        </div>

        {/* Grid container with scroll */}
        <div
          ref={scrollContainerRef}
          className="w-full overflow-x-auto overflow-y-auto"
          style={{ maxHeight: "75vh" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div ref={gridContainerRef}>
            <div
              className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden"
              style={{ minWidth: Math.round(860 * Math.max(scale, 0.5)) }}
            >
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `${timeColW}px repeat(7, minmax(${minColW}px, 1fr))`,
                  alignItems: "center",
                  height: headerH,
                }}
                className="border-b border-slate-200 bg-slate-50"
              >
                <div className="font-semibold text-slate-500 pl-2" style={{ fontSize: fs(10) }}>
                  Time
                </div>
                {dayDates.map((d, idx) => {
                  const label = d.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "2-digit",
                    day: "2-digit",
                  });
                  return (
                    <div key={idx} className="font-semibold text-slate-900 pl-2" style={{ fontSize: fs(11) }}>
                      {label}
                    </div>
                  );
                })}
              </div>

              {/* Body */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `${timeColW}px repeat(7, minmax(${minColW}px, 1fr))`,
                }}
              >
                {/* Time column */}
                <div className="border-r border-slate-200">
                  <div style={{ height: gridH, position: "relative" }}>
                    {timeLabels.map((t) => {
                      const y = Math.round(((t.minute - minHour * 60) / slotMin) * slotH);
                      if (y < 0 || y > gridH) return null;
                      return (
                        <div
                          key={t.minute}
                          style={{
                            position: "absolute",
                            top: y - Math.round(6 * scale),
                            left: 0,
                            right: 0,
                            paddingLeft: 4,
                            fontSize: fs(9),
                          }}
                          className="text-slate-500"
                        >
                          {t.label}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 7 day columns */}
                {dayDates.map((dayDate, colIndex) => {
                  const dateKey = toDateKey(dayDate);
                  const dayItems = groupedByColumnWithLanes.get(colIndex) ?? [];

                  return (
                    <div
                      key={colIndex}
                      ref={(el) => { dayRefs.current[colIndex] = el; }}
                      onClick={(e) => {
                        if (!onClickEmptySlot) return;
                        const el = dayRefs.current[colIndex];
                        if (!el) return;
                        const rect = el.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        if (y < 0 || y > gridH) return;
                        const slotIndex = Math.max(0, Math.min(rows - 1, Math.round(y / slotH)));
                        const startMinute = minHour * 60 + slotIndex * slotMin;
                        onClickEmptySlot({ weekday: dayDate.getDay(), startMinute, dateKey });
                      }}
                      style={{
                        height: gridH,
                        position: "relative",
                        background: `linear-gradient(to bottom, rgba(15, 23, 42, 0.06) 1px, transparent 1px)`,
                        backgroundSize: `100% ${slotH}px`,
                      }}
                      className={[
                        colIndex === 6 ? "" : "border-r border-slate-200",
                        onClickEmptySlot ? "cursor-pointer" : "cursor-default",
                      ].join(" ")}
                      title={onClickEmptySlot ? "Click an empty slot to add" : ""}
                    >
                      {dayItems.map((c) => {
                        const top = ((c.startMinute - minHour * 60) / slotMin) * slotH;
                        const height = (c.durationMinute / slotMin) * slotH;
                        if (top + height < 0 || top > gridH) return null;

                        const status = c.status ?? "available";
                        const isPast = status === "past";
                        const isReserved = status === "reserved";
                        const classType = normalizeClassType(c.classType, c.title);
                        const typeConfig = CLASS_TYPE_CONFIG[classType];

                        let bg = typeConfig.bgColor;
                        let border = `1px solid ${typeConfig.borderColor}`;
                        if (status === "reserved") {
                          bg = "rgba(16, 185, 129, 0.12)";
                          border = "1px solid rgba(16, 185, 129, 0.28)";
                        } else if (status === "past") {
                          bg = "rgba(100, 116, 139, 0.10)";
                          border = "1px solid rgba(100, 116, 139, 0.22)";
                        }

                        const hasOverlap = c.totalLanes > 1;
                        const gapPx = 2;
                        const outerPad = Math.round(4 * Math.max(scale, 0.5));

                        const isCompact = height < 50;
                        const isVeryCompact = height < 35;
                        const isOverlapCompact = hasOverlap && height < 65;
                        const effectiveCompact = isCompact || isOverlapCompact;
                        const effectiveVeryCompact = isVeryCompact || (hasOverlap && height < 45);

                        const positionStyle: React.CSSProperties = hasOverlap
                          ? {
                              position: "absolute",
                              left: `calc(${(c.lane / c.totalLanes) * 100}% + ${c.lane === 0 ? outerPad : gapPx / 2}px)`,
                              right: `calc(${((c.totalLanes - c.lane - 1) / c.totalLanes) * 100}% + ${c.lane === c.totalLanes - 1 ? outerPad : gapPx / 2}px)`,
                              top: Math.max(0, top),
                              height: Math.max(20, height),
                            }
                          : {
                              position: "absolute",
                              left: outerPad,
                              right: outerPad,
                              top: Math.max(0, top),
                              height: Math.max(20, height),
                            };

                        return (
                          <div
                            key={c.id}
                            onClick={(ev) => { ev.stopPropagation(); onClickClass(c, dateKey); }}
                            style={{
                              ...positionStyle,
                              borderRadius: hasOverlap ? 8 : 10,
                              padding: effectiveVeryCompact
                                ? `${Math.round(2 * scale)}px ${Math.round(4 * scale)}px`
                                : effectiveCompact
                                ? `${Math.round(3 * scale)}px ${Math.round(6 * scale)}px`
                                : `${Math.round(6 * scale)}px ${Math.round(8 * scale)}px`,
                              border,
                              background: bg,
                              boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
                              userSelect: "none",
                              overflow: "hidden",
                              opacity: isPast ? 0.55 : 1,
                              cursor: isPast ? "default" : "pointer",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: effectiveVeryCompact ? "center" : "flex-start",
                            }}
                            title={[
                              c.title,
                              `${minutesToHHMM(c.startMinute)} - ${minutesToHHMM(c.startMinute + c.durationMinute)}`,
                              c.instructor || "",
                              hasOverlap ? getMatLabel(c.lane) : "",
                            ].filter(Boolean).join("\n")}
                          >
                            {/* Mat label */}
                            {hasOverlap && (
                              <div style={{
                                fontSize: fs(effectiveVeryCompact ? 7 : 8),
                                lineHeight: 1, fontWeight: 700,
                                color: "rgba(15, 23, 42, 0.5)",
                                marginBottom: effectiveVeryCompact ? 0 : 1,
                              }}>
                                {effectiveVeryCompact ? getMatLabel(c.lane, true) : getMatLabel(c.lane)}
                              </div>
                            )}

                            {/* Title */}
                            <div
                              className="font-semibold text-slate-900 leading-tight flex items-center gap-0.5"
                              style={{ fontSize: fs(effectiveVeryCompact ? 8 : effectiveCompact ? 9 : hasOverlap ? 10 : 11), lineHeight: 1.2 }}
                            >
                              <span style={{ fontSize: fs(effectiveVeryCompact ? 7 : hasOverlap ? 8 : 10) }}>{typeConfig.emoji}</span>
                              <span style={{
                                overflow: "hidden", textOverflow: "ellipsis",
                                whiteSpace: effectiveVeryCompact ? "nowrap" : "normal",
                                display: "-webkit-box",
                                WebkitLineClamp: effectiveVeryCompact ? 1 : 2,
                                WebkitBoxOrient: "vertical",
                                wordBreak: "break-word",
                              }}>
                                {c.title}
                              </span>
                            </div>

                            {/* Time + status */}
                            {!effectiveVeryCompact && (
                              <div
                                className="flex items-center justify-between gap-1 text-slate-700"
                                style={{ fontSize: fs(effectiveCompact ? 7 : hasOverlap ? 8 : 9), marginTop: effectiveCompact ? 1 : 3 }}
                              >
                                <span className="font-medium">
                                  {minutesToHHMM(c.startMinute)}
                                  {!effectiveCompact && ` · ${c.durationMinute}m`}
                                </span>
                                {!effectiveCompact && !hasOverlap && (
                                  <>
                                    {isReserved ? (
                                      <span className="font-semibold text-emerald-700">{tT("reservedLabel")}</span>
                                    ) : isPast ? (
                                      <span className="font-semibold text-slate-600">{tT("pastLabel")}</span>
                                    ) : (
                                      <span className={`font-semibold ${typeConfig.textColor}`}>{classTypeLabels[classType]}</span>
                                    )}
                                  </>
                                )}
                              </div>
                            )}

                            {/* Instructor */}
                            {c.instructor && !effectiveCompact && (
                              <div className="text-slate-600" style={{
                                fontSize: fs(hasOverlap ? 7 : 8),
                                marginTop: 2,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>
                                👤 {c.instructor}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ✅ Zoom hint */}
        <div className="text-[10px] text-slate-400 text-center select-none">
          Ctrl+Scroll or pinch to zoom · Drag to scroll
        </div>
      </div>
    );
  }
);

export default WeeklyScheduleGrid;