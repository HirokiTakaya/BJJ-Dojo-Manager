"use client";

import React, { useMemo, useRef, forwardRef, useImperativeHandle } from "react";

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
  classType?: ClassType; // ✅ 新規追加
};

export type WeeklyScheduleGridProps = {
  weekStart: Date;
  classes: WeeklyClassItem[];
  onClickClass: (klass: WeeklyClassItem, dateKey: string) => void;
  onClickEmptySlot?: (args: { weekday: number; startMinute: number; dateKey: string }) => void;
  slotMin?: number; // default 30
  minHour?: number; // default 6
  maxHour?: number; // default 22
  filterType?: ClassType | "all"; // ✅ フィルター追加
};

// ✅ エクスポート用のref型
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

function clampWeekday(w: number) {
  return Math.max(0, Math.min(6, w));
}

// ✅ クラスタイプの表示ラベルと色
export const CLASS_TYPE_CONFIG: Record<
  ClassType,
  { label: string; emoji: string; bgColor: string; borderColor: string; textColor: string }
> = {
  adult: {
    label: "Adult",
    emoji: "🥋",
    bgColor: "rgba(59, 130, 246, 0.12)", // blue
    borderColor: "rgba(59, 130, 246, 0.28)",
    textColor: "text-blue-700",
  },
  kids: {
    label: "Kids",
    emoji: "👶",
    bgColor: "rgba(251, 146, 60, 0.12)", // orange
    borderColor: "rgba(251, 146, 60, 0.28)",
    textColor: "text-orange-700",
  },
  mixed: {
    label: "Mixed",
    emoji: "👨‍👩‍👧",
    bgColor: "rgba(168, 85, 247, 0.12)", // purple
    borderColor: "rgba(168, 85, 247, 0.28)",
    textColor: "text-purple-700",
  },
};

/**
 * ✅ 追加: classType 正規化
 */
function normalizeClassType(raw?: any, title?: string): ClassType {
  const v = String(raw ?? "").trim().toLowerCase();

  if (v === "adult" || v === "kids" || v === "mixed") return v;

  if (v === "kid" || v === "child" || v === "children" || v === "youth") return "kids";
  if (v === "family") return "mixed";

  const t = String(title ?? "").toLowerCase();

  if (
    t.includes("kids") ||
    t.includes("kid") ||
    t.includes("children") ||
    t.includes("youth") ||
    t.includes("キッズ") ||
    t.includes("子供") ||
    t.includes("こども") ||
    t.includes("ジュニア")
  ) {
    return "kids";
  }

  if (t.includes("mixed") || t.includes("family") || t.includes("親子")) {
    return "mixed";
  }

  return "adult";
}

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
    const dayRefs = useRef<Array<HTMLDivElement | null>>([]);

    useImperativeHandle(ref, () => ({
      getGridElement: () => gridContainerRef.current,
    }));

    const dayDates = useMemo(
      () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
      [weekStart]
    );

    const rows = useMemo(
      () => Math.floor(((maxHour - minHour) * 60) / slotMin),
      [maxHour, minHour, slotMin]
    );

    const slotH = 26;
    const headerH = 42;
    const timeColW = 52; // ✅ 時間列を少し狭く
    const gridH = rows * slotH;

    const dateKeyToIndex = useMemo(() => {
      const m = new Map<string, number>();
      dayDates.forEach((d, idx) => m.set(toDateKey(d), idx));
      return m;
    }, [dayDates]);

    const filteredClasses = useMemo(() => {
      if (filterType === "all") return classes;
      return classes.filter((c) => normalizeClassType(c.classType, c.title) === filterType);
    }, [classes, filterType]);

const groupedByColumn = useMemo(() => {
  const m = new Map<number, WeeklyClassItem[]>();
  for (let i = 0; i < 7; i++) m.set(i, []);

  // weekStart の曜日を取得
  const weekStartDay = weekStart.getDay(); // 0=日曜, 1=月曜, ...

  for (const c of filteredClasses) {
    let col = -1;

    if (c.dateKey) {
      const idx = dateKeyToIndex.get(c.dateKey);
      if (typeof idx === "number") col = idx;
    }

    if (col < 0) {
      // weekday から列インデックスを計算
      // 例: weekStart=金曜(5), weekday=木曜(4) → col = (4 - 5 + 7) % 7 = 6
      col = (c.weekday - weekStartDay + 7) % 7;
    }

    m.get(col)!.push(c);
  }

  for (let i = 0; i < 7; i++) {
    m.get(i)!.sort((a, b) => a.startMinute - b.startMinute);
  }

  return m;
}, [filteredClasses, dateKeyToIndex, weekStart]);

    const timeLabels = useMemo(() => {
      const out: Array<{ minute: number; label: string }> = [];
      for (let h = minHour; h <= maxHour; h++) {
        out.push({ minute: h * 60, label: `${String(h).padStart(2, "0")}:00` });
      }
      return out;
    }, [minHour, maxHour]);

    return (
      <div className="w-full overflow-x-auto" ref={gridContainerRef}>
        <div className="min-w-[860px] rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `${timeColW}px repeat(7, minmax(100px, 1fr))`,
              alignItems: "center",
              height: headerH,
            }}
            className="border-b border-slate-200 bg-slate-50"
          >
            <div className="text-[10px] font-semibold text-slate-500 pl-2">Time</div>
            {dayDates.map((d, idx) => {
              const label = d.toLocaleDateString(undefined, {
                weekday: "short",
                month: "2-digit",
                day: "2-digit",
              });
              return (
                <div key={idx} className="font-semibold text-slate-900 pl-2 text-xs">
                  {label}
                </div>
              );
            })}
          </div>

          {/* Body */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `${timeColW}px repeat(7, minmax(100px, 1fr))`,
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
                        top: y - 6,
                        left: 0,
                        right: 0,
                        paddingLeft: 4,
                      }}
                      className="text-[9px] text-slate-500"
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
              const dayItems = groupedByColumn.get(colIndex) ?? [];

              return (
                <div
                  key={colIndex}
                  ref={(el) => {
                    dayRefs.current[colIndex] = el;
                  }}
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
                    background:
                      "linear-gradient(to bottom, rgba(15, 23, 42, 0.06) 1px, transparent 1px)",
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

                    // ✅ 高さに応じてコンパクト表示を切り替え
                    const isCompact = height < 50;
                    const isVeryCompact = height < 35;

                    return (
                      <div
                        key={c.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onClickClass(c, dateKey);
                        }}
                        style={{
                          position: "absolute",
                          left: 4,
                          right: 4,
                          top: Math.max(0, top),
                          height: Math.max(20, height),
                          borderRadius: 10,
                          padding: isVeryCompact ? "2px 6px" : isCompact ? "4px 8px" : "6px 8px",
                          border,
                          background: bg,
                          boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
                          userSelect: "none",
                          overflow: "hidden",
                          opacity: isPast ? 0.55 : 1,
                          cursor: isPast ? "default" : "pointer",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: isVeryCompact ? "center" : "flex-start",
                        }}
                        title={`${c.title}\n${minutesToHHMM(c.startMinute)} - ${minutesToHHMM(c.startMinute + c.durationMinute)}\n${c.instructor || ""}`}
                      >
                        {/* ✅ タイトル行 - 常に表示、フォントサイズ小さく */}
                        <div
                          className="font-semibold text-slate-900 leading-tight flex items-center gap-0.5"
                          style={{
                            fontSize: isVeryCompact ? "9px" : isCompact ? "10px" : "11px",
                            lineHeight: 1.2,
                          }}
                        >
                          <span style={{ fontSize: isVeryCompact ? "8px" : "10px" }}>{typeConfig.emoji}</span>
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: isVeryCompact ? "nowrap" : "normal",
                              display: "-webkit-box",
                              WebkitLineClamp: isVeryCompact ? 1 : 2,
                              WebkitBoxOrient: "vertical",
                              wordBreak: "break-word",
                            }}
                          >
                            {c.title}
                          </span>
                        </div>

                        {/* ✅ 時間とステータス - コンパクトでない場合のみ表示 */}
                        {!isVeryCompact && (
                          <div
                            className="flex items-center justify-between gap-1 text-slate-700"
                            style={{
                              fontSize: isCompact ? "8px" : "9px",
                              marginTop: isCompact ? "1px" : "3px",
                            }}
                          >
                            <span className="font-medium">
                              {minutesToHHMM(c.startMinute)}
                              {!isCompact && ` · ${c.durationMinute}m`}
                            </span>

                            {!isCompact && (
                              <>
                                {isReserved ? (
                                  <span className="font-semibold text-emerald-700">Reserved</span>
                                ) : isPast ? (
                                  <span className="font-semibold text-slate-600">Past</span>
                                ) : (
                                  <span className={`font-semibold ${typeConfig.textColor}`}>
                                    {typeConfig.label}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* ✅ インストラクター - 十分な高さがある場合のみ表示 */}
                        {c.instructor && !isCompact && (
                          <div
                            className="text-slate-600"
                            style={{
                              fontSize: "8px",
                              marginTop: "2px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
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
    );
  }
);

export default WeeklyScheduleGrid;