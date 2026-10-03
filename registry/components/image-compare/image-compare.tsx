"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./image-compare.module.css";

export interface ImageCompareProps {
  /** The original, shown on the left (or top). Pass an image with its own alt text; it is sized to cover the frame. */
  before: ReactNode;
  /** The result, shown on the right (or bottom). */
  after: ReactNode;
  /** Where the divider sits, in percent from the left (or top). */
  position?: number;
  defaultPosition?: number;
  onPositionChange?: (position: number) => void;
  /** Vertical stacks the images top and bottom. Changing it swings the divider a quarter turn instead of swapping layouts. */
  orientation?: "horizontal" | "vertical";
  /** Captions over each side. They fade as the divider reaches them. Pass false to hide them. */
  labels?: [string, string] | false;
  /** Accessible name of the divider. */
  label?: string;
  /** Frame proportions, as a CSS aspect-ratio. */
  aspectRatio?: string;
  className?: string;
}

type Metrics = { w: number; h: number; bw: number; bh: number; aw: number; ah: number };
type Drag = { pointer: number; grab: number; press: boolean; started: boolean; x: number; y: number; raw: number };

const { spring } = motionTokens;
/** Motion drops velocity on time-defined springs, so hand-offs run the same springs written as stiffness and damping, settling far below a pixel. */
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta: .002, restSpeed: .02 }; };
const moveSpring = physical(spring.snappy);
const turnSpring = physical(spring.morph);
const kickSpring = physical(spring.morph);
/** Rubber-band travel past an edge, the handle's inset from the frame, how far it gives inside that inset, and a key press at a limit. */
const STRETCH = 9, MARGIN = 42, GIVE = 12, BUMP_PX = 150, INSET = 12;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
/** iOS style resistance: travel past a limit gives less and less, and never more than `limit` pixels. */
const rubber = (distance: number, limit = STRETCH) => Math.sign(distance) * (1 - 1 / (Math.abs(distance) * .55 / limit + 1)) * limit;
/** The handle keeps the line's pace in the middle and slows smoothly near an edge, so it is never cut off and never stops dead. */
const give = (distance: number) => GIVE * (1 - 1 / (distance / GIVE + 1));
const soften = (at: number, size: number) => at < MARGIN ? MARGIN - give(MARGIN - at) : at > size - MARGIN ? size - MARGIN + give(at - size + MARGIN) : at;
const fade = (room: number) => clamp(room / 28, 0, 1);

/** The before side of a line through `center` at `angle`, cut from the frame: the clip while the divider turns. */
function halfPlane(w: number, h: number, center: [number, number], angle: number) {
  const nx = -Math.cos(angle), ny = -Math.sin(angle);
  const side = ([x, y]: number[]) => (x - center[0]) * nx + (y - center[1]) * ny;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  const points: number[][] = [];
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % 4], a = side(corner), b = side(next);
    if (a >= 0) points.push(corner);
    if ((a >= 0) !== (b >= 0)) { const t = a / (a - b); points.push([corner[0] + (next[0] - corner[0]) * t, corner[1] + (next[1] - corner[1]) * t]); }
  });
  return points.length ? `polygon(${points.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(", ")})` : "inset(50%)";
}

/**
 * Before and after, split by a divider. Drag anywhere to move it: the handle follows 1:1, rubber-bands past the edges, and stays where it
 * is released. A press on the image springs the divider there; on touch the press waits to see a sideways drag so the page still scrolls.
 * Arrow keys step 1% (Shift for 10%), Home and End reveal one side fully, and a double-click on the handle springs it back to the middle.
 */
export function ImageCompare({ before, after, position, defaultPosition = 50, onPositionChange, orientation = "horizontal", labels = ["Before", "After"], label = "Before and after", aspectRatio = "3 / 2", className }: ImageCompareProps) {
  const reduced = useReducedMotion();
  const vertical = orientation === "vertical";
  const [internal, setInternal] = useState(defaultPosition);
  const current = clamp(position ?? internal, 0, 100);
  const afterShare = Math.round(100 - current);
  const rootRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const beforeChip = useRef<HTMLSpanElement>(null);
  const afterChip = useRef<HTMLSpanElement>(null);
  const latest = useRef(current);
  const goal = useRef(current);
  const drag = useRef<Drag | null>(null);
  const pressedHandle = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [quiet, setQuiet] = useState(false);

  // The divider is a committed position plus a catch-up offset: a press springs the offset to zero while the pointer moves the position
  // 1:1, so the divider glides to the finger and never trails it.
  const pos = useMotionValue(current), lag = useMotionValue(0);
  const theta = useMotionValue(vertical ? 90 : 0);
  const metrics = useMotionValue<Metrics>({ w: 0, h: 0, bw: 0, bh: 0, aw: 0, ah: 0 });
  const shown = useTransform(() => pos.get() + lag.get());
  const turn = useTransform(() => clamp(theta.get() / 90, 0, 1));
  /** The divider's pivot in pixels, blending from the horizontal to the vertical layout as it turns. */
  const center = (p: number, m: Metrics): [number, number] => [lerp((p / 100) * m.w, m.w / 2, turn.get()), lerp(m.h / 2, (p / 100) * m.h, turn.get())];
  // At rest every style is a percentage, so the server renders it and a resize never lags; only a turn in progress uses pixels.
  const clipPath = useTransform(() => {
    const angle = theta.get(), p = clamp(shown.get(), 0, 100), m = metrics.get();
    if (angle === 0 || !m.w) return angle >= 45 ? `inset(0 0 ${(100 - p).toFixed(3)}% 0)` : `inset(0 ${(100 - p).toFixed(3)}% 0 0)`;
    if (angle === 90) return `inset(0 0 ${(100 - p).toFixed(3)}% 0)`;
    return halfPlane(m.w, m.h, center(p, m), (angle * Math.PI) / 180);
  });
  const rest = (angle: number, m: Metrics) => angle === 0 || angle === 90 || !m.w;
  const pivotX = useTransform(() => { const angle = theta.get(), m = metrics.get(); return rest(angle, m) ? (angle >= 45 ? "50%" : `${shown.get()}%`) : `${center(shown.get(), m)[0]}px`; });
  const pivotY = useTransform(() => { const angle = theta.get(), m = metrics.get(); return rest(angle, m) ? (angle >= 45 ? `${shown.get()}%` : "50%") : `${center(shown.get(), m)[1]}px`; });
  /** How far the handle sits from the line along the drag axis, so it stays whole near an edge. */
  const offset = () => { const m = metrics.get(); if (!m.w) return 0; const p = shown.get(), x = (p / 100) * m.w, y = (p / 100) * m.h; return lerp(soften(x, m.w) - x, soften(y, m.h) - y, turn.get()); };
  const handleX = useTransform(() => offset() * Math.cos((theta.get() * Math.PI) / 180));
  const handleY = useTransform(() => offset() * Math.sin((theta.get() * Math.PI) / 180));
  // Captions fade as the divider reaches them, and hand over mid-turn when the after caption changes corner.
  const beforeOpacity = useTransform(() => {
    const m = metrics.get(), k = turn.get(), p = clamp(shown.get(), 0, 100), across = clamp(1 - k * 3, 0, 1), down = clamp(k * 3 - 2, 0, 1);
    if (!m.w) return across + down;
    return across * fade((p / 100) * m.w - (INSET + m.bw + 8)) + down * fade((p / 100) * m.h - (INSET + m.bh + 8));
  });
  const afterAcross = useTransform(() => { const m = metrics.get(), k = clamp(1 - turn.get() * 3, 0, 1); return m.w ? k * fade(m.w - INSET - m.aw - 8 - (clamp(shown.get(), 0, 100) / 100) * m.w) : k; });
  const afterDown = useTransform(() => { const m = metrics.get(), k = clamp(turn.get() * 3 - 2, 0, 1); return m.w ? k * fade(m.h - INSET - m.ah - 8 - (clamp(shown.get(), 0, 100) / 100) * m.h) : k; });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const measure = () => metrics.set({ w: root.clientWidth, h: root.clientHeight, bw: beforeChip.current?.offsetWidth ?? 0, bh: beforeChip.current?.offsetHeight ?? 0, aw: afterChip.current?.offsetWidth ?? 0, ah: afterChip.current?.offsetHeight ?? 0 });
    const observer = new ResizeObserver(measure);
    [root, beforeChip.current, afterChip.current].forEach(node => node && observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, [metrics]);

  // A new orientation swings the divider a quarter turn about its pivot while the clip follows it.
  useEffect(() => {
    const target = vertical ? 90 : 0;
    if (theta.get() === target) return;
    if (reduced) theta.jump(target); else animate(theta, target, turnSpring);
  }, [reduced, theta, vertical]);

  // Positions that arrive from outside a drag (props, keys, a double-click) spring the divider there.
  useLayoutEffect(() => {
    latest.current = current;
    if (drag.current?.started || goal.current === current) return;
    goal.current = current;
    const from = pos.get() + lag.get();
    lag.jump(0);
    pos.jump(from);
    if (reduced) pos.jump(current); else animate(pos, current, moveSpring);
  });

  function commit(next: number, live = false) {
    if (live && Math.round(next) === Math.round(latest.current)) return;
    const value = Number(next.toFixed(2));
    if (value === latest.current) return;
    latest.current = value;
    if (position === undefined) setInternal(value);
    onPositionChange?.(value);
  }

  const percentAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = rootRef.current!.getBoundingClientRect();
    return vertical ? ((event.clientY - rect.top) / (rect.height || 1)) * 100 : ((event.clientX - rect.left) / (rect.width || 1)) * 100;
  };
  const axisSize = () => { const rect = rootRef.current?.getBoundingClientRect(); return (vertical ? rect?.height : rect?.width) || 1; };
  /** Focus that follows a pointer keeps the handle quiet: no ring until a key is pressed. */
  function focusQuietly() {
    const node = handleRef.current;
    if (!node || document.activeElement === node) return;
    setQuiet(true);
    node.focus({ preventScroll: true });
  }

  function start(state: Drag, at: number) {
    const from = pos.get() + lag.get();
    state.started = true;
    state.grab = state.press ? 0 : at - from;
    lag.jump(0);
    pos.jump(from);
    setDragging(true);
    focusQuietly();
    follow(state, at, true);
  }
  /** Puts the line under the pointer, with resistance past the edges, and commits the position once per whole percent. */
  function follow(state: Drag, at: number, first = false) {
    const raw = at - state.grab, size = axisSize();
    const edge = clamp(raw, 0, 100);
    const placed = reduced ? edge : edge + (rubber(((raw - edge) / 100) * size) / size) * 100;
    state.raw = raw;
    if (first && state.press && !reduced) {
      const from = pos.get();
      pos.jump(placed);
      lag.jump(from - placed);
      animate(lag, 0, moveSpring);
    } else pos.set(placed);
    commit(edge, true);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || !rootRef.current) return;
    const onHandle = !!(event.target as HTMLElement).closest("[data-handle]");
    pressedHandle.current = onHandle;
    event.currentTarget.setPointerCapture(event.pointerId);
    const state: Drag = { pointer: event.pointerId, grab: 0, press: !onHandle, started: false, x: event.clientX, y: event.clientY, raw: 0 };
    drag.current = state;
    // A finger on the photo might be scrolling the page, so it waits for a sideways drag; a mouse or the handle answers at once.
    if (event.pointerType !== "touch" || onHandle) start(state, percentAt(event));
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    if (!state.started) {
      const along = Math.abs(vertical ? event.clientY - state.y : event.clientX - state.x), across = Math.abs(vertical ? event.clientX - state.x : event.clientY - state.y);
      if (along < 6 && across < 6) return;
      if (across > along) { drag.current = null; return; }
      start(state, percentAt(event));
      return;
    }
    follow(state, percentAt(event));
  }
  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    drag.current = null;
    // A tap on the photo moves the divider there.
    if (!state.started) { if (event.type === "pointerup") { focusQuietly(); commit(clamp(percentAt(event), 0, 100)); } return; }
    // The divider stays where it was let go. Past an edge, or still catching up to a press, it springs on with the speed it had.
    const from = pos.get() + lag.get(), velocity = lag.getVelocity() + (from > 100 || from < 0 ? pos.getVelocity() : 0);
    const target = clamp(lag.get() !== 0 ? state.raw : from, 0, 100);
    lag.jump(0);
    pos.jump(from);
    goal.current = Number(target.toFixed(2));
    if (from !== target) { if (reduced) pos.jump(target); else animate(pos, target, { ...moveSpring, velocity }); }
    commit(target);
    setDragging(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const large = event.shiftKey ? 10 : 1;
    // Keys move the divider the way they point along its axis; the other two follow the value, where up and right mean more of the after image.
    const toward: Record<string, number> = vertical ? { ArrowUp: -large, ArrowDown: large, ArrowRight: -large, ArrowLeft: large, PageUp: -10, PageDown: 10 } : { ArrowLeft: -large, ArrowRight: large, ArrowUp: -large, ArrowDown: large, PageUp: -10, PageDown: 10 };
    let next: number;
    if (event.key === "Home") next = 100;
    else if (event.key === "End") next = 0;
    else if (event.key in toward) next = Math.round(latest.current) + toward[event.key];
    else return;
    event.preventDefault();
    setQuiet(false);
    const clamped = clamp(next, 0, 100);
    if (clamped === latest.current) {
      if (!reduced && next !== clamped) animate(pos, goal.current, { ...kickSpring, velocity: (Math.sign(next - clamped) * BUMP_PX / axisSize()) * 100 });
      return;
    }
    commit(clamped);
  }

  const capsule = dragging ? (vertical ? { width: 36, height: 56 } : { width: 56, height: 36 }) : { width: 40, height: 40 };
  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} data-orientation={orientation} data-dragging={dragging || undefined} data-frame-keep="" style={{ aspectRatio }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onMouseDown={event => event.preventDefault()} onDragStart={event => event.preventDefault()}
    // Pointer capture sends the double-click to the frame, so it checks where the presses began.
    onDoubleClick={() => { if (pressedHandle.current && latest.current !== 50) commit(50); }}>
    <div className={styles.layer}>{after}</div>
    <motion.div className={styles.layer} style={{ clipPath }}>{before}</motion.div>
    {labels && <>
      <motion.span ref={beforeChip} className={styles.chip} style={{ opacity: beforeOpacity }} aria-hidden="true">{labels[0]}</motion.span>
      <motion.span ref={afterChip} className={styles.chip} data-place="end" style={{ opacity: afterAcross }} aria-hidden="true">{labels[1]}</motion.span>
      <motion.span className={styles.chip} data-place="bottom" style={{ opacity: afterDown }} aria-hidden="true">{labels[1]}</motion.span>
    </>}
    <motion.div className={styles.pivot} style={{ x: pivotX, y: pivotY }}>
      <motion.span className={styles.rotor} style={{ rotate: theta }}><span className={styles.line} /></motion.span>
      <motion.span className={styles.handleSlot} style={{ x: handleX, y: handleY }}>
        <motion.div ref={handleRef} data-handle="" data-quiet={quiet || undefined} className={styles.handle} role="slider" tabIndex={0} aria-label={label} aria-orientation={orientation}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={afterShare} aria-valuetext={`${afterShare}% after`}
          initial={false} animate={capsule} transition={reduced ? { duration: 0 } : spring.morph} onKeyDown={onKeyDown} onBlur={() => setQuiet(false)}>
          <motion.span className={styles.chevrons} style={{ rotate: theta }} aria-hidden="true">
            <motion.span className={styles.chevron} initial={false} animate={{ x: dragging ? -4 : 0 }} transition={reduced ? { duration: 0 } : spring.morph}><ChevronLeft size={16} strokeWidth={1.75} /></motion.span>
            <motion.span className={styles.chevron} initial={false} animate={{ x: dragging ? 4 : 0 }} transition={reduced ? { duration: 0 } : spring.morph}><ChevronRight size={16} strokeWidth={1.75} /></motion.span>
          </motion.span>
        </motion.div>
      </motion.span>
    </motion.div>
  </div>;
}

export default ImageCompare;
