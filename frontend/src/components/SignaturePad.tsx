// src/components/SignaturePad.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

type Point = [number, number]; // normalized 0..1
type Stroke = Point[];

/**
 * Draw a single stroke using quadratic bezier smoothing.
 * Points are normalized (0..1) — multiply by canvas CSS size.
 */
function drawStrokeSmooth(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  w: number,
  h: number
) {
  if (stroke.length < 2) return;

  ctx.beginPath();
  const [x0, y0] = stroke[0];
  ctx.moveTo(x0 * w, y0 * h);

  if (stroke.length === 2) {
    // Only 2 points — straight line
    const [x1, y1] = stroke[1];
    ctx.lineTo(x1 * w, y1 * h);
  } else {
    // Quadratic bezier through midpoints for smooth curves
    for (let i = 1; i < stroke.length - 1; i++) {
      const [cx, cy] = stroke[i]; // control point
      const [nx, ny] = stroke[i + 1]; // next point
      // Use midpoint of control and next as the end point
      const midX = (cx + nx) / 2;
      const midY = (cy + ny) / 2;
      ctx.quadraticCurveTo(cx * w, cy * h, midX * w, midY * h);
    }
    // Final segment: curve to the last point
    const last = stroke[stroke.length - 1];
    const prev = stroke[stroke.length - 2];
    ctx.quadraticCurveTo(prev[0] * w, prev[1] * h, last[0] * w, last[1] * h);
  }

  ctx.stroke();
}

export default function SignaturePad({
  disabled,
  onChange,
  height = 220,
  label,
  clearLabel = "Clear",
  hint,
}: {
  disabled?: boolean;
  onChange: (strokes: Stroke[]) => void;
  height?: number;
  label?: string;
  clearLabel?: string;
  hint?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const [strokeCount, setStrokeCount] = useState(0); // trigger re-renders
  const drawing = useRef(false);
  const currentStroke = useRef<Stroke>([]);
  const animFrame = useRef<number>(0);

  // ── Full redraw ──────────────────────────────────────────
  const redrawAll = useCallback((allStrokes: Stroke[], liveStroke?: Stroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Signature line hint (bottom third)
    const lineY = h * 0.75;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(w * 0.08, lineY);
    ctx.lineTo(w * 0.92, lineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Border
    ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    // Stroke style
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Draw completed strokes
    for (const stroke of allStrokes) {
      drawStrokeSmooth(ctx, stroke, w, h);
    }

    // Draw live stroke
    if (liveStroke && liveStroke.length >= 2) {
      drawStrokeSmooth(ctx, liveStroke, w, h);
    }
  }, []);

  // ── Canvas init ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setupCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 600;
      const cssH = canvas.clientHeight || height;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawAll(strokesRef.current);
    };

    setupCanvas();

    // Re-setup on resize (e.g. orientation change)
    const observer = new ResizeObserver(() => setupCanvas());
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [height, redrawAll]);

  // ── Sync strokes to parent ────────────────────────────────
  useEffect(() => {
    onChange(strokesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokeCount]);

  // ── Get normalized point ─────────────────────────────────
  const getPoint = useCallback((e: PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }, []);

  // ── Get coalesced points (smoother input) ─────────────────
  const getCoalescedPoints = useCallback(
    (e: PointerEvent): Point[] => {
      // getCoalescedEvents gives us all intermediate points the OS captured
      // between the last and current pointer event — much smoother!
      if (typeof e.getCoalescedEvents === "function") {
        const events = e.getCoalescedEvents();
        if (events.length > 0) {
          return events.map((ce) => getPoint(ce));
        }
      }
      return [getPoint(e)];
    },
    [getPoint]
  );

  // ── Pointer handlers ──────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      e.preventDefault();
      canvasRef.current?.setPointerCapture(e.pointerId);
      drawing.current = true;
      currentStroke.current = [getPoint(e.nativeEvent)];

      // Immediately draw the start dot
      redrawAll(strokesRef.current, currentStroke.current);
    },
    [disabled, getPoint, redrawAll]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled || !drawing.current) return;
      e.preventDefault();

      // Use coalesced events for smoother lines
      const points = getCoalescedPoints(e.nativeEvent);
      currentStroke.current.push(...points);

      // Throttle redraws with requestAnimationFrame
      if (animFrame.current) cancelAnimationFrame(animFrame.current);
      animFrame.current = requestAnimationFrame(() => {
        redrawAll(strokesRef.current, currentStroke.current);
      });
    },
    [disabled, getCoalescedPoints, redrawAll]
  );

  const endStroke = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;

    if (animFrame.current) {
      cancelAnimationFrame(animFrame.current);
      animFrame.current = 0;
    }

    const stroke = currentStroke.current;
    currentStroke.current = [];

    if (stroke.length >= 2) {
      strokesRef.current = [...strokesRef.current, stroke];
      setStrokeCount((c) => c + 1);
    }

    redrawAll(strokesRef.current);
  }, [redrawAll]);

  // ── Clear ─────────────────────────────────────────────────
  const clear = useCallback(() => {
    strokesRef.current = [];
    currentStroke.current = [];
    setStrokeCount(0);
    redrawAll([]);
  }, [redrawAll]);

  const hasSignature = strokeCount > 0;

  return (
    <div className="space-y-2">
      <div className="rounded-2xl overflow-hidden bg-white border border-slate-200">
        <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-200 flex items-center justify-between">
          <span>{label || "Sign here"}</span>
          <button
            type="button"
            onClick={clear}
            disabled={disabled || !hasSignature}
            className="text-slate-600 hover:underline disabled:opacity-50"
          >
            {clearLabel}
          </button>
        </div>
        <div className="p-3">
          <canvas
            ref={canvasRef}
            className="w-full touch-none cursor-crosshair"
            style={{ height: `${height}px` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {hint || "Use your finger (mobile) or mouse/trackpad to sign."}
      </p>
    </div>
  );
}

export type { Stroke, Point };