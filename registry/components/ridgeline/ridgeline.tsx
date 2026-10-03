"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./ridgeline.module.css";

export interface RidgelineSeries {
  /** Stable identity. A ridge that survives a data change morphs into its new shape. */
  id: string;
  label: string;
  /** Raw observations. The ridge is a smoothed density of these values. */
  values: number[];
}

/** Use a ridgeline to compare the shape of many distributions at once, such as daily temperatures by month or response times by region. */
export interface RidgelineProps {
  /** One ridge per series, drawn top to bottom. */
  series: RidgelineSeries[];
  /** What is measured, such as "Daily highs in Zurich". Names the chart for assistive technology. */
  label: string;
  /** Unit after each value, such as "°C". */
  unit?: string;
  formatValue?: (value: number) => string;
  /** Value range of the axis. Defaults to the data with a little room on each side. */
  domain?: [number, number];
  /** How far a ridge may rise into the rows above, in row heights. */
  overlap?: number;
  /** Height of one row in pixels. */
  rowHeight?: number;
  /** Smoothing in value units. Defaults to Silverman's rule per series. */
  bandwidth?: number;
  /** Shades each ridge by its median, from a light tint to the full first series color, and shows the scale under the axis. */
  tint?: boolean;
  /** Controlled id of the lifted ridge. */
  active?: string | null;
  defaultActive?: string | null;
  onActiveChange?: (id: string | null) => void;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
}

type Stats = { q1: number; median: number; q3: number; min: number; max: number; n: number; sorted: number[] };
type Shape = { xs: number[]; ys: number[]; row: number; q1: number; median: number; q3: number };

const { spring } = motionTokens;
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .0005) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const morph = physical({ visualDuration: .7, bounce: .08 });
const reveal = physical({ visualDuration: 1, bounce: 0 });
const glide = physical(spring.snappy, .01);
const follow = { stiffness: glide.stiffness, damping: glide.damping, restDelta: .01 };
const SAMPLES = 96, AXIS = 28, TIP = 14, LIFT = 6;
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const at = (sorted.length - 1) * q, low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}
function statsOf(values: number[]): Stats {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { sorted, n: sorted.length, min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0, q1: quantile(sorted, .25), median: quantile(sorted, .5), q3: quantile(sorted, .75) };
}
function silverman(stats: Stats) {
  if (stats.n < 2) return 1;
  const mean = stats.sorted.reduce((sum, value) => sum + value, 0) / stats.n;
  const sd = Math.sqrt(stats.sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (stats.n - 1));
  const spread = Math.min(sd, (stats.q3 - stats.q1) / 1.34 || sd);
  return Math.max(1e-6, .9 * (spread || 1) * Math.pow(stats.n, -.2));
}
function niceStep(span: number, count: number) {
  const raw = span / Math.max(1, count) || 1, power = Math.pow(10, Math.floor(Math.log10(raw))), unit = raw / power;
  return (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * power;
}
/** Samples a Gaussian kernel density across the domain. */
function density(stats: Stats, lo: number, hi: number, bandwidth: number) {
  const xs: number[] = [], ys: number[] = [];
  const norm = 1 / (Math.max(1, stats.n) * bandwidth * Math.sqrt(2 * Math.PI));
  for (let i = 0; i < SAMPLES; i++) {
    const x = lo + ((hi - lo) * i) / (SAMPLES - 1);
    let sum = 0;
    for (const value of stats.sorted) { const u = (x - value) / bandwidth; if (u > -5 && u < 5) sum += Math.exp(-.5 * u * u); }
    xs.push(x); ys.push(sum * norm);
  }
  return { xs, ys };
}
const heightAt = (shape: Shape, x: number) => {
  const { xs, ys } = shape;
  if (x <= xs[0] || x >= xs[xs.length - 1]) return 0;
  let i = 1;
  while (i < xs.length - 1 && xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
  return mix(ys[i - 1], ys[i], t);
};

const subscribeNothing = () => () => {};
function useReducedMotionSafe() {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

export function Ridgeline({ series, label, unit = "", formatValue, domain, overlap = 2.4, rowHeight = 30, bandwidth, tint = true, active, defaultActive = null, onActiveChange, emptyLabel = "No data yet", ref, className }: RidgelineProps) {
  const reduced = useReducedMotionSafe();
  const figure = useRef<HTMLElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const fills = useRef(new Map<string, SVGPathElement>());
  const lines = useRef(new Map<string, SVGPathElement>());
  const medians = useRef(new Map<string, SVGLineElement>());
  const lifted = useRef<{ fill: SVGPathElement | null; band: SVGPathElement | null; line: SVGPathElement | null; median: SVGLineElement | null; group: SVGGElement | null }>({ fill: null, band: null, line: null, median: null, group: null });
  const tickRefs = useRef(new Map<number, HTMLDivElement>());
  const cross = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const inView = useInView(figure, { once: true, amount: .3 });
  // A true minus sign keeps negative values tight and lined up with the tabular digits.
  const format = (value: number) => formatValue ? formatValue(value) : `${grouped.format(value).replace("-", "\u2212")}${unit}`;

  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = plot.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Targets: one density per series on a shared domain, scaled so the tallest peak of all rises `overlap` rows.
  const signature = JSON.stringify([series, domain, bandwidth]);
  const model = useMemo(() => {
    const stats = series.map(entry => statsOf(entry.values));
    const widths = stats.map(entry => bandwidth ?? silverman(entry));
    const filled = stats.map((entry, index) => ({ entry, room: 2.5 * widths[index] })).filter(({ entry }) => entry.n);
    let lo = domain?.[0] ?? Math.min(...filled.map(({ entry, room }) => entry.min - room));
    let hi = domain?.[1] ?? Math.max(...filled.map(({ entry, room }) => entry.max + room));
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) { lo = 0; hi = 1; }
    if (!domain) { const step = niceStep(hi - lo, 5); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; }
    const curves = stats.map((entry, index) => entry.n ? density(entry, lo, hi, widths[index]) : { xs: Array.from({ length: SAMPLES }, (_, i) => lo + ((hi - lo) * i) / (SAMPLES - 1)), ys: new Array(SAMPLES).fill(0) });
    const peak = Math.max(1e-9, ...curves.flatMap(curve => curve.ys));
    const shapes = new Map<string, Shape>(series.map((entry, index) => [entry.id, { xs: curves[index].xs, ys: curves[index].ys.map(y => y / peak), row: index, q1: stats[index].q1, median: stats[index].median, q3: stats[index].q3 }]));
    return { stats: new Map(series.map((entry, index) => [entry.id, stats[index]])), shapes, lo, hi };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ownActive, setOwnActive] = useState<string | null>(defaultActive);
  const current = active !== undefined ? active : ownActive;
  const setCurrent = (id: string | null) => { if (active === undefined) setOwnActive(id); if (id !== current) onActiveChange?.(id); };
  const [cursor, setCursor] = useState<{ value: number; pointerY: number | null } | null>(null);

  const narrow = width > 0 && width < 420;
  const gutter = narrow ? 36 : 52;
  const top = Math.ceil((overlap - 1) * rowHeight) + LIFT + 8;
  const height = top + series.length * rowHeight + AXIS;
  const plotWidth = Math.max(40, width - gutter - 4);
  const baselineOf = (row: number) => top + (row + 1) * rowHeight;

  // Drawn geometry lives outside React; a spring interpolates it from what is on screen to the new targets.
  const drawn = useRef({ shapes: new Map<string, Shape>(), lo: 0, hi: 1 });
  const live = useRef({ gutter, plotWidth, rowHeight, overlap, top, current });
  useLayoutEffect(() => { live.current = { gutter, plotWidth, rowHeight, overlap, top, current }; });
  const xOf = (value: number) => { const d = drawn.current, L = live.current; return L.gutter + ((value - d.lo) / (d.hi - d.lo || 1)) * L.plotWidth; };

  const paint = () => {
    const d = drawn.current, L = live.current;
    const sx = (value: number) => L.gutter + ((value - d.lo) / (d.hi - d.lo || 1)) * L.plotWidth;
    const lift = L.rowHeight * L.overlap;
    const curvePath = (shape: Shape, closed: boolean, from = -Infinity, to = Infinity) => {
      const base = L.top + (shape.row + 1) * L.rowHeight;
      const points: string[] = [];
      const push = (x: number, y: number) => points.push(`${sx(x).toFixed(2)},${(base - y * lift).toFixed(2)}`);
      if (from > -Infinity) push(from, heightAt(shape, from));
      shape.xs.forEach((x, i) => { if (x > from && x < to) push(x, shape.ys[i]); });
      if (to < Infinity) push(to, heightAt(shape, to));
      if (!points.length) return "";
      const first = from > -Infinity ? from : shape.xs[0], last = to < Infinity ? to : shape.xs[shape.xs.length - 1];
      return closed ? `M${sx(first).toFixed(2)},${base}L${points.join("L")}L${sx(last).toFixed(2)},${base}Z` : `M${points.join("L")}`;
    };
    for (const [id, shape] of d.shapes) {
      const fill = fills.current.get(id), line = lines.current.get(id), median = medians.current.get(id);
      fill?.setAttribute("d", curvePath(shape, true));
      line?.setAttribute("d", curvePath(shape, false));
      if (median) { const x = sx(shape.median), base = L.top + (shape.row + 1) * L.rowHeight; median.setAttribute("x1", x.toFixed(2)); median.setAttribute("x2", x.toFixed(2)); median.setAttribute("y1", String(base)); median.setAttribute("y2", (base - heightAt(shape, shape.median) * lift).toFixed(2)); }
    }
    const shape = L.current ? d.shapes.get(L.current) : undefined, lens = lifted.current;
    if (shape && lens.fill && lens.line && lens.band && lens.median) {
      lens.fill.setAttribute("d", curvePath(shape, true));
      lens.line.setAttribute("d", curvePath(shape, false));
      lens.band.setAttribute("d", curvePath(shape, true, shape.q1, shape.q3));
      const x = sx(shape.median), base = L.top + (shape.row + 1) * L.rowHeight;
      lens.median.setAttribute("x1", x.toFixed(2)); lens.median.setAttribute("x2", x.toFixed(2)); lens.median.setAttribute("y1", String(base)); lens.median.setAttribute("y2", (base - heightAt(shape, shape.median) * lift).toFixed(2));
    }
    for (const [value, tick] of tickRefs.current) tick.style.transform = `translate3d(${sx(value).toFixed(2)}px, 0, 0)`;
  };
  const paintRef = useRef(paint);
  useLayoutEffect(() => { paintRef.current = paint; });

  const shown = inView || reduced;
  useEffect(() => {
    if (!shown) return;
    const d = drawn.current;
    const first = d.shapes.size === 0;
    const from = new Map<string, Shape>();
    for (const [id, target] of model.shapes) {
      const now = d.shapes.get(id);
      from.set(id, now ? { ...now, xs: [...now.xs], ys: [...now.ys] } : { ...target, ys: target.ys.map(() => 0), q1: target.median, q3: target.median });
    }
    const fromLo = first ? model.lo : d.lo, fromHi = first ? model.hi : d.hi;
    const finish = () => { d.shapes = new Map([...model.shapes].map(([id, shape]) => [id, { ...shape }])); d.lo = model.lo; d.hi = model.hi; paintRef.current(); };
    if (reduced) { finish(); return; }
    d.shapes = new Map([...from].map(([id, shape]) => [id, { ...shape, xs: [...shape.xs], ys: [...shape.ys] }]));
    const controls = animate(0, 1, { ...(first ? reveal : morph), onUpdate: t => {
      d.lo = mix(fromLo, model.lo, t); d.hi = mix(fromHi, model.hi, t);
      for (const [id, to] of model.shapes) {
        const f = from.get(id)!, out = d.shapes.get(id)!;
        // Stagger the reveal a little from the top row down, so the ridges roll in like a wave.
        const local = first ? clamp((t - to.row * .025) / (1 - Math.min(.5, model.shapes.size * .025)), 0, 1) : t;
        for (let i = 0; i < SAMPLES; i++) { out.xs[i] = mix(f.xs[i], to.xs[i], local); out.ys[i] = mix(f.ys[i], to.ys[i], local); }
        out.row = mix(f.row, to.row, local); out.q1 = mix(f.q1, to.q1, local); out.median = mix(f.median, to.median, local); out.q3 = mix(f.q3, to.q3, local);
      }
      paintRef.current();
    }, onComplete: finish });
    return () => controls.stop();
  }, [shown, model, reduced]);
  useLayoutEffect(() => { paintRef.current(); });

  // Axis ticks for the target domain; their positions follow the drawn domain every frame.
  const tickCount = Math.max(2, Math.floor(plotWidth / 72));
  const step = niceStep(model.hi - model.lo, tickCount);
  const ticks: number[] = [];
  for (let value = Math.ceil(model.lo / step) * step; value <= model.hi + 1e-9; value += step) ticks.push(Math.round(value * 1e6) / 1e6 || 0);

  const activeStats = current ? model.stats.get(current) : undefined;
  const activeSeries = current ? series.find(entry => entry.id === current) : undefined;
  const reading = cursor && activeStats ? { value: cursor.value, below: activeStats.n ? activeStats.sorted.filter(value => value <= cursor.value).length / activeStats.n : 0 } : null;
  // The tooltip keeps its last content while it fades out, so it never collapses to an empty box on leave.
  const [held, setHeld] = useState<{ id: string; value: number | null } | null>(null);
  if (current && (held?.id !== current || held.value !== (reading?.value ?? null))) setHeld({ id: current, value: reading?.value ?? null });
  const tipSeries = held ? series.find(entry => entry.id === held.id) : undefined;
  const tipStats = held ? model.stats.get(held.id) : undefined;
  const tipBelow = held && held.value !== null && tipStats?.n ? tipStats.sorted.filter(value => value <= held.value!).length / tipStats.n : 0;

  // The tooltip trails the pointer or the keyboard cursor and stays inside the chart.
  const tipX = useMotionValue(0), tipY = useMotionValue(0);
  const tipSpringX = useSpring(tipX, follow), tipSpringY = useSpring(tipY, follow);
  const wasOn = useRef(false);
  useLayoutEffect(() => {
    const bubble = tip.current, shape = current ? model.shapes.get(current) : undefined;
    if (cross.current) cross.current.style.transform = `translate3d(${reading ? xOf(reading.value).toFixed(2) : 0}px, 0, 0)`;
    if (!bubble || !shape || !width) { wasOn.current = false; return; }
    const tw = bubble.offsetWidth, th = bubble.offsetHeight;
    const ax = reading ? xOf(reading.value) : xOf(shape.median);
    const ay = cursor?.pointerY ?? baselineOf(shape.row) - heightAt(shape, shape.median) * rowHeight * overlap - LIFT;
    let left = ax + TIP;
    if (left + tw > width) left = ax - TIP - tw;
    let y = ay - th - TIP;
    if (y < 0) y = ay + TIP;
    tipX.set(clamp(left, 0, Math.max(0, width - tw))); tipY.set(clamp(y, 0, Math.max(0, height - th)));
    if (!wasOn.current || reduced) { tipSpringX.jump(tipX.get()); tipSpringY.jump(tipY.get()); }
    wasOn.current = true;
  });

  const valueAt = (x: number) => { const d = drawn.current; return d.lo + clamp((x - gutter) / plotWidth, 0, 1) * (d.hi - d.lo); };
  const pick = (x: number, y: number) => {
    const value = valueAt(x), lift = rowHeight * overlap;
    let best: Shape | null = null, bestId: string | null = null;
    for (const [id, shape] of drawn.current.shapes) {
      const base = baselineOf(shape.row), h = heightAt(shape, value) * lift;
      if (y <= base + 2 && y >= base - h - 4 && (!best || shape.row > best.row)) { best = shape; bestId = id; }
    }
    if (!bestId) { const row = clamp(Math.floor((y - top) / rowHeight), 0, series.length - 1); bestId = series[row]?.id ?? null; }
    return { id: bestId, value };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < gutter - 8 || y > height - AXIS + 4) { if (event.pointerType === "mouse") { setCurrent(null); setCursor(null); } return; }
    const hit = pick(x, y);
    setCurrent(hit.id);
    setCursor({ value: hit.value, pointerY: y });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = current ? series.findIndex(entry => entry.id === current) : -1;
    const stats = (id: string | undefined) => id ? model.stats.get(id) : undefined;
    const choose = (index: number) => { event.preventDefault(); const next = series[clamp(index, 0, series.length - 1)]; if (!next) return; setCurrent(next.id); setCursor({ value: cursor?.value ?? stats(next.id)?.median ?? model.lo, pointerY: null }); };
    const nudge = (direction: number) => { event.preventDefault(); if (!current) { choose(0); return; } const base = cursor?.value ?? stats(current)?.median ?? model.lo; const next = clamp((Math.round(base / step) + direction) * step, model.lo, model.hi); setCursor({ value: next, pointerY: null }); };
    if (event.key === "ArrowDown") choose(at + 1);
    else if (event.key === "ArrowUp") choose(at < 0 ? 0 : at - 1);
    else if (event.key === "Home") choose(0);
    else if (event.key === "End") choose(series.length - 1);
    else if (event.key === "ArrowRight") nudge(1);
    else if (event.key === "ArrowLeft") nudge(-1);
    else if (event.key === "Escape" && current) { event.preventDefault(); setCurrent(null); setCursor(null); }
  };

  const empty = !series.length || series.every(entry => !entry.values.length);
  /** Ridge tone: one hue, the first series color, from a light tint (low median) to full strength (high median), so the scale never passes through a muddy middle. */
  const toneOf = (t: number) => `color-mix(in oklab, var(--series-1) ${Math.round(38 + clamp(t, 0, 1) * 62)}%, var(--surface))`;
  const ridgeColor = (value: number) => tint ? toneOf((value - model.lo) / (model.hi - model.lo || 1)) : "var(--series-1)";
  const describe = (entry: RidgelineSeries) => { const s = model.stats.get(entry.id)!; return `${entry.label}: median ${format(s.median)}, middle half ${format(s.q1)} to ${format(s.q3)}, range ${format(s.min)} to ${format(s.max)}, ${s.n} values`; };

  return <figure ref={figure} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label}>
    <div ref={plot} className={styles.plot} style={{ height }} data-active={current ? true : undefined} data-cursor={reading ? true : undefined} role="group" tabIndex={empty ? -1 : 0} aria-roledescription="ridgeline chart"
      aria-label={`${label}. Up and down arrows choose a ridge, left and right arrows move along the values.`}
      onPointerMove={onPointerMove} onPointerDown={onPointerMove} onPointerLeave={event => { if (event.pointerType === "mouse") { setCurrent(null); setCursor(null); } }} onKeyDown={onKeyDown} onBlur={() => { setCurrent(null); setCursor(null); }}>
      <div className={styles.ticks} aria-hidden="true" style={{ height: height - AXIS + 22 }}>
        {ticks.map(value => <div key={value} ref={element => { if (element) tickRefs.current.set(value, element); else tickRefs.current.delete(value); }} className={styles.tick} style={{ top: top - rowHeight * .5 }}>
          <span className={styles.tickLabel}>{format(value)}</span>
        </div>)}
      </div>
      <div ref={cross} className={styles.crosshair} style={{ top: top - rowHeight * .5, height: height - AXIS - top + rowHeight * .5 }} aria-hidden="true" />
      <svg className={styles.svg} width={width || undefined} height={height} viewBox={`0 0 ${Math.max(1, width)} ${height}`} aria-hidden="true" focusable="false">
        {series.map(entry => <g key={entry.id} className={styles.ridge} data-dim={current !== null && current !== entry.id || undefined} data-lifted={current === entry.id || undefined} style={{ "--ridge": ridgeColor(model.stats.get(entry.id)?.median ?? model.lo) } as CSSProperties}>
          <path ref={element => { if (element) fills.current.set(entry.id, element); else fills.current.delete(entry.id); }} className={styles.fill} />
          <line ref={element => { if (element) medians.current.set(entry.id, element); else medians.current.delete(entry.id); }} className={styles.median} />
          <path ref={element => { if (element) lines.current.set(entry.id, element); else lines.current.delete(entry.id); }} className={styles.line} />
        </g>)}
        <g ref={element => { lifted.current.group = element; }} className={styles.lens} data-on={current ? true : undefined} style={tipStats ? { "--ridge": ridgeColor(tipStats.median) } as CSSProperties : undefined}>
          <path ref={element => { lifted.current.fill = element; }} className={styles.lensFill} />
          <path ref={element => { lifted.current.band = element; }} className={styles.lensBand} />
          <line ref={element => { lifted.current.median = element; }} className={styles.lensMedian} />
          <path ref={element => { lifted.current.line = element; }} className={styles.lensLine} />
        </g>
      </svg>
      <div className={styles.labels} aria-hidden="true">
        {series.map((entry, index) => <span key={entry.id} className={styles.rowLabel} data-active={current === entry.id || undefined} style={{ top: baselineOf(index) - 18, width: gutter - 10 }}>{entry.label}</span>)}
      </div>
      {empty && <p className={styles.message}>{emptyLabel}</p>}
      <motion.div ref={tip} className={styles.tooltip} style={{ x: reduced ? tipX : tipSpringX, y: reduced ? tipY : tipSpringY }} aria-hidden="true">
        {tipSeries && tipStats && <>
          <p className={styles.tipTitle}>{tipSeries.label}</p>
          <p className={styles.tipValue}><span className={styles.tipKey}>Median</span><span>{format(tipStats.median)}</span></p>
          <p className={styles.tipRow}><span className={styles.tipKey}>Middle half</span><span>{format(tipStats.q1)} to {format(tipStats.q3)}</span></p>
          <p className={styles.tipRow}><span className={styles.tipKey}>Range</span><span>{format(tipStats.min)} to {format(tipStats.max)}</span></p>
          {held?.value != null && <p className={styles.tipNote}>{percent.format(tipBelow)} at or below {format(held.value)}</p>}
        </>}
      </motion.div>
    </div>
    {tint && !empty && <div className={styles.scale} aria-hidden="true">
      <span className={styles.scaleLabel}>Median</span>
      <span>{format(model.lo)}</span>
      <span className={styles.steps}>{[0, .25, .5, .75, 1].map(step => <span key={step} className={styles.step} style={{ "--ridge": toneOf(step) } as CSSProperties} />)}</span>
      <span>{format(model.hi)}</span>
    </div>}
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{activeSeries ? `${describe(activeSeries)}${reading ? `. ${percent.format(reading.below)} at or below ${format(reading.value)}` : ""}` : ""}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Series</th><th scope="col">Median</th><th scope="col">First quartile</th><th scope="col">Third quartile</th><th scope="col">Lowest</th><th scope="col">Highest</th><th scope="col">Count</th></tr></thead>
      <tbody>{series.map(entry => { const s = model.stats.get(entry.id)!; return <tr key={entry.id}><th scope="row">{entry.label}</th><td>{format(s.median)}</td><td>{format(s.q1)}</td><td>{format(s.q3)}</td><td>{format(s.min)}</td><td>{format(s.max)}</td><td>{s.n}</td></tr>; })}</tbody>
    </table></div>}
  </figure>;
}

export default Ridgeline;
