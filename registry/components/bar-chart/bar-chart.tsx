"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { AnimatePresence, animate, cancelFrame, frame, motion, useInView, useMotionValue, usePresence, useReducedMotion, useTransform, type MotionValue, type Variants } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./bar-chart.module.css";

export interface BarChartDatum {
  /** Stable identity, such as an ISO date. A bar whose key survives a data change keeps its place, so switching ranges morphs instead of redrawing. */
  key: string;
  /** Full label for the headline and screen readers, such as "Tue, Sep 15". */
  label: string;
  /** Short label under the bar, such as "T" or "Sep 14". Leave it out to keep the axis quiet. */
  axisLabel?: string;
  value: number;
}

/** Use a bar chart for one measure across a run of days, weeks, or months, when people compare each period against the rest and against the average. */
export interface BarChartProps {
  data: BarChartDatum[];
  /** What is measured, such as "Active minutes". Names the chart for assistive technology. */
  label: string;
  /** The range on show, such as "Sep 15–21, 2026". It rests under the headline. */
  period: string;
  /** Unit after each value, such as "min". */
  unit?: string;
  /** Headline label at rest, above the average. */
  averageLabel?: string;
  /** Headline label while a bar is scrubbed. */
  valueLabel?: string;
  /** Header of the first column in the data table read by screen readers. */
  categoryLabel?: string;
  /** Draws the average as a reference line that springs to each new range. */
  showAverage?: boolean;
  /** Plot height in pixels. */
  height?: number;
  formatValue?: (value: number) => string;
}

const { spring, duration, ease, blur, stagger } = motionTokens;
/** Motion drops inherited velocity on time-defined springs, so values that retarget mid-flight run the same springs written as stiffness and damping. */
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .01) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const settle = physical(spring.smooth);
const grow = physical(spring.morph);
const glide = physical(spring.snappy);
/** The zoom runs in fractions of the plot, so it rests far below a pixel. */
const zoom = physical(spring.smooth, .00001);
const collapse = physical({ visualDuration: duration.standard, bounce: 0 });
const fadeFast = { duration: duration.instant, ease: [...ease.standard] } as const;
/** Starts animations on the next frame, so the render that caused them never swallows a spring's first frames. Returns a cleanup. */
function soon(start: () => { stop: () => void }) {
  let controls: { stop: () => void } | null = null;
  const run = () => { controls = start(); };
  frame.update(run);
  return () => { cancelFrame(run); controls?.stop(); };
}

/** Room above the top gridline, the share of each slot a bar fills, its widest size, and the radius of its data end. */
const TOP = 12, FILL = .58, MAX_BAR = 28, RADIUS = 4;
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Clean gridlines: the smallest step of 1, 2, 3, or 5 that covers the data in four rows or fewer, so shared steps survive a range change. */
function scaleFor(max: number) {
  const safe = Math.max(max, 1);
  const magnitude = 10 ** Math.floor(Math.log10(safe / 4));
  for (const factor of [1, 2, 3, 5, 10]) {
    const step = factor * magnitude, rows = Math.ceil(safe / step);
    if (rows <= 4) return { top: rows * step, ticks: Array.from({ length: rows + 1 }, (_, row) => row * step) };
  }
  return { top: safe, ticks: [0, safe] };
}

/** A column that grows from a square baseline to a softly rounded data end. */
function barPath(x: number, w: number, h: number, base: number) {
  if (w <= 0 || h <= .01) return `M${x.toFixed(2)} ${base}H${(x + Math.max(w, 0)).toFixed(2)}Z`;
  const r = Math.min(RADIUS, w / 2, h), top = base - h, f = (value: number) => value.toFixed(2);
  return `M${f(x)} ${base}V${f(top + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(top)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(top + r)}V${base}Z`;
}

/** Slots count back from the latest bar, so the newest day stays pinned right while a longer range zooms out to the left. */
function usePlace(place: number, reduced: boolean) {
  const value = useMotionValue(place);
  useEffect(() => {
    if (value.get() === place) return;
    if (reduced) { value.jump(place); return; }
    return soon(() => animate(value, place, settle));
  }, [place, reduced, value]);
  return value;
}

type Frame = { width: MotionValue<number>; unit: MotionValue<number> };
const centerOf = ({ width, unit }: Frame, place: number) => width.get() - (place + .5) * width.get() * unit.get();

function Bar({ id, place, value, delay, shown, active, frame, scale, height, reduced }: { id: string; place: number; value: number; delay: number; shown: boolean; active: boolean; frame: Frame; scale: MotionValue<number>; height: number; reduced: boolean }) {
  const [isPresent, safeToRemove] = usePresence();
  const amount = useMotionValue(0);
  const slot = usePlace(place, reduced);
  const [firstDelay] = useState(delay);
  const grown = useRef(false);
  const remove = useRef(safeToRemove);
  useEffect(() => { remove.current = safeToRemove; }, [safeToRemove]);

  // A bar grows once it is seen, each a beat after its neighbour; later values settle without a delay.
  useEffect(() => {
    if (!isPresent) return;
    if (reduced) { amount.jump(value); grown.current = true; return; }
    if (!shown) return;
    const first = !grown.current;
    grown.current = true;
    return soon(() => animate(amount, value, first ? { ...grow, delay: firstDelay } : settle));
  }, [amount, firstDelay, isPresent, reduced, shown, value]);

  // A leaving bar sinks into the baseline, faster than a bar grows, while the zoom carries it out of the plot.
  useEffect(() => {
    if (isPresent) return;
    if (reduced) { remove.current?.(); return; }
    return soon(() => animate(amount, 0, { ...collapse, onComplete: () => remove.current?.() }));
  }, [amount, isPresent, reduced]);

  const d = useTransform(() => {
    const w = frame.width.get() * frame.unit.get(), size = Math.min(w * FILL, MAX_BAR), center = centerOf(frame, slot.get());
    return barPath(center - size / 2, size, (amount.get() / scale.get()) * (height - TOP), height);
  });
  return <motion.path className={styles.bar} data-key={id} data-active={active || undefined} d={d} />;
}

/** A value on the axis: its gridline and label ride the scale, so a taller range slides them down while new rows fade in above. */
function useRowY(value: number, scale: MotionValue<number>, height: number) {
  return useTransform(() => Math.round(height - (value / scale.get()) * (height - TOP)) + .5);
}

function Gridline({ value, scale, height }: { value: number; scale: MotionValue<number>; height: number }) {
  const y = useRowY(value, scale, height);
  if (value === 0) return null;
  return <motion.line className={styles.grid} x1={0} x2="100%" y1={y} y2={y} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeFast }} transition={{ duration: duration.standard, ease: [...ease.standard] }} />;
}

function TickLabel({ value, scale, height, avoid, format }: { value: number; scale: MotionValue<number>; height: number; avoid: MotionValue<number> | null; format: (value: number) => string }) {
  const y = useRowY(value, scale, height);
  // A tick label makes way where the average label sits beside it.
  const opacity = useTransform(() => avoid ? clamp((Math.abs(y.get() - avoid.get()) - 10) / 6, 0, 1) : 1);
  return <motion.span className={styles.tick} style={{ y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeFast }} transition={{ duration: duration.standard, ease: [...ease.standard] }}>
    <motion.span className={styles.tickText} style={{ opacity }}>{format(value)}</motion.span>
  </motion.span>;
}

function AxisLabel({ text, size, shift, place, frame, reduced }: { text: string; size: number; shift: number; place: number; frame: Frame; reduced: boolean }) {
  const slot = usePlace(place, reduced);
  // Centred under its bar and carried by the zoom. A label at either end keeps the nudge that holds it inside the settled plot.
  const x = useTransform(() => centerOf(frame, slot.get()) - size / 2 + shift);
  return <motion.span className={styles.axisLabel} style={{ x }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeFast }} transition={{ duration: duration.standard, ease: [...ease.standard] }}>{text}</motion.span>;
}

/** Axis labels that fit once the range has settled: every label, else every second, third, and so on, counted back from the latest so the newest date always shows and spacing stays even. */
function fittingLabels(data: BarChartDatum[], width: number, sizes: Record<string, number>) {
  const fitting = new Map<string, number>();
  if (!width) return fitting;
  const count = Math.max(1, data.length);
  const labels = data.flatMap((item, index) => {
    const size = item.axisLabel ? sizes[item.axisLabel] : undefined;
    if (size === undefined) return [];
    const natural = width - (data.length - 1 - index + .5) * (width / count) - size / 2;
    return [{ key: item.key, size, natural, left: clamp(natural, 0, Math.max(0, width - size)) }];
  }).reverse();
  for (let stride = 1; stride <= labels.length; stride++) {
    const picked = labels.filter((_, rank) => rank % stride === 0);
    if (stride === labels.length || picked.every((label, rank) => rank === 0 || label.left + label.size + 10 <= picked[rank - 1]!.left)) {
      picked.forEach(label => fitting.set(label.key, label.left - label.natural));
      break;
    }
  }
  return fitting;
}

/** Changed text rises from a soft blur in the direction it moved, and leaves a little faster than it arrives. */
const rise: Variants = {
  hidden: (direction: number) => ({ opacity: 0, y: `${.3 * direction}em`, filter: `blur(${blur.soft}px)` }),
  shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: duration.standard, ease: [...ease.enter] } },
  gone: (direction: number) => ({ opacity: 0, y: `${-.3 * direction}em`, filter: `blur(${blur.subtle}px)`, transition: { duration: duration.instant, ease: [...ease.standard] } }),
};
const fade: Variants = { hidden: { opacity: 0, y: 0, filter: "blur(0px)" }, shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: duration.fast } }, gone: { opacity: 0, y: 0, filter: "blur(0px)", transition: { duration: duration.instant } } };

function Swap({ text, direction, reduced }: { text: string; direction: number; reduced: boolean }) {
  return <span className={styles.swap}><AnimatePresence mode="popLayout" initial={false} custom={direction}>
    <motion.span key={text} className={styles.swapText} custom={direction} variants={reduced ? fade : rise} initial="hidden" animate="shown" exit="gone">{text}</motion.span>
  </AnimatePresence></span>;
}

/** A number rolls digit by digit, keyed by place from the right, so unchanged digits hold still. Its width springs to fit, so the unit beside it glides instead of jumping. */
function Roll({ text, direction, reduced }: { text: string; direction: number; reduced: boolean }) {
  const sizer = useRef<HTMLSpanElement>(null);
  const width = useMotionValue<number | "auto">("auto");
  useLayoutEffect(() => {
    const node = sizer.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let measured: string | null = null;
    // Only a new value springs; a late web font or a resize jumps straight to fit.
    const observer = new ResizeObserver(() => {
      const next = node.offsetWidth;
      if (measured !== null && measured !== node.textContent && !reduced) animate(width, next, grow);
      else width.jump(next);
      measured = node.textContent;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced, width]);
  const chars = [...text];
  const variants = reduced ? fade : rise;
  return <motion.span className={styles.roll} style={{ width }}>
    <span ref={sizer} className={styles.sizer} aria-hidden="true">{text}</span>
    <span className={styles.digits}><AnimatePresence mode="popLayout" initial={false} custom={direction} anchorX="right">
      {chars.map((char, index) => <motion.span key={`p${chars.length - index}`} className={styles.digit} custom={direction} variants={variants} initial="hidden" animate="shown" exit="gone">
        <AnimatePresence mode="popLayout" initial={false} custom={direction} anchorX="right">
          <motion.span key={char} className={styles.digit} custom={direction} variants={variants} initial="hidden" animate="shown" exit="gone">{char}</motion.span>
        </AnimatePresence>
      </motion.span>)}
    </AnimatePresence></span>
  </motion.span>;
}

const subscribeNothing = () => () => {};
/** Reduced motion is only known in the browser, so the first client render matches the server before it takes effect. */
function useReducedMotionSafe() {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

export function BarChart({ data, label, period, unit = "", averageLabel = "Daily average", valueLabel = "Total", categoryLabel = "Day", showAverage = true, height = 176, formatValue = value => grouped.format(value) }: BarChartProps) {
  const reduced = useReducedMotionSafe();
  const figure = useRef<HTMLElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const inView = useInView(figure, { once: true, amount: .35 });
  const titleId = useId();
  const count = Math.max(data.length, 1), last = data.length - 1;
  const average = data.length ? data.reduce((sum, item) => sum + item.value, 0) / data.length : 0;
  const peak = data.reduce((max, item) => Math.max(max, item.value), 0);
  const { top, ticks } = useMemo(() => scaleFor(peak), [peak]);
  const signature = data.map(item => item.key).join("|");
  const suffix = unit ? ` ${unit}` : "";

  // Bars that join an existing chart grow outward from the ones that stayed; the first reveal runs left to right.
  const [known, setKnown] = useState(() => ({ signature, keys: new Set(data.map(item => item.key)), fresh: new Map<string, number>(), changes: 0 }));
  const [active, setActive] = useState<number | null>(null);
  if (known.signature !== signature) {
    const incoming = data.map((item, index) => ({ key: item.key, place: last - index })).filter(item => !known.keys.has(item.key)).sort((a, b) => a.place - b.place);
    const step = Math.min(stagger.item, .32 / Math.max(1, incoming.length));
    setKnown({ signature, keys: new Set(data.map(item => item.key)), fresh: new Map(incoming.map((item, rank) => [item.key, rank * step])), changes: known.changes + 1 });
    setActive(null);
  }
  const revealStep = Math.min(stagger.item, .36 / count);
  const index = active === null ? null : Math.min(active, last);
  const scrubbing = index !== null && last >= 0;
  const shownValue = scrubbing ? data[index]!.value : average;
  // Headline copy moves the way the data did: a larger value rises from below, a later day arrives from below too.
  const [trend, setTrend] = useState({ value: shownValue, index, valueWay: 1, indexWay: 1 });
  if (trend.value !== shownValue || trend.index !== index) setTrend({ value: shownValue, index, valueWay: shownValue === trend.value ? trend.valueWay : shownValue > trend.value ? 1 : -1, indexWay: index === null || trend.index === null ? 1 : Math.sign(index - trend.index) || 1 });

  const width = useMotionValue(0);
  const unitShare = useMotionValue(1 / count);
  const scale = useMotionValue(top);
  const mean = useMotionValue(0);
  const cursor = useMotionValue(0);
  const frame = useMemo(() => ({ width, unit: unitShare }), [width, unitShare]);

  // The chart draws in its own pixels; the width is read before paint and followed on resize. Axis labels wait for it, then thin out where they would collide.
  const [plotWidth, setPlotWidth] = useState(0);
  const [labelSizes, setLabelSizes] = useState<Record<string, number>>({});
  const measure = useRef<HTMLSpanElement>(null);
  const labelTexts = [...new Set(data.map(item => item.axisLabel).filter((text): text is string => !!text))].join("\n");
  useLayoutEffect(() => {
    const node = plot.current, ruler = measure.current;
    if (!node || !ruler) return;
    const read = () => {
      width.set(node.clientWidth);
      setPlotWidth(node.clientWidth);
      const sizes: Record<string, number> = {};
      ruler.querySelectorAll<HTMLElement>("[data-text]").forEach(item => { sizes[item.dataset.text ?? ""] = item.offsetWidth; });
      setLabelSizes(current => Object.keys(sizes).every(text => current[text] === sizes[text]) ? current : sizes);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    observer.observe(ruler);
    return () => observer.disconnect();
  }, [labelTexts, width]);
  const shownLabels = useMemo(() => fittingLabels(data, plotWidth, labelSizes), [data, plotWidth, labelSizes]);

  // A new range zooms the time axis around the latest bar, rescales the gridlines, and moves the average, all on springs that can be retargeted mid-flight.
  useEffect(() => {
    if (reduced) { unitShare.jump(1 / count); scale.jump(top); return; }
    return soon(() => { const controls = [animate(unitShare, 1 / count, zoom), animate(scale, top, settle)]; return { stop: () => controls.forEach(control => control.stop()) }; });
  }, [count, reduced, scale, top, unitShare]);
  // The average rises with the first bars, then springs to each new range.
  const meanStarted = useRef(false);
  useEffect(() => {
    if (reduced) { mean.jump(average); return; }
    if (!inView) return;
    const first = !meanStarted.current;
    meanStarted.current = true;
    return soon(() => animate(mean, average, first ? { ...settle, delay: .12 } : settle));
  }, [average, inView, mean, reduced]);

  // The cursor appears on the first scrubbed bar and glides between the ones after it.
  const wasScrubbing = useRef(false);
  useEffect(() => {
    if (index === null) { wasScrubbing.current = false; return; }
    const place = last - index;
    if (reduced || !wasScrubbing.current) cursor.jump(place);
    wasScrubbing.current = true;
    if (reduced) return;
    const controls = animate(cursor, place, glide);
    return () => controls.stop();
  }, [cursor, index, last, reduced]);

  const cursorX = useTransform(() => Math.round(centerOf(frame, cursor.get())) + .5);
  const meanY = useTransform(() => Math.round(height - (mean.get() / scale.get()) * (height - TOP)) + .5);
  const meanText = useTransform(() => `Avg ${formatValue(Math.round(mean.get()))}`);

  const pointAt = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect?.width) return last;
    const place = Math.floor(((rect.right - clientX) / rect.width) * count);
    return clamp(last - place, 0, last);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && scrubbing) { event.preventDefault(); setActive(null); return; }
    const from = index ?? last + 1, page = Math.min(7, count);
    const next = ({ ArrowLeft: from - 1, ArrowDown: from - 1, ArrowRight: index === null ? last : from + 1, ArrowUp: index === null ? last : from + 1, PageDown: from - page, PageUp: from + page, Home: 0, End: last } as Record<string, number>)[event.key];
    if (next === undefined || last < 0) return;
    event.preventDefault();
    setActive(clamp(next, 0, last));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture?.(event.pointerId);
    setActive(pointAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse" || event.buttons) setActive(pointAt(event.clientX)); };
  const release = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== "mouse") setActive(null); };

  const scrubbed = scrubbing ? data[index] : null;
  const reading = scrubbed ?? data[last];
  const valueText = reading ? `${reading.label}: ${formatValue(reading.value)}${suffix}` : "No data";
  const highest = data.reduce<BarChartDatum | null>((best, item) => !best || item.value > best.value ? item : best, null);
  const lowest = data.reduce<BarChartDatum | null>((best, item) => !best || item.value < best.value ? item : best, null);
  const summary = `${label}, ${period}. ${averageLabel} ${formatValue(Math.round(average))}${suffix}.${highest ? ` Highest ${highest.label}, ${formatValue(highest.value)}${suffix}.` : ""}${lowest && lowest !== highest ? ` Lowest ${lowest.label}, ${formatValue(lowest.value)}${suffix}.` : ""}`;
  const shown = inView || reduced;
  const avoid = showAverage ? meanY : null;

  return <figure ref={figure} className={styles.figure} aria-labelledby={titleId}>
    <figcaption id={titleId} className={styles.srOnly}>{label}, {period}</figcaption>
    <div className={styles.header} aria-hidden="true">
      <span className={styles.kind}><Swap text={scrubbing ? valueLabel : averageLabel} direction={1} reduced={reduced} /></span>
      <span className={styles.value}><Roll text={formatValue(scrubbing ? data[index]!.value : Math.round(average))} direction={trend.valueWay} reduced={reduced} />{unit && <span className={styles.unit}>{unit}</span>}</span>
      <span className={styles.when}><Swap text={scrubbed ? scrubbed.label : period} direction={scrubbing ? trend.indexWay : 1} reduced={reduced} /></span>
    </div>
    <div className={styles.chart} data-scrubbing={scrubbing || undefined}>
      <div ref={plot} className={styles.plot} style={{ height }}>
        <svg className={styles.svg} width="100%" height={height} role="img" aria-label={summary}>
          <AnimatePresence initial={false}>{ticks.map(value => <Gridline key={value} value={value} scale={scale} height={height} />)}</AnimatePresence>
          <motion.line className={styles.cursor} x1={cursorX} x2={cursorX} y1={TOP} y2={height} initial={false} animate={{ opacity: scrubbing ? 1 : 0 }} transition={reduced ? { duration: 0 } : fadeFast} />
          <AnimatePresence initial={false}>
            {data.map((item, at) => <Bar key={item.key} id={item.key} place={last - at} value={item.value} delay={known.fresh.get(item.key) ?? at * revealStep} shown={shown} active={index === at} frame={frame} scale={scale} height={height} reduced={reduced} />)}
          </AnimatePresence>
          <line className={styles.baseline} x1={0} x2="100%" y1={height - .5} y2={height - .5} />
          {showAverage && <motion.line className={styles.mean} x1={0} x2="100%" y1={meanY} y2={meanY} initial={false} animate={{ opacity: shown ? 1 : 0 }} transition={reduced ? { duration: 0 } : { duration: duration.standard, delay: .12 }} />}
        </svg>
      </div>
      <div className={styles.gutter} aria-hidden="true">
        <AnimatePresence initial={false}>{ticks.map(value => <TickLabel key={value} value={value} scale={scale} height={height} avoid={avoid} format={formatValue} />)}</AnimatePresence>
        {showAverage && <motion.span className={styles.meanLabel} style={{ y: meanY }} initial={false} animate={{ opacity: shown ? 1 : 0 }} transition={reduced ? { duration: 0 } : { duration: duration.standard, delay: .12 }}><motion.span className={styles.tickText}>{meanText}</motion.span></motion.span>}
      </div>
      <div className={styles.axis} aria-hidden="true">
        <AnimatePresence initial={false}>
          {data.map((item, at) => item.axisLabel && shownLabels.has(item.key) ? <AxisLabel key={`${item.key}:${item.axisLabel}`} text={item.axisLabel} size={labelSizes[item.axisLabel] ?? 0} shift={shownLabels.get(item.key) ?? 0} place={last - at} frame={frame} reduced={reduced} /> : null)}
        </AnimatePresence>
        <span ref={measure} className={styles.measure}>{labelTexts.split("\n").filter(Boolean).map(text => <span key={text} data-text={text}>{text}</span>)}</span>
      </div>
      {/* The scrubber lies over the plot: hover or drag across it, or focus it and use the arrow keys. Vertical swipes still scroll the page. */}
      <div className={styles.scrubber} role="slider" tabIndex={0} aria-label={`${label}, explore by ${categoryLabel.toLowerCase()}`} aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={Math.max(1, data.length)} aria-valuenow={(index ?? last) + 1} aria-valuetext={valueText}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={release} onPointerCancel={() => setActive(null)} onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }} onKeyDown={onKeyDown} onBlur={() => setActive(null)}
        onFocus={event => { if (event.currentTarget.matches(":focus-visible") && last >= 0) setActive(current => current ?? last); }} />
    </div>
    <table className={styles.srOnly}>
      <caption>{label}, {period}</caption>
      <thead><tr><th scope="col">{categoryLabel}</th><th scope="col">{label}</th></tr></thead>
      <tbody>{data.map(item => <tr key={item.key}><th scope="row">{item.label}</th><td>{formatValue(item.value)}{suffix}</td></tr>)}</tbody>
    </table>
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{known.changes ? `${period}. ${averageLabel} ${formatValue(Math.round(average))}${suffix}.` : ""}</p>
  </figure>;
}

export default BarChart;
