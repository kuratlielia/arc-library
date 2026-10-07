"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type Ref } from "react";
import { AnimatePresence, animate, frame, cancelFrame, motion, motionValue, useInView, useReducedMotion, type MotionValue, type Transition } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./donut-chart.module.css";

export interface DonutChartDatum {
  /** Stable identity. A segment whose key survives a data change keeps its place and color, so switching datasets morphs the arcs. */
  key: string;
  label: string;
  value: number;
  /** Any CSS color. Segments default to the shared --series-* palette in data order, then neutral steps. */
  color?: string;
}

/** Use a donut chart for a few parts of one whole, when the share of each part matters more than precise comparison. */
export interface DonutChartProps {
  data: DonutChartDatum[];
  /** What the whole is, such as "Visits by source". Names the chart for assistive technology. */
  label: string;
  /** Unit after values, such as "visits". */
  unit?: string;
  formatValue?: (value: number) => string;
  /** Center label at rest, above the total. */
  totalLabel?: string;
  /** Diameter in pixels. The chart scales down to fit narrower containers. */
  size?: number;
  /** Ring thickness in pixels. */
  thickness?: number;
  /** Segments below this share of the total join "Other". */
  groupBelow?: number;
  /** The most segments drawn, counting "Other". The smallest parts beyond it are grouped. */
  maxSegments?: number;
  otherLabel?: string;
  /** Controlled selected segment key. Hover and focus preview other segments without changing it. */
  activeKey?: string | null;
  defaultActiveKey?: string | null;
  onActiveChange?: (key: string | null) => void;
  /** Controlled hidden segment keys. A hidden segment closes and the rest of the ring redistributes. */
  hiddenKeys?: string[];
  defaultHiddenKeys?: string[];
  onHiddenKeysChange?: (keys: string[]) => void;
  /** What clicking a legend row does: show or hide its segment, or pin it as the selected segment. */
  legendAction?: "toggle" | "select";
  /** The synced legend beside or below the ring. */
  legend?: boolean;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
}

type Slice = { key: string; label: string; value: number; color?: string; members?: DonutChartDatum[] };
type Arc = { start: number; end: number };
type Segment = { start: MotionValue<number>; end: MotionValue<number>; lift: MotionValue<number>; off: () => void };

const OTHER = "__other";
const TAU = Math.PI * 2;
const { spring, ease, stagger, duration } = motionTokens;
/** Motion drops inherited velocity on time-defined springs, so values that retarget mid-flight run the same springs written as stiffness and damping. */
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .0005) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const reveal = physical({ visualDuration: .72, bounce: 0 });
const settle = physical({ visualDuration: .5, bounce: 0 });
const pop = physical(spring.snappy, .002);
/** Neutral steps after the four series colors, and the quietest step for Other. */
const NEUTRAL = [56, 42, 32];
const seriesColor = (index: number) => index < 4 ? `var(--series-${index + 1})` : `color-mix(in oklab, var(--foreground) ${NEUTRAL[(index - 4) % NEUTRAL.length]}%, var(--surface))`;
const OTHER_COLOR = "color-mix(in oklab, var(--foreground) 26%, var(--surface))";
/** Room left outside the ring for the lift; the gap between segments and their corner radius, in pixels. */
const LIFT = 4, GROW = 2, MARGIN = 7, GAP = 3, CORNER = 4;
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const shareText = (share: number) => share > 0 && share < .01 ? "<1%" : percent.format(share);

/** Small parts join one "Other" segment, but only when at least two would; grouping a single part hides it for nothing. */
function sliceData(data: DonutChartDatum[], groupBelow: number, maxSegments: number, otherLabel: string): Slice[] {
  const parts = data.filter(item => item.value > 0);
  const total = parts.reduce((sum, item) => sum + item.value, 0);
  if (!total) return [];
  const ranked = [...parts].sort((a, b) => b.value - a.value);
  const keep = new Set(ranked.filter((item, rank) => item.value / total >= groupBelow && rank < maxSegments - 1).map(item => item.key));
  const rest = parts.filter(item => !keep.has(item.key));
  if (rest.length < 2) return parts.map(item => ({ ...item }));
  return [...parts.filter(item => keep.has(item.key)).map(item => ({ ...item })), { key: OTHER, label: otherLabel, value: rest.reduce((sum, item) => sum + item.value, 0), members: rest }];
}

/** Turns of the ring for each slice in data order; a hidden slice closes to a point where it sits. */
function layout(slices: Slice[], hidden: Set<string>) {
  const total = slices.reduce((sum, item) => sum + (hidden.has(item.key) ? 0 : item.value), 0) || 1;
  let at = 0;
  return new Map(slices.map(item => { const arc = { start: at, end: at + (hidden.has(item.key) ? 0 : item.value / total) }; at = arc.end; return [item.key, arc]; }));
}

/** Half the width, in pixels, of a sector's outer edge once the gap is cut; below a couple of pixels a segment fades rather than drawing a hairline. */
function breadth(R: number, t0: number, t1: number, gap: number) {
  const turns = t1 - t0;
  if (turns >= 1 - 1e-6) return Infinity;
  return Math.sin(Math.min(turns * Math.PI, Math.PI / 2)) * R - Math.min(gap / 2, ((1 - turns) * TAU * R) / 2);
}

const n2 = (value: number) => (Math.round(value * 100) / 100).toString();
/**
 * An annular sector between two turns of the ring, measured clockwise from the top, with rounded corners.
 * Its sides run parallel to the radius at a fixed distance, so the gap between neighbours is the same number of pixels from the inner edge to the outer one.
 * A thin sector narrows to a wedge and then to nothing, so a closing segment never pops.
 */
function sector(c: number, R: number, r: number, t0: number, t1: number, gap: number, corner: number) {
  const turns = t1 - t0;
  if (turns <= 1e-6) return "";
  const at = (radius: number, angle: number) => `${n2(c + radius * Math.cos(angle))} ${n2(c + radius * Math.sin(angle))}`;
  if (turns >= 1 - 1e-6) return `M${at(R, -Math.PI / 2)}A${n2(R)} ${n2(R)} 0 1 1 ${at(R, Math.PI / 2)}A${n2(R)} ${n2(R)} 0 1 1 ${at(R, -Math.PI / 2)}ZM${at(r, -Math.PI / 2)}A${n2(r)} ${n2(r)} 0 1 0 ${at(r, Math.PI / 2)}A${n2(r)} ${n2(r)} 0 1 0 ${at(r, -Math.PI / 2)}Z`;
  // Half the gap on each side; a lone segment closes its gap as the rest of the ring empties, so it becomes a whole ring without a jump.
  const p = Math.min(gap / 2, ((1 - turns) * TAU * R) / 2);
  const a0 = t0 * TAU - Math.PI / 2, a1 = t1 * TAU - Math.PI / 2, half = (a1 - a0) / 2, s = Math.sin(Math.min(half, Math.PI / 2));
  if (s * R <= p + 1e-6) return "";
  const side = (t: number, angle: number, sign: number) => `${n2(c + t * Math.cos(angle) - sign * p * Math.sin(angle))} ${n2(c + t * Math.sin(angle) + sign * p * Math.cos(angle))}`;
  const band = (R - r) / 2;
  const ro = Math.max(0, Math.min(corner, band, s >= .9999 ? Infinity : (s * R - p) / (1 + s)));
  const dO = Math.asin(Math.min(1, (p + ro) / (R - ro))), tO = Math.sqrt(Math.max(0, (R - ro) ** 2 - (p + ro) ** 2));
  const bigO = a1 - a0 - 2 * dO > Math.PI ? 1 : 0;
  let d = `M${side(tO, a0, 1)}`;
  if (ro > .01) d += `A${n2(ro)} ${n2(ro)} 0 0 1 ${at(R, a0 + dO)}`;
  d += `A${n2(R)} ${n2(R)} 0 ${bigO} 1 ${at(R, a1 - dO)}`;
  if (ro > .01) d += `A${n2(ro)} ${n2(ro)} 0 0 1 ${side(tO, a1, -1)}`;
  if (s * r > p + 1e-6 || s >= .9999) {
    const ri = Math.max(0, Math.min(corner, band, s >= .9999 ? Infinity : (s * r - p) / (1 - s)));
    const dI = Math.asin(Math.min(1, (p + ri) / (r + ri))), tI = Math.sqrt(Math.max(0, (r + ri) ** 2 - (p + ri) ** 2));
    const bigI = a1 - a0 - 2 * dI > Math.PI ? 1 : 0;
    d += `L${side(tI, a1, -1)}`;
    if (ri > .01) d += `A${n2(ri)} ${n2(ri)} 0 0 1 ${at(r, a1 - dI)}`;
    d += `A${n2(r)} ${n2(r)} 0 ${bigI} 0 ${at(r, a0 + dI)}`;
    if (ri > .01) d += `A${n2(ri)} ${n2(ri)} 0 0 1 ${side(tI, a0, 1)}`;
  } else d += `L${at(p / s, (a0 + a1) / 2)}`;
  return `${d}Z`;
}

/** A number that counts to each new value, written straight to the DOM so no frame re-renders React. Whole targets count in whole steps. */
function Count({ value, format, reduced }: { value: number; format: (value: number) => string; reduced: boolean }) {
  const node = useRef<HTMLSpanElement>(null);
  const [initial] = useState(() => format(value));
  const live = useRef<{ mv: MotionValue<number>; format: (value: number) => string; target: number } | null>(null);
  useLayoutEffect(() => {
    const el = node.current;
    if (!el) return;
    if (!live.current) {
      const state = { mv: motionValue(value), format, target: value };
      state.mv.on("change", now => { el.textContent = state.format(Number.isInteger(state.target) ? Math.round(now) : now); });
      live.current = state;
    }
    const state = live.current;
    state.format = format;
    if (state.target === value && !reduced) { if (!state.mv.isAnimating()) el.textContent = format(value); return; }
    state.target = value;
    if (reduced) { state.mv.jump(value); el.textContent = format(value); return; }
    animate(state.mv, value, physical({ visualDuration: .4, bounce: 0 }, Math.max(Math.abs(value - state.mv.get()) * .001, 1e-6)));
  }, [value, format, reduced]);
  useEffect(() => () => { live.current?.mv.destroy(); live.current = null; }, []);
  return <span ref={node}>{initial}</span>;
}

/** Center readouts stay mounted in one grid cell and roll like a drum: the ones before the active segment wait above, the ones after it below. */
const drum = (place: number, reduced: boolean): { animate: { opacity: number; y: string }; transition: Transition } => ({
  animate: { opacity: place === 0 ? 1 : 0, y: `${.45 * Math.sign(place)}em` },
  transition: reduced ? { duration: 0 } : place === 0 ? { duration: duration.standard, ease: [...ease.enter] } : { duration: duration.fast, ease: [...ease.standard] },
});

const subscribeNothing = () => () => {};
function useReducedMotionSafe() {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

export function DonutChart({ data, label, unit = "", formatValue = value => grouped.format(value), totalLabel = "Total", size = 208, thickness = 24, groupBelow = .04, maxSegments = 6, otherLabel = "Other", activeKey, defaultActiveKey = null, onActiveChange, hiddenKeys, defaultHiddenKeys, onHiddenKeysChange, legendAction = "toggle", legend = true, emptyLabel = "No data yet", ref, className }: DonutChartProps) {
  const reduced = useReducedMotionSafe();
  const figure = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const inView = useInView(figure, { once: true, amount: .35 });
  const legendId = useId();
  const slices = sliceData(data, groupBelow, maxSegments, otherLabel);

  // Hidden segments are controlled or not, like selection.
  const [ownHidden, setOwnHidden] = useState<string[]>(defaultHiddenKeys ?? []);
  const hiddenList = hiddenKeys ?? ownHidden;
  const hidden = new Set(hiddenList.filter(key => slices.some(item => item.key === key)));
  const visible = slices.filter(item => !hidden.has(item.key));
  const total = visible.reduce((sum, item) => sum + item.value, 0);
  const signature = `${slices.map(item => `${item.key}:${item.value}${hidden.has(item.key) ? "h" : ""}`).join("|")}`;
  const suffix = unit ? ` ${unit}` : "";

  // Colors follow a key from the first time it is seen, so a segment keeps its color through every dataset.
  const [palette, setPalette] = useState(() => new Map(data.map((item, index) => [item.key, index])));
  if (data.some(item => !palette.has(item.key))) {
    const next = new Map(palette);
    for (const item of data) if (!next.has(item.key)) next.set(item.key, next.size);
    setPalette(next);
  }
  const colorFor = (item: Slice) => item.color ?? (item.key === OTHER ? OTHER_COLOR : seriesColor(palette.get(item.key) ?? 0));

  // Leaving segments stay drawn in their old place while they close, then drop out once they have.
  const [drawn, setDrawn] = useState<Slice[]>(slices);
  const [seenSignature, setSeenSignature] = useState(signature);
  if (seenSignature !== signature) {
    setSeenSignature(signature);
    const next = [...slices];
    drawn.forEach((item, index) => {
      if (next.some(slice => slice.key === item.key)) return;
      const before = drawn.slice(0, index).reverse().find(prior => next.some(slice => slice.key === prior.key));
      next.splice(before ? next.findIndex(slice => slice.key === before.key) + 1 : 0, 0, { ...item, value: 0 });
    });
    setDrawn(next);
  }

  // Selection is controlled or not; hover and focus preview on top of it.
  const [ownActive, setOwnActive] = useState<string | null>(defaultActiveKey);
  const selected = activeKey !== undefined ? activeKey : ownActive;
  const [preview, setPreview] = useState<string | null>(null);
  const select = (key: string | null) => { if (activeKey === undefined) setOwnActive(key); onActiveChange?.(key); };
  const current = [preview, selected].find(key => key && visible.some(item => item.key === key)) ?? null;
  const activeSlice = visible.find(item => item.key === current) ?? null;

  const [announcement, setAnnouncement] = useState("");
  const setHidden = (key: string) => {
    const isHidden = hidden.has(key);
    if (!isHidden && visible.length <= 1) return;
    const next = isHidden ? hiddenList.filter(item => item !== key) : [...hiddenList, key];
    if (hiddenKeys === undefined) setOwnHidden(next);
    onHiddenKeysChange?.(next);
    const item = slices.find(slice => slice.key === key);
    const nextTotal = slices.reduce((sum, slice) => sum + (next.includes(slice.key) ? 0 : slice.value), 0);
    if (item) setAnnouncement(`${item.label} ${isHidden ? "shown" : "hidden"}. ${totalLabel} ${formatValue(nextTotal)}${suffix}.`);
  };

  // Geometry in the chart's own units; the SVG scales with its container.
  const c = size / 2, outer = c - MARGIN, inner = Math.max(8, outer - thickness);
  const corner = Math.min(CORNER, thickness / 4);
  const geometry = useRef({ c, outer, inner, corner });
  const segments = useRef(new Map<string, Segment>());
  const paths = useRef(new Map<string, SVGPathElement>());
  const registerPath = useCallback((node: SVGPathElement | null) => {
    const key = node?.dataset.key;
    if (!node || !key) return;
    paths.current.set(key, node);
    return () => { if (paths.current.get(key) === node) paths.current.delete(key); };
  }, []);

  // One paint per frame, whatever moved: every path's shape and lift are written straight to the DOM.
  const paint = useCallback(() => {
    const { c, outer, inner, corner } = geometry.current;
    for (const [key, node] of paths.current) {
      const segment = segments.current.get(key);
      if (!segment) { node.setAttribute("d", ""); continue; }
      const start = segment.start.get(), end = segment.end.get(), lift = Math.max(0, segment.lift.get());
      const R = outer + lift * GROW;
      node.setAttribute("d", sector(c, R, inner - lift * GROW * .5, start, end, GAP, corner));
      node.setAttribute("fill-opacity", n2(Math.min(1, Math.max(0, (breadth(R, start, end, GAP) - 1) / 3))));
      const middle = ((start + end) / 2) * TAU - Math.PI / 2, distance = lift * LIFT;
      node.setAttribute("transform", `translate(${n2(Math.cos(middle) * distance)} ${n2(Math.sin(middle) * distance)})`);
    }
  }, []);
  const schedule = useCallback(() => { frame.render(paint); }, [paint]);
  useLayoutEffect(() => { geometry.current = { c, outer, inner, corner }; paint(); });
  useEffect(() => () => { cancelFrame(paint); for (const segment of segments.current.values()) segment.off(); segments.current.clear(); }, [paint]);

  const targets = useRef(new Map<string, Arc>());
  const latest = useRef({ drawn, slices });
  useLayoutEffect(() => { latest.current = { drawn, slices }; });

  // New data, or a segment shown or hidden, moves every arc from wherever it is on screen, keeping its velocity if it was already moving.
  const shown = inView || reduced;
  useEffect(() => {
    if (!shown) return;
    const { drawn: order, slices: now } = latest.current;
    const goal = layout(now, hidden);
    targets.current = goal;
    const first = segments.current.size === 0;
    const place = (index: number) => { const before = order.slice(0, index).reverse().find(item => goal.has(item.key)); return before ? goal.get(before.key)!.end : 0; };
    const drop = (key: string) => {
      if (latest.current.slices.some(item => item.key === key)) return;
      segments.current.get(key)?.off();
      segments.current.delete(key);
      setDrawn(list => list.filter(item => item.key !== key));
    };
    order.forEach((item, index) => {
      const leaving = !goal.has(item.key);
      const to = goal.get(item.key) ?? { start: place(index), end: place(index) };
      let segment = segments.current.get(item.key);
      if (!segment) {
        // A new segment opens from the edge of the one before it, as it is right now.
        const prior = order.slice(0, index).reverse().map(entry => segments.current.get(entry.key)).find(Boolean);
        const from = first ? 0 : prior ? prior.end.get() : 0;
        const start = motionValue(from), end = motionValue(from), lift = motionValue(0);
        const offs = [start.on("change", schedule), end.on("change", schedule), lift.on("change", schedule)];
        segment = { start, end, lift, off: () => { offs.forEach(off => off()); start.destroy(); end.destroy(); lift.destroy(); } };
        segments.current.set(item.key, segment);
      }
      if (reduced) {
        segment.start.jump(to.start); segment.end.jump(to.end);
        if (leaving) drop(item.key);
        return;
      }
      if (first) {
        // One sweep: every segment leaves the top together, and each trailing edge follows a beat behind the one before.
        animate(segment.start, to.start, reveal);
        animate(segment.end, to.end, { ...reveal, delay: .04 + index * stagger.item });
        return;
      }
      animate(segment.start, to.start, settle);
      animate(segment.end, to.end, { ...settle, onComplete: leaving ? () => drop(item.key) : undefined });
    });
    schedule();
  }, [shown, signature, reduced, schedule]); // eslint-disable-line react-hooks/exhaustive-deps

  // The active segment slides out along its middle and thickens a little; the one it replaces settles back at the same time.
  useEffect(() => {
    for (const [key, segment] of segments.current) {
      const to = key === current ? 1 : 0;
      if (reduced) segment.lift.jump(to);
      else if (segment.lift.get() !== to || segment.lift.isAnimating()) animate(segment.lift, to, pop);
    }
  }, [current, reduced, drawn, shown]);

  // One pointer handler for the whole ring: the angle picks the segment, so crossing a gap never drops the hover.
  const svg = useRef<SVGSVGElement>(null);
  const hit = (event: { clientX: number; clientY: number }) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !box.width) return undefined;
    const scale = size / box.width, x = (event.clientX - box.left) * scale - c, y = (event.clientY - box.top) * scale - c;
    const radius = Math.hypot(x, y);
    if (radius < inner - 6 || radius > c) return null;
    let turn = (Math.atan2(y, x) + Math.PI / 2) / TAU;
    if (turn < 0) turn += 1;
    for (const [key, arc] of targets.current) if (arc.end > arc.start && turn >= arc.start && turn < arc.end && visible.some(item => item.key === key)) return key;
    return undefined;
  };
  const onRingMove = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "mouse") return;
    const key = hit(event);
    if (key !== undefined && key !== preview) setPreview(key);
  };
  const onRingClick = (event: MouseEvent<SVGSVGElement>) => {
    const key = hit(event);
    if (key) select(selected === key ? null : key);
  };

  const format = (value: number) => `${formatValue(value)}${suffix}`;
  const describe = (item: Slice) => `${item.label}, ${format(item.value)}, ${shareText(item.value / (total || 1))}${item.members ? `. Includes ${item.members.map(member => member.label).join(", ")}` : ""}`;

  // Arrow keys walk the segments, in the legend or on the ring itself when there is no legend.
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const step = (key: string, index: number, count: number) => ({ ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: count - 1 } as Record<string, number>)[key];
  const onLegendKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape" && selected) { event.preventDefault(); select(null); return; }
    const next = step(event.key, index, slices.length);
    if (next === undefined) return;
    event.preventDefault();
    rows.current[(next + slices.length) % slices.length]?.focus();
  };
  const onRingKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!visible.length) return;
    if (event.key === "Escape") { event.preventDefault(); setPreview(null); if (selected) select(null); return; }
    if ((event.key === "Enter" || event.key === " ") && current) { event.preventDefault(); select(selected === current ? null : current); return; }
    const index = visible.findIndex(item => item.key === current);
    const next = step(event.key, index < 0 ? (event.key.endsWith("Up") || event.key.endsWith("Left") ? 0 : -1) : index, visible.length);
    if (next === undefined) return;
    event.preventDefault();
    const item = visible[(next + visible.length) % visible.length]!;
    setPreview(item.key);
    setAnnouncement(describe(item));
  };
  const onLegendBlur = (event: FocusEvent<HTMLButtonElement>) => { if (!(event.relatedTarget instanceof Node && event.currentTarget.closest("ul")?.contains(event.relatedTarget))) setPreview(null); };

  // One readout per segment plus the total; the active one rolls in from the side it sits on, so moving clockwise rolls the drum forward.
  const identity = activeSlice ? activeSlice.key : total ? "__total" : "__empty";
  const readouts = [{ key: "__total", label: total ? totalLabel : emptyLabel, value: total, meta: null as Slice | null }, ...slices.map(item => ({ key: item.key, label: item.label, value: item.value, meta: item as Slice | null }))];
  const activeIndex = Math.max(0, readouts.findIndex(item => item.key === (identity === "__empty" ? "__total" : identity)));

  const summary = total ? `${label}. ${totalLabel} ${format(total)}. ${visible.map(describe).join(". ")}.` : `${label}. ${emptyLabel}.`;
  const members = (item: Slice) => item.members ? item.members.length > 2 ? `${item.members.slice(0, 2).map(member => member.label).join(", ")} and ${item.members.length - 2} more` : item.members.map(member => member.label).join(" and ") : null;
  const ringLabel = `${label}. Use the arrow keys to read each segment.`;

  return <figure ref={figure} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label} data-legend={legend || undefined}>
    <div className={styles.ring} style={{ width: size, "--inner": `${(inner * 2) / size * 100}%` } as CSSProperties}
      tabIndex={legend ? undefined : 0} role={legend ? undefined : "group"} aria-label={legend ? undefined : ringLabel} onKeyDown={legend ? undefined : onRingKey} onBlur={legend ? undefined : () => setPreview(null)}>
      <svg ref={svg} className={styles.svg} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" onPointerMove={onRingMove} onPointerLeave={() => setPreview(null)} onClick={onRingClick} data-hovering={current !== null || undefined}>
        <circle className={styles.track} cx={c} cy={c} r={(outer + inner) / 2} strokeWidth={outer - inner} data-idle={(!shown || !total) || undefined} />
        {drawn.map(item => <path key={item.key} ref={registerPath} data-key={item.key} className={styles.segment} data-active={item.key === current || undefined} data-dim={(current !== null && item.key !== current) || undefined} style={{ "--slice": colorFor(item) } as CSSProperties} />)}
      </svg>
      <div className={styles.center} aria-hidden="true">
        {readouts.map((item, index) => <motion.span key={item.key} className={styles.readout} initial={false} {...drum(index - activeIndex, reduced)}>
          <span className={styles.centerLabel}>{item.label}</span>
          <span className={styles.centerValue}>{item.value || item.meta ? <Count value={item.value} format={formatValue} reduced={reduced} /> : " "}</span>
          <span className={styles.centerMeta}>{item.meta ? <><Count value={total && !hidden.has(item.key) ? item.value / total : 0} format={shareText} reduced={reduced} /> of {totalLabel.toLowerCase()}</> : unit || " "}</span>
        </motion.span>)}
      </div>
    </div>
    {legend && slices.length > 0 && <ul className={styles.legend} aria-label={`${label}, segments${legendAction === "toggle" ? ". Press a segment to show or hide it" : ""}`} id={legendId} onPointerLeave={() => setPreview(null)}>
      <AnimatePresence initial={false}>{slices.map((item, index) => {
        const off = hidden.has(item.key);
        // A row that joins or leaves (a part folding into Other, say) opens or closes its height, so the rows below and the card around them glide instead of jumping.
        return <motion.li key={item.key} className={styles.item} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : spring.smooth}>
          <button ref={node => { if (node) rows.current[index] = node; }} type="button" className={styles.row} aria-pressed={legendAction === "toggle" ? !off : selected === item.key} aria-label={off ? `${item.label}, hidden` : describe(item)} data-active={item.key === current || undefined} data-pinned={selected === item.key || undefined} data-hidden={off || undefined} style={{ "--slice": colorFor(item) } as CSSProperties}
            onClick={() => legendAction === "toggle" ? setHidden(item.key) : select(selected === item.key ? null : item.key)}
            onPointerEnter={event => { if (event.pointerType === "mouse") setPreview(off ? null : item.key); }}
            onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setPreview(off ? null : item.key); }} onBlur={onLegendBlur} onKeyDown={event => onLegendKey(event, index)}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{item.label}</span>
              {item.members && <span className={styles.rowMembers}>{members(item)}</span>}
            </span>
            <span className={styles.rowValue} aria-hidden="true"><Count value={item.value} format={formatValue} reduced={reduced} /></span>
            <span className={styles.rowShare} aria-hidden="true"><Count value={off || !total ? 0 : item.value / total} format={shareText} reduced={reduced} /></span>
          </button>
        </motion.li>;
      })}</AnimatePresence>
    </ul>}
    <p className={styles.srOnly}>{summary}</p>
    <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    {total > 0 && <table className={styles.srOnly}>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Segment</th><th scope="col">Value</th><th scope="col">Share</th></tr></thead>
      <tbody>{visible.flatMap(item => item.members ? item.members.map(member => ({ key: member.key, label: `${member.label} (${otherLabel})`, value: member.value })) : [item]).map(item => <tr key={item.key}><th scope="row">{item.label}</th><td>{format(item.value)}</td><td>{shareText(item.value / total)}</td></tr>)}</tbody>
    </table>}
  </figure>;
}

export default DonutChart;
