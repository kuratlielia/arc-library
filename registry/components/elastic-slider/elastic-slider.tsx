"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity, type MotionStyle } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./elastic-slider.module.css";

export interface ElasticSliderMark { value: number; label?: string; }

export interface ElasticSliderProps {
  /** Visible label; it also names the thumb. */
  label: string;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  /** Runs once a drag is released or a key changes the value. */
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** PageUp, PageDown, and Shift with an arrow move this far. Defaults to a tenth of the range. */
  largeStep?: number;
  /** Detents. A dragged thumb clicks into each one and holds for a few pixels before letting go. Labels print under the track. */
  marks?: (number | ElasticSliderMark)[];
  /** Formats the readout, the bubble, and the spoken value. */
  format?: (value: number) => string;
  /** Show the value beside the label. The bubble over the thumb still appears while dragging or using keys. */
  showValue?: boolean;
  /** Icons at either end. The one on the side being pulled past its limit is pushed outward with the track. */
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  /** Submits the value with a form. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

type Drag = { pointer: number; grab: number; samples: { t: number; p: number }[]; detent: number | null; edge: number; type: string };

const { spring, duration, blur } = motionTokens;
const enterEase = [...motionTokens.ease.enter] as [number, number, number, number];
const exitEase = [...motionTokens.ease.standard] as [number, number, number, number];
/** Motion drops velocity on time-defined springs, so anything a gesture hands off to runs the same spring written as stiffness and damping. */
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .002) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 10 }; };
const thumbSpring = physical(spring.snappy);
/** The stretch lets go with more life than anything else here: it is the one thing the user threw. */
const snapBack = physical({ visualDuration: .5, bounce: .42 }, .05);
/** Pixels the track may stretch past a limit, the pixel reach of a detent, and the speed a key press at a limit hits the wall with. */
const STRETCH = 26, DETENT_PX = 7, BUMP_PX = 260;
/** iOS style resistance: each pixel past the limit gives less, and never more than `limit`. */
const rubber = (distance: number, limit = STRETCH) => Math.sign(distance) * (1 - 1 / (Math.abs(distance) * .55 / limit + 1)) * limit;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const decimalsOf = (value: number) => (String(value).split(".")[1] ?? "").length;

const bubbleIn = { opacity: 0, scale: .7, y: 6, filter: `blur(${blur.subtle}px)` };
const bubbleRest = { opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } };
const bubbleOut = { opacity: 0, scale: .85, y: 4, filter: `blur(${blur.subtle}px)`, transition: { duration: duration.instant, ease: exitEase } };
const bubbleEnter = { ...spring.snappy, opacity: { duration: duration.fast, ease: enterEase }, filter: { duration: duration.fast, ease: enterEase } };

/**
 * A single value slider made of something that gives. The thumb swells under the finger, the track stretches like rubber past either
 * end and springs back with the release velocity, a value tag hangs off the thumb and sways with its speed, and marks act as detents
 * the thumb clicks into. Arrows, Shift+arrows, PageUp, PageDown, Home, and End work as in a native range input.
 */
export function ElasticSlider({ label, value, defaultValue, onValueChange, onValueCommit, min = 0, max = 100, step: stepProp = 1, largeStep, marks, format, showValue = true, startIcon, endIcon, name, disabled, className }: ElasticSliderProps) {
  const reduced = useReducedMotion() ?? false;
  const labelId = useId();
  const step = stepProp > 0 ? stepProp : 1;
  const span = max - min || 1;
  const decimals = Math.max(decimalsOf(step), decimalsOf(min));
  const [internal, setInternal] = useState(() => clamp(defaultValue ?? min, min, max));
  const current = value === undefined ? internal : clamp(value, min, max);
  const formatValue = format ?? ((input: number) => input.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  const pct = (input: number) => ((input - min) / span) * 100;
  const valueAt = (percent: number) => min + (percent / 100) * span;
  const snap = (input: number) => clamp(Number((min + Math.round((input - min) / step) * step).toFixed(decimals)), min, max);
  const markList = (marks ?? []).map(mark => typeof mark === "number" ? { value: mark } as ElasticSliderMark : mark).filter(mark => mark.value >= min && mark.value <= max);

  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const tickRefs = useRef(new Map<number, HTMLSpanElement>());
  const latest = useRef(current);
  const goal = useRef(pct(current));
  const drag = useRef<Drag | null>(null);
  const width = useRef(1);
  const lingerTimer = useRef<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [keyed, setKeyed] = useState(false);
  const [linger, setLinger] = useState(false);

  // The thumb is a committed position plus a catch-up offset, so it can glide into a detent or to a pressed spot while the pointer
  // keeps moving the position 1:1. `over` is the rubber-band stretch in pixels, signed by side.
  const pos = useMotionValue(pct(current));
  const lag = useMotionValue(0);
  const over = useMotionValue(0);
  const press = useMotionValue(0);
  const shown = useTransform(() => pos.get() + lag.get());
  const thumbX = useTransform(shown, at => `${at - 100}%`);
  const clipPath = useTransform(shown, at => `inset(0 ${(100 - clamp(at, 0, 100)).toFixed(3)}% 0 0 round 999px)`);
  // Stretch: the track grows away from its anchored end and thins as it does, like a band pulled tight. A press thickens it a little.
  const scaleX = useTransform(over, px => 1 + Math.abs(px) / width.current);
  const originX = useTransform(over, px => px < 0 ? 1 : 0);
  const scaleY = useTransform(() => (1 + press.get() * .45) * (1 - (Math.abs(over.get()) / STRETCH) * .32));
  const startShift = useTransform(over, px => Math.min(0, px));
  const endShift = useTransform(over, px => Math.max(0, px));
  // The tag trails the thumb on a soft spring, so it lags more the faster the thumb moves, and swings on its tail with that speed.
  const trailed = useSpring(shown, { stiffness: 420, damping: 30, mass: .7 });
  const bubbleAt = reduced ? shown : trailed;
  const bubbleX = useTransform(bubbleAt, at => `${at - 100}%`);
  const speed = useVelocity(trailed);
  const rotate = useTransform(speed, velocity => reduced ? 0 : clamp((-velocity / 100) * width.current * .009, -11, 11));

  const emit = (next: number) => {
    if (latest.current === next) return;
    latest.current = next;
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  // Values from outside a drag (keys, props) spring the thumb to their place from wherever it is on screen.
  useLayoutEffect(() => {
    latest.current = current;
    const target = pct(current);
    if (drag.current || goal.current === target) return;
    goal.current = target;
    const from = pos.get() + lag.get();
    lag.jump(0);
    pos.jump(from);
    if (reduced) pos.jump(target); else animate(pos, target, thumbSpring);
  });
  useEffect(() => {
    const node = trackRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry) width.current = entry.contentRect.width || 1; });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => window.clearTimeout(lingerTimer.current), []);

  /** A detent answers with a small pop of its tick and, where the device supports it, a short tap of vibration. */
  function pulse(mark: number, haptic: boolean) {
    const node = tickRefs.current.get(mark);
    if (node && !reduced) animate(node, { scale: [1, 2.1, 1] }, { duration: .34, ease: enterEase });
    if (haptic && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(6);
  }
  /** Moves the thumb to a new resting spot through a spring on the catch-up offset, so the jump reads as travel. */
  function glide(placed: number) {
    const from = pos.get() + lag.get();
    pos.set(placed);
    if (reduced) { lag.jump(0); return; }
    lag.jump(from - placed);
    animate(lag, 0, thumbSpring);
  }
  const detentAt = (percent: number) => {
    let best: number | null = null, gap = DETENT_PX + 1;
    for (const mark of markList) { const distance = Math.abs(((percent - pct(mark.value)) / 100) * width.current); if (distance <= DETENT_PX && distance < gap) { best = mark.value; gap = distance; } }
    return best;
  };

  function follow(state: Drag, at: number, time: number, first = false) {
    const raw = at - state.grab;
    const edge = clamp(raw, 0, 100);
    over.set(reduced ? 0 : rubber(((raw - edge) / 100) * width.current));
    const detent = detentAt(edge);
    const placed = detent === null ? edge : pct(detent);
    if (first || detent !== state.detent) {
      if (detent !== null && !first) pulse(detent, state.type === "touch");
      glide(placed);
    } else pos.set(placed);
    state.detent = detent;
    state.edge = edge;
    state.samples.push({ t: time, p: placed });
    if (state.samples.length > 6) state.samples.shift();
    emit(detent ?? snap(valueAt(edge)));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    width.current = rect.width || 1;
    const at = ((event.clientX - rect.left) / width.current) * 100;
    const grabbed = !!(event.target as HTMLElement).closest("[data-thumb]");
    event.currentTarget.setPointerCapture(event.pointerId);
    const from = pos.get() + lag.get();
    lag.jump(0);
    pos.jump(from);
    const state: Drag = { pointer: event.pointerId, grab: grabbed ? at - from : 0, samples: [], detent: null, edge: from, type: event.pointerType };
    drag.current = state;
    setDragging(true);
    window.clearTimeout(lingerTimer.current);
    setLinger(false);
    thumbRef.current?.focus({ preventScroll: true });
    if (reduced) press.jump(1); else animate(press, 1, spring.snappy);
    // A grabbed thumb stays put under the finger; a pressed track pulls the thumb over on a spring.
    follow(state, grabbed ? from + state.grab : at, event.timeStamp, true);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    follow(state, ((event.clientX - rect.left) / (rect.width || 1)) * 100, event.timeStamp);
  }
  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    drag.current = null;
    const samples = state.samples, first = samples[0], last = samples[samples.length - 1];
    const elapsed = last && first ? (last.t - first.t) / 1000 : 0;
    const velocity = (elapsed > .008 && event.timeStamp - last!.t < 60 ? (last!.p - first!.p) / elapsed : 0) + lag.getVelocity();
    const next = state.detent ?? snap(valueAt(state.edge));
    const from = pos.get() + lag.get(), target = pct(next);
    lag.jump(0);
    pos.jump(from);
    goal.current = target;
    if (reduced) { pos.jump(target); over.jump(0); press.jump(0); }
    else {
      animate(pos, target, { ...thumbSpring, velocity });
      animate(over, 0, { ...snapBack, velocity: over.getVelocity() });
      animate(press, 0, spring.snappy);
    }
    emit(next);
    setDragging(false);
    setLinger(true);
    lingerTimer.current = window.setTimeout(() => setLinger(false), 700);
    onValueCommit?.(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const now = latest.current;
    const large = largeStep ?? Math.max(step, snap(min + span / 10) - min);
    const moves: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: large, PageDown: -large };
    let wanted: number;
    if (event.key === "Home") wanted = min;
    else if (event.key === "End") wanted = max;
    else if (event.key in moves) wanted = now + (event.shiftKey && event.key.startsWith("Arrow") ? Math.sign(moves[event.key]!) * large : moves[event.key]!);
    else return;
    event.preventDefault();
    setKeyed(true);
    const next = snap(wanted);
    // At a limit the track still stretches toward the press and snaps back, so the key visibly lands on something.
    if (next === now) {
      const toward = Math.sign(wanted - now);
      if (toward && !reduced) animate(over, 0, { ...snapBack, velocity: toward * BUMP_PX });
      return;
    }
    emit(next);
    if (markList.some(mark => mark.value === next)) pulse(next, false);
    onValueCommit?.(next);
  }

  const text = formatValue(current);
  const labelled = markList.filter(mark => mark.label);
  const bubble = dragging || keyed || linger;

  return <div className={[styles.root, className].filter(Boolean).join(" ")} data-disabled={disabled || undefined} data-dragging={dragging || undefined} data-tag={bubble || undefined} data-marks={labelled.length > 0 || undefined}>
    <div className={styles.header}>
      <span id={labelId} className={styles.label}>{label}</span>
      {showValue && <span className={styles.readout} aria-hidden="true">{text}</span>}
    </div>
    <div className={styles.body}>
      {startIcon && <motion.span className={styles.start} style={{ x: startShift }} aria-hidden="true">{startIcon}</motion.span>}
      <div className={styles.control} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onMouseDown={event => event.preventDefault()}>
        <div ref={trackRef} className={styles.rail}>
          <motion.div className={styles.track} style={{ scaleX, scaleY, originX }}>
            <motion.div className={styles.fill} style={{ clipPath }} />
          </motion.div>
          {markList.filter(mark => mark.value > min && mark.value < max).map(mark => <span key={mark.value} ref={node => { if (node) tickRefs.current.set(mark.value, node); else tickRefs.current.delete(mark.value); }} className={styles.tick} data-on={mark.value <= current || undefined} style={{ left: `${pct(mark.value)}%` }} />)}
        </div>
        <div className={styles.thumbs}>
          <motion.div className={styles.layer} style={{ x: bubbleX }}>
            <motion.span className={styles.bubbleAnchor} style={{ x: over, "--at": bubbleAt } as MotionStyle}>
              <AnimatePresence>{bubble && <motion.span key="bubble" className={styles.bubble} aria-hidden="true" style={{ rotate }} initial={reduced ? { opacity: 0 } : bubbleIn} animate={bubbleRest} exit={reduced ? { opacity: 0, transition: { duration: duration.instant } } : bubbleOut} transition={reduced ? { duration: .15 } : bubbleEnter}>{text}</motion.span>}</AnimatePresence>
            </motion.span>
          </motion.div>
          <motion.div className={styles.layer} style={{ x: thumbX }}>
            <motion.div className={styles.shift} style={{ x: over }}>
              <motion.div ref={thumbRef} role="slider" data-thumb="" className={styles.thumb} tabIndex={disabled ? -1 : 0} aria-labelledby={labelId} aria-valuemin={min} aria-valuemax={max} aria-valuenow={current} aria-valuetext={text} aria-orientation="horizontal" aria-disabled={disabled || undefined}
                initial={false} animate={{ scale: dragging ? 1.28 : 1 }} transition={reduced ? { duration: 0 } : spring.snappy} onKeyDown={onKeyDown} onBlur={() => setKeyed(false)} />
            </motion.div>
          </motion.div>
        </div>
      </div>
      {endIcon && <motion.span className={styles.end} style={{ x: endShift }} aria-hidden="true">{endIcon}</motion.span>}
      {labelled.length > 0 && <div className={styles.marks} aria-hidden="true">
        {labelled.map(mark => <span key={mark.value} className={styles.markLabel} data-on={mark.value === current || undefined} data-edge={mark.value === min ? "start" : mark.value === max ? "end" : undefined} style={{ left: `${pct(mark.value)}%` }}
          onClick={() => { if (disabled || mark.value === latest.current) return; emit(mark.value); pulse(mark.value, false); onValueCommit?.(mark.value); }}>{mark.label}</span>)}
      </div>}
    </div>
    {name && <input type="hidden" name={name} value={current} disabled={disabled} />}
  </div>;
}

export default ElasticSlider;
