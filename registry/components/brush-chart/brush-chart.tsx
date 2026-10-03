"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./brush-chart.module.css";

export interface BrushChartDatum {
  /** A point in time, as a Date or epoch milliseconds. Points must be in ascending order. */
  date: Date | number;
  value: number;
}

export interface BrushChartAnnotation {
  date: Date | number;
  /** Short label printed beside the marker, such as "v2 launch". */
  label: string;
  /** Longer note for the tooltip and screen readers. */
  description?: string;
}

/** Use a brush chart for a long, dense time series where people need the whole history and a close look at any stretch of it. */
export interface BrushChartProps {
  data: BrushChartDatum[];
  /** What is measured, such as "Daily active users". Names the chart for assistive technology. */
  label: string;
  /** Unit after each value, such as "users". */
  unit?: string;
  formatValue?: (value: number) => string;
  /** Formats the value axis. Defaults to a compact number, such as 12K. */
  formatTick?: (value: number) => string;
  /** Formats a date in the tooltip and announcements. */
  formatDate?: (date: Date) => string;
  /** Events drawn as markers on both charts. */
  annotations?: BrushChartAnnotation[];
  /** Controlled window as [start, end] epoch milliseconds. A new value glides the window there. */
  range?: [number, number];
  /** Initial window when uncontrolled. Defaults to the whole series. */
  defaultRange?: [number, number];
  /** Called while the window is dragged, resized, stepped, or reset. */
  onRangeChange?: (range: [number, number]) => void;
  /** Smallest window in milliseconds. Defaults to seven days. */
  minSpan?: number;
  /** Main plot height in pixels. */
  height?: number;
  /** Overview strip height in pixels. */
  overviewHeight?: number;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
}

type Point = { t: number; value: number };
type Drag = { mode: "start" | "end" | "pan" | "new"; pointerX: number; from: [number, number]; anchor: number; moved: boolean };

const DAY = 86_400_000;
const { spring } = motionTokens;
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .001) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const settle = physical(spring.smooth);
const glide = physical(spring.snappy, .01);
const follow = { stiffness: glide.stiffness, damping: glide.damping, restDelta: .01 };
const draw = physical({ visualDuration: .9, bounce: 0 });
const TOP = 28, GAP = 14, GRIP = 14;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options });
const fullDate = utc({ weekday: "short", month: "short", day: "numeric", year: "numeric" });
const dayTick = utc({ month: "short", day: "numeric" });
const monthTick = utc({ month: "short" });
const yearTick = utc({ year: "numeric" });
const shortDate = utc({ month: "short", day: "numeric", year: "numeric" });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const time = (date: Date | number) => typeof date === "number" ? date : date.getTime();
const clean = (value: number) => Number(value.toPrecision(12));

/** Clean gridlines from zero: the smallest step of 1, 2, 2.5, or 5 that covers the data in four rows or fewer. */
function niceTop(high: number) {
  const hi = Math.max(high, 1), magnitude = 10 ** Math.floor(Math.log10(hi / 4));
  for (const factor of [1, 2, 2.5, 5, 10]) { const step = factor * magnitude, top = Math.ceil(hi / step) * step; if (top / step <= 4 + 1e-9) return { top: clean(top), step: clean(step) }; }
  return { top: hi, step: hi / 4 };
}

/** Calendar ticks that fit the width: days, weeks, then months, quarters, and years, each landing on a real boundary. */
function timeTicks(start: number, end: number, width: number) {
  const room = Math.max(2, Math.floor(width / 76)), span = end - start;
  for (const days of [1, 2, 7, 14]) {
    if (span / (days * DAY) > room) continue;
    const ticks: { t: number; label: string }[] = [];
    let t = Math.ceil(start / DAY) * DAY;
    if (days >= 7) while (new Date(t).getUTCDay() !== 1) t += DAY;
    for (; t <= end; t += days * DAY) ticks.push({ t, label: dayTick.format(t) });
    return ticks;
  }
  for (const months of [1, 2, 3, 6, 12]) {
    if (span / (months * 30.44 * DAY) > room) continue;
    const ticks: { t: number; label: string }[] = [];
    const first = new Date(start);
    let y = first.getUTCFullYear(), m = first.getUTCMonth() + (first.getUTCDate() > 1 || first.getUTCHours() > 0 ? 1 : 0);
    for (;;) {
      y += Math.floor(m / 12); m %= 12;
      const t = Date.UTC(y, m, 1);
      if (t > end) break;
      if (m % months === 0) ticks.push({ t, label: m === 0 ? yearTick.format(t) : monthTick.format(t) });
      m += 1;
    }
    return ticks;
  }
  const ticks: { t: number; label: string }[] = [];
  for (let y = new Date(start).getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= end; y++) ticks.push({ t: Date.UTC(y, 0, 1), label: String(y) });
  return ticks;
}

/** First index at or after t. */
function lowerBound(points: Point[], t: number) {
  let low = 0, high = points.length;
  while (low < high) { const middle = (low + high) >> 1; if (points[middle].t < t) low = middle + 1; else high = middle; }
  return low;
}

/** A line through the points in view. Past two points per pixel, each pixel column keeps only its low and high so spikes survive. */
function linePath(points: Point[], from: number, to: number, x: (t: number) => number, y: (value: number) => number, width: number) {
  const slice = points.slice(Math.max(0, from), Math.min(points.length, to));
  if (!slice.length) return "";
  const parts: string[] = [];
  if (slice.length <= width * 2) { for (const point of slice) parts.push(`${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`); }
  else {
    let column = -1, low: Point | null = null, high: Point | null = null;
    const flush = () => { if (!low || !high) return; const pair = low.t < high.t ? [low, high] : [high, low]; for (const point of pair) parts.push(`${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`); };
    for (const point of slice) {
      const at = Math.floor(x(point.t));
      if (at !== column) { flush(); column = at; low = high = point; continue; }
      if (point.value < low!.value) low = point;
      if (point.value > high!.value) high = point;
    }
    flush();
  }
  return `M${parts.join("L")}`;
}

const subscribeNothing = () => () => {};
function useReducedMotionSafe() {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

function useWidth<T extends HTMLElement>() {
  const node = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [node, width] as const;
}

export function BrushChart({ data, label, unit = "", formatValue = value => grouped.format(value), formatTick = value => compact.format(value), formatDate = date => fullDate.format(date), annotations = [], range, defaultRange, onRangeChange, minSpan = 7 * DAY, height = 240, overviewHeight = 52, emptyLabel = "No data yet", ref, className }: BrushChartProps) {
  const reduced = useReducedMotionSafe();
  const uid = `brush${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const figure = useRef<HTMLElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const inView = useInView(figure, { once: true, amount: .3 });
  const [plot, width] = useWidth<HTMLDivElement>();
  const [strip, stripWidth] = useWidth<HTMLDivElement>();

  const points = useMemo(() => data.map(item => ({ t: time(item.date), value: item.value })), [data]);
  // Zoomed out, a centred seven point average and its low to high band replace the raw line, so weekly noise reads as texture instead of a solid block.
  const smooth = useMemo(() => {
    const around = (index: number, read: (at: number) => number[]) => { const out: number[][] = []; for (let at = Math.max(0, index - 3); at <= Math.min(points.length - 1, index + 3); at++) out.push(read(at)); return out; };
    const raw = points.map((_, index) => { const values = around(index, at => [points[at].value]).map(([value]) => value); return { value: values.reduce((sum, value) => sum + value, 0) / values.length, low: Math.min(...values), high: Math.max(...values) }; });
    // The band is averaged once more so its edges ease instead of stepping.
    return points.map((point, index) => { const near = around(index, at => [raw[at].low, raw[at].high]); return { t: point.t, value: raw[index].value, low: near.reduce((sum, [low]) => sum + low, 0) / near.length, high: near.reduce((sum, [, high]) => sum + high, 0) / near.length }; });
  }, [points]);
  const events = useMemo(() => annotations.map(item => ({ ...item, t: time(item.date) })).sort((a, b) => a.t - b.t), [annotations]);
  const empty = points.length < 2;
  const first = points[0]?.t ?? 0, lastT = points[points.length - 1]?.t ?? 1;
  const whole: [number, number] = [first, lastT];
  const fit = ([start, end]: [number, number]): [number, number] => {
    const span = clamp(end - start, Math.min(minSpan, lastT - first), lastT - first);
    const s = clamp(start, first, lastT - span);
    return [s, s + span];
  };

  // The window: follows the finger 1:1 while dragged, glides on a spring when set from outside or reset.
  const [view, setView] = useState<[number, number]>(() => range ?? defaultRange ?? whole);
  const viewRef = useRef(view);
  const flight = useRef<{ stop: () => void } | null>(null);
  const place = (next: [number, number]) => { viewRef.current = next; setView(next); };
  const glideTo = (next: [number, number]) => {
    flight.current?.stop();
    const from = viewRef.current;
    if (reduced) { place(next); return; }
    flight.current = animate(0, 1, { ...settle, onUpdate: t => place([from[0] + (next[0] - from[0]) * t, from[1] + (next[1] - from[1]) * t]) });
  };
  const commit = (next: [number, number], smooth: boolean) => {
    const target = fit(next);
    if (smooth) glideTo(target); else { flight.current?.stop(); place(target); }
    onRangeChange?.(target);
  };
  const rangeKey = range ? `${range[0]}:${range[1]}` : "";
  useEffect(() => {
    if (!range || empty) return;
    const target = fit(range), now = viewRef.current;
    if (Math.abs(target[0] - now[0]) + Math.abs(target[1] - now[1]) > 1000) glideTo(target);
  }, [rangeKey, empty]); // eslint-disable-line react-hooks/exhaustive-deps
  // Data that no longer covers the window pulls it back inside.
  useEffect(() => { if (!empty) { const target = fit(viewRef.current); if (target[0] !== viewRef.current[0] || target[1] !== viewRef.current[1]) place(target); } }, [first, lastT]); // eslint-disable-line react-hooks/exhaustive-deps

  const [start, end] = view;
  const span = Math.max(1, end - start);
  const from = Math.max(0, lowerBound(points, start) - 1), to = Math.min(points.length, lowerBound(points, end) + 1);
  let peak = 0;
  for (let index = from; index < to; index++) peak = Math.max(peak, points[index].value);
  const scale = niceTop(peak * 1.04);

  // The value axis springs to the tallest point in view, so zooming into a quiet stretch fills the plot.
  const [top, setTop] = useState(scale.top);
  const topFlight = useRef<{ stop: () => void } | null>(null);
  const aimed = useRef(scale.top);
  useEffect(() => {
    if (aimed.current === scale.top) return;
    aimed.current = scale.top;
    topFlight.current?.stop();
    if (reduced) return;
    topFlight.current = animate(top, scale.top, { ...settle, onUpdate: setTop });
  }, [reduced, scale.top]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { flight.current?.stop(); topFlight.current?.stop(); }, []);

  const plotH = height;
  const x = (t: number) => ((t - start) / span) * width;
  const topNow = reduced ? scale.top : top;
  const y = (value: number) => TOP + (1 - value / (topNow || 1)) * (plotH - TOP);
  const line = width && !empty ? linePath(points, from, to, x, y, width) : "";
  const area = line ? `${line}L${x(points[to - 1].t).toFixed(1)},${plotH}L${x(points[from].t).toFixed(1)},${plotH}Z` : "";
  const trend = width && !empty ? linePath(smooth, from, to, x, y, width * 4) : "";
  const band = trend ? `${linePath(smooth.map(point => ({ t: point.t, value: point.high })), from, to, x, y, width * 4)}L${linePath(smooth.map(point => ({ t: point.t, value: point.low })), from, to, x, y, width * 4).slice(1).split("L").reverse().join("L")}Z` : "";
  // How much of the raw line shows: all of it past about four pixels a point, none below about three.
  const pxPerPoint = empty ? width : (width * (lastT - first)) / (points.length - 1) / span;
  const detail = clamp((pxPerPoint - 2.75) / 1.5, 0, 1);
  const ticks = scale.top > 0 ? Array.from({ length: Math.round(scale.top / scale.step) + 1 }, (_, index) => clean(index * scale.step)) : [];
  const xTicks = width && !empty ? timeTicks(start, end, width) : [];

  // Overview: the whole series, drawn once per width.
  const ox = (t: number) => ((t - first) / (lastT - first || 1)) * stripWidth;
  const overview = useMemo(() => {
    if (!stripWidth || empty) return { line: "", area: "", marks: [] };
    const max = niceTop(smooth.reduce((m, point) => Math.max(m, point.value), 0)).top || 1;
    const oy = (value: number) => 4 + (1 - value / max) * (overviewHeight - 4);
    const path = linePath(smooth, 0, smooth.length, ox, oy, stripWidth * 4);
    const marks = events.map(event => { const at = clamp(lowerBound(smooth, event.t), 0, smooth.length - 1); return { t: event.t, x: ox(event.t), y: oy(smooth[at].value) }; });
    return { line: path, area: `${path}L${stripWidth},${overviewHeight}L0,${overviewHeight}Z`, marks };
  }, [smooth, events, stripWidth, overviewHeight, empty]); // eslint-disable-line react-hooks/exhaustive-deps
  const wx0 = ox(start), wx1 = ox(end);

  // The line draws in from the left once, the first time it is seen.
  const drawn = useMotionValue(0);
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (empty) return;
    if (reduced) { drawn.jump(1); return; }
    if (!inView || drawn.get() >= 1) return;
    const controls = animate(drawn, 1, { ...draw, onUpdate: setReveal });
    return () => controls.stop();
  }, [drawn, empty, inView, reduced]);

  // Crosshair on the nearest point in view; the tooltip glides beside it and never leaves the plot.
  const [active, setActive] = useState<number | null>(null);
  const [hoverEvent, setHoverEvent] = useState<number | null>(null);
  const index = active !== null && active >= from && active < to ? active : null;
  const nearest = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect?.width || empty) return null;
    const t = start + ((clientX - rect.left) / rect.width) * span;
    const at = clamp(lowerBound(points, t), 1, points.length - 1);
    return clamp(t - points[at - 1].t < points[at].t - t ? at - 1 : at, Math.max(0, from), to - 1);
  };
  const cx = index === null ? 0 : x(points[index].t), cy = index === null ? 0 : y(smooth[index].value + (points[index].value - smooth[index].value) * detail);
  const eventAt = index === null ? null : events.find(event => Math.abs(event.t - points[index].t) < DAY / 2) ?? null;
  const shownEvent = hoverEvent !== null ? events[hoverEvent] : null;
  const tipX = useMotionValue(0), tipY = useMotionValue(0);
  const tipSpringX = useSpring(tipX, follow), tipSpringY = useSpring(tipY, follow);
  const tipOn = index !== null || shownEvent !== null;
  const wasOn = useRef(false);
  useLayoutEffect(() => {
    const bubble = tip.current;
    if (!tipOn || !bubble || !width) { wasOn.current = false; return; }
    const ax = shownEvent ? x(shownEvent.t) : cx, ay = shownEvent ? TOP : cy;
    const tw = bubble.offsetWidth, th = bubble.offsetHeight;
    let left = ax + GAP;
    if (left + tw > width) left = ax - GAP - tw;
    let topY = ay - th - GAP;
    if (topY < 0) topY = ay + GAP;
    tipX.set(clamp(left, 0, Math.max(0, width - tw))); tipY.set(clamp(topY, 0, Math.max(0, plotH - th)));
    if (!wasOn.current || reduced) { tipSpringX.jump(tipX.get()); tipSpringY.jump(tipY.get()); }
    wasOn.current = true;
  });

  const onPlotMove = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse" || event.buttons) setActive(nearest(event.clientX)); };
  const onPlotKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (empty) return;
    if (event.key === "Escape" && index !== null) { event.preventDefault(); setActive(null); return; }
    const current = index ?? to - 1, page = Math.max(1, Math.round((to - from) / 8));
    const next = ({ ArrowLeft: current - 1, ArrowRight: index === null ? to - 1 : current + 1, PageDown: current - page, PageUp: current + page, Home: from, End: to - 1 } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(clamp(next, Math.max(0, from), to - 1));
  };

  // Overview gestures: grab an edge to resize, the window to pan, or empty track to draw a new window. A tap recentres; a double tap resets.
  const drag = useRef<Drag | null>(null);
  const toTime = (clientX: number) => { const rect = strip.current?.getBoundingClientRect(); return rect?.width ? first + clamp((clientX - rect.left) / rect.width, 0, 1) * (lastT - first) : first; };
  const onStripDown = (event: PointerEvent<HTMLDivElement>) => {
    if (empty || event.button > 0) return;
    const rect = strip.current!.getBoundingClientRect(), px = event.clientX - rect.left;
    const mode: Drag["mode"] = Math.abs(px - wx0) <= GRIP && px <= (wx0 + wx1) / 2 ? "start" : Math.abs(px - wx1) <= GRIP ? "end" : px > wx0 && px < wx1 ? "pan" : "new";
    drag.current = { mode, pointerX: event.clientX, from: viewRef.current, anchor: toTime(event.clientX), moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    flight.current?.stop();
  };
  const onStripMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    if (!current.moved && Math.abs(event.clientX - current.pointerX) < 3) return;
    current.moved = true;
    const t = toTime(event.clientX), shift = t - current.anchor;
    const [s, e] = current.from, least = Math.min(minSpan, lastT - first);
    const next: [number, number] = current.mode === "pan" ? [s + shift, e + shift]
      : current.mode === "start" ? [clamp(t, first, e - least), e]
      : current.mode === "end" ? [s, clamp(t, s + least, lastT)]
      : [Math.min(current.anchor, t), Math.max(current.anchor, t)];
    if (current.mode === "new" && next[1] - next[0] < least) { if (t >= current.anchor) next[1] = next[0] + least; else next[0] = next[1] - least; }
    commit(next, false);
  };
  const onStripUp = () => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.moved || current.mode !== "new") return;
    const half = (viewRef.current[1] - viewRef.current[0]) / 2;
    commit([current.anchor - half, current.anchor + half], true);
  };
  const reset = () => commit(whole, true);

  const stepSize = Math.max(DAY, (lastT - first) / Math.max(1, points.length - 1));
  const onHandleKey = (event: KeyboardEvent<HTMLDivElement>, edge: "start" | "end" | "window") => {
    const [s, e] = viewRef.current, win = e - s;
    const big = event.shiftKey || event.key.startsWith("Page");
    const delta = ({ ArrowLeft: -1, ArrowDown: -1, PageDown: -1, ArrowRight: 1, ArrowUp: 1, PageUp: 1 } as Record<string, number>)[event.key];
    let next: [number, number] | null = null;
    if (event.key === "Escape" || event.key === "0") next = whole;
    else if (edge === "window" && (event.key === "+" || event.key === "=")) next = [s + win / 4, e - win / 4];
    else if (edge === "window" && (event.key === "-" || event.key === "_")) next = [s - win / 2, e + win / 2];
    else if (event.key === "Home") next = edge === "end" ? [s, s + Math.min(minSpan, lastT - first)] : [first, edge === "window" ? first + win : e];
    else if (event.key === "End") next = edge === "start" ? [e - Math.min(minSpan, lastT - first), e] : [edge === "window" ? lastT - win : s, lastT];
    else if (delta) {
      const move = delta * (edge === "window" ? win * (big ? .5 : .1) : stepSize * (big ? 10 : 1));
      next = edge === "window" ? [s + move, e + move] : edge === "start" ? [Math.min(s + move, e - minSpan), e] : [s, Math.max(e + move, s + minSpan)];
    }
    if (!next) return;
    event.preventDefault();
    commit(next, false);
  };

  const format = (value: number) => `${formatValue(value)}${unit ? ` ${unit}` : ""}`;
  const reading = index === null ? null : points[index];
  const previous = index !== null && index >= 7 ? points[index - 7] : null;
  const change = reading && previous && previous.value ? (reading.value - previous.value) / previous.value : null;
  const windowText = `${shortDate.format(start)} to ${shortDate.format(end)}`;
  const inWindow = events.filter(event => event.t >= start && event.t <= end);
  // Event labels are placed left to right and skipped when they would collide with the one before.
  const labelled = new Map<number, boolean>();
  let edge = -Infinity;
  inWindow.forEach((event, at) => {
    const px = x(event.t), w = event.label.length * 6.2 + 4, next = at + 1 < inWindow.length ? x(inWindow[at + 1].t) - 10 : width;
    if (px + 14 >= edge && px + 14 + w <= next) { labelled.set(event.t, false); edge = px + 14 + w + 8; return; }
    if (px - 14 - w >= Math.max(0, edge) && (at === 0 || px - 14 - w >= x(inWindow[at - 1].t) + 12)) { labelled.set(event.t, true); edge = px + 12; return; }
    edge = Math.max(edge, px + 12);
  });
  const announce = reading ? `${formatDate(new Date(reading.t))}, ${format(reading.value)}${eventAt ? `. ${eventAt.label}` : ""}` : "";
  const summary = empty ? `${label}. ${emptyLabel}.` : `${label}, ${shortDate.format(first)} to ${shortDate.format(lastT)}. Showing ${windowText}.`;

  return <figure ref={figure} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label}>
    <div className={styles.chart} data-active={tipOn || undefined}>
      <div ref={plot} className={styles.plot} style={{ height: plotH }} role="group" tabIndex={empty ? -1 : 0} aria-roledescription="chart" aria-label={`${label}, ${windowText}. Use left and right arrows to read values.`}
        onPointerMove={onPlotMove} onPointerDown={event => { if (event.pointerType !== "mouse") { event.currentTarget.setPointerCapture?.(event.pointerId); setActive(nearest(event.clientX)); } }}
        onPointerUp={event => { if (event.pointerType !== "mouse") setActive(null); }} onPointerCancel={() => setActive(null)} onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }}
        onKeyDown={onPlotKey} onBlur={() => setActive(null)} onDoubleClick={reset} onFocus={event => { if (event.currentTarget.matches(":focus-visible") && !empty) setActive(current => current ?? to - 1); }}>
        <svg className={styles.svg} width="100%" height={plotH} aria-hidden="true" focusable="false">
          <defs><clipPath id={`${uid}-plot`}><rect x={0} y={-8} width={Math.max(0, width * (reduced ? 1 : reveal))} height={plotH + 16} /></clipPath></defs>
          {ticks.slice(1).map(value => <line key={value} className={styles.grid} x1={0} x2="100%" y1={Math.round(y(value)) + .5} y2={Math.round(y(value)) + .5} />)}
          <line className={styles.baseline} x1={0} x2="100%" y1={plotH - .5} y2={plotH - .5} />
          {inWindow.map(event => <line key={event.t} className={styles.eventRule} x1={Math.round(x(event.t)) + .5} x2={Math.round(x(event.t)) + .5} y1={TOP - 10} y2={plotH} data-active={shownEvent?.t === event.t || eventAt?.t === event.t || undefined} />)}
          <g clipPath={`url(#${uid}-plot)`}>
            <path className={styles.band} d={band} style={{ opacity: 1 - detail }} />
            <path className={styles.area} d={area} style={{ opacity: detail }} />
            <path className={styles.trend} d={trend} style={{ opacity: 1 - detail }} />
            <path className={styles.line} d={line} style={{ opacity: detail }} />
          </g>
          <line className={styles.crosshair} x1={Math.round(cx) + .5} x2={Math.round(cx) + .5} y1={TOP - 10} y2={plotH} />
          <circle className={styles.dot} cx={cx} cy={cy} r={4} />
        </svg>
        {inWindow.map(event => { const px = x(event.t), i = events.indexOf(event); return <span key={event.t} className={styles.event} style={{ left: px }} data-labelled={labelled.has(event.t) || undefined} data-flip={labelled.get(event.t) || undefined} data-active={shownEvent?.t === event.t || eventAt?.t === event.t || undefined} aria-hidden="true"
          onPointerEnter={() => setHoverEvent(i)} onPointerLeave={() => setHoverEvent(null)} onPointerDown={event => event.stopPropagation()}>
          <span className={styles.eventDot} />
          <span className={styles.eventLabel}>{event.label}</span>
        </span>; })}
        <motion.div ref={tip} className={styles.tooltip} style={{ x: reduced ? tipX : tipSpringX, y: reduced ? tipY : tipSpringY }} aria-hidden="true">
          {shownEvent ? <>
            <p className={styles.tipTitle}>{formatDate(new Date(shownEvent.t))}</p>
            <p className={styles.tipValue}>{shownEvent.label}</p>
            {shownEvent.description && <p className={styles.tipNote}>{shownEvent.description}</p>}
          </> : reading ? <>
            <p className={styles.tipTitle}>{formatDate(new Date(reading.t))}</p>
            <p className={styles.tipValue}>{format(reading.value)}</p>
            {detail < 1 && index !== null && <p className={styles.tipNote}>{`${formatValue(Math.round(smooth[index].value))} seven day average`}</p>}
            {change !== null && <p className={styles.tipNote}>{`${change >= 0 ? "+" : "\u2212"}${Math.abs(change * 100).toFixed(1)}% vs a week earlier`}</p>}
            {eventAt && <p className={styles.tipEvent}><span className={styles.tipEventDot} />{eventAt.label}</p>}
          </> : null}
        </motion.div>
        {empty && <p className={styles.message}>{emptyLabel}</p>}
      </div>
      <div className={styles.gutter} aria-hidden="true">
        {ticks.map(value => <span key={value} className={styles.tick} style={{ top: y(value) }}>{formatTick(value)}</span>)}
      </div>
      <div className={styles.axis} aria-hidden="true">
        {xTicks.map(tick => { const px = x(tick.t); return <span key={tick.t} className={styles.axisLabel} style={{ left: px, translate: `${px < 24 ? 0 : px > width - 24 ? -100 : -50}% 0` }}>{tick.label}</span>; })}
      </div>
      <div ref={strip} className={styles.strip} style={{ height: overviewHeight }} onPointerDown={onStripDown} onPointerMove={onStripMove} onPointerUp={onStripUp} onPointerCancel={() => { drag.current = null; }} onDoubleClick={reset}>
        <svg className={styles.svg} width="100%" height={overviewHeight} aria-hidden="true" focusable="false">
          <defs><clipPath id={`${uid}-window`}><rect x={wx0} y={-2} width={Math.max(0, wx1 - wx0)} height={overviewHeight + 4} /></clipPath></defs>
          <path className={styles.overviewArea} d={overview.area} />
          <path className={styles.overviewLine} d={overview.line} />
          <g clipPath={`url(#${uid}-window)`}><path className={styles.overviewAreaIn} d={overview.area} /><path className={styles.overviewLineIn} d={overview.line} /></g>
          {overview.marks.map(mark => <circle key={mark.t} className={styles.overviewEvent} cx={mark.x} cy={mark.y} r={2.5} />)}
        </svg>
        {!empty && <>
          <div className={styles.shade} data-edge="start" style={{ left: 0, width: Math.max(0, wx0) }} />
          <div className={styles.shade} data-edge="end" style={{ left: wx1, right: 0 }} />
          <div className={styles.window} style={{ left: wx0, width: Math.max(0, wx1 - wx0) }} role="slider" tabIndex={0} aria-label={`${label} window`} aria-roledescription="range window" aria-valuemin={first} aria-valuemax={lastT} aria-valuenow={Math.round(start)} aria-valuetext={windowText} onKeyDown={event => onHandleKey(event, "window")} />
          <div className={styles.handle} style={{ left: wx0 }} role="slider" tabIndex={0} aria-label="Window start" aria-valuemin={first} aria-valuemax={Math.round(end)} aria-valuenow={Math.round(start)} aria-valuetext={shortDate.format(start)} onKeyDown={event => onHandleKey(event, "start")}><span className={styles.grip} /></div>
          <div className={styles.handle} style={{ left: wx1 }} role="slider" tabIndex={0} aria-label="Window end" aria-valuemin={Math.round(start)} aria-valuemax={lastT} aria-valuenow={Math.round(end)} aria-valuetext={shortDate.format(end)} onKeyDown={event => onHandleKey(event, "end")}><span className={styles.grip} /></div>
        </>}
      </div>
    </div>
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{announce}</p>
    <p className={styles.srOnly}>{summary}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{`${label}, ${windowText}`}</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">{label}</th><th scope="col">Event</th></tr></thead>
      <tbody>{points.slice(lowerBound(points, start), lowerBound(points, end + 1)).map(point => { const event = events.find(item => Math.abs(item.t - point.t) < DAY / 2); return <tr key={point.t}><th scope="row">{shortDate.format(point.t)}</th><td>{format(point.value)}</td><td>{event ? `${event.label}${event.description ? `. ${event.description}` : ""}` : ""}</td></tr>; })}</tbody>
    </table></div>}
  </figure>;
}

export default BrushChart;
