"use client";

import { Children, Fragment, isValidElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from "react";
import { AnimatePresence, animate, motion, motionValue, useReducedMotion, useTransform } from "motion/react";
import type { AnimationPlaybackControls, MotionValue, TargetAndTransition, Transition } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./resizable-panels.module.css";

/** One pane of a `ResizablePanels` group. It only carries configuration; the group renders it. */
export interface ResizablePanelProps {
  /** Stable id, also used by the dividers' `aria-controls`. */
  id: string;
  /** Names the pane for its divider, for example "Folders". */
  label: string;
  /** Starting share of the group. Shares are relative, so they need not add up to 100. */
  defaultSize: number;
  /** Width in px where the pane starts to resist. Its content never reflows below it; it clips and fades instead. */
  minSize?: number;
  maxSize?: number;
  /** Dragging well past the minimum, or flicking toward the edge, snaps the pane closed. Its divider then shows a restore tab. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * A horizontal split view whose panes people resize by dragging the dividers between them, the way a mail or code editor window works.
 * Use it when people need to trade space between side-by-side content for the task at hand. Dividers follow the pointer 1:1, resist past
 * a pane's limits, and snap collapsible panes closed. Each divider is a focusable separator: arrows resize, Home and End jump to the limits,
 * Enter hides or restores a collapsible pane, and a double-click resets the layout. The group needs a definite height.
 */
export interface ResizablePanelsProps {
  /** Names the group for assistive technology. */
  label?: string;
  /** `ResizablePanel` elements, in order. The set of panes should stay the same for the life of the group. */
  children: ReactNode;
  /** Called with each pane's share in percent after a resize settles. */
  onLayoutChange?: (sizes: number[]) => void;
  className?: string;
}

type Mode = "open" | "before" | "after";
type Drag = { handle: number; pointer: number; startX: number; a0: number; b0: number; pair: number; lo: number; hi: number; mode: Mode; startMode: Mode; moved: boolean; catching: boolean; samples: [number, number][] };

const DEFAULT_MIN = 80;
/** How far in px a pane can be pulled past a limit before it stops giving. */
const STRETCH = 44;
/** Keyboard steps in px; Shift takes the larger one. */
const STEP = 16, BIG_STEP = 64;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Past a limit every pixel costs more, like pulling against elastic. */
const rubber = (overshoot: number) => overshoot * STRETCH * .55 / (STRETCH + .55 * overshoot);
const band = (value: number, lo: number, hi: number) => value < lo ? lo - rubber(lo - value) : value > hi ? hi + rubber(value - hi) : value;
/** A collapsible pane snaps closed once the pointer is this far below its minimum. */
const collapseAt = (min: number) => min - Math.max(min * .5, 40);
/** Short momentum projection, used only to decide whether a flick collapses or restores a pane. */
const project = (velocity: number, rate = .99) => velocity / 1000 * rate / (1 - rate);
const toShares = (values: number[]) => { const total = values.reduce((sum, value) => sum + value, 0) || 1; return values.map(value => value / total * 100); };

const tabIn: TargetAndTransition = { opacity: 0, scale: .6, filter: `blur(${motionTokens.blur.subtle}px)` };
const tabRest: TargetAndTransition = { opacity: 1, scale: 1, filter: "blur(0px)" };
const tabOut: TargetAndTransition = { ...tabIn, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
const tabEnter = { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] }, filter: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] } } as const;

function velocityOf(samples: [number, number][], now: number) {
  const recent = samples.filter(([time]) => now - time <= 90);
  const first = recent[0], last = recent[recent.length - 1];
  if (!first || !last || recent.length < 2 || now - last[0] > 50) return 0;
  const [firstTime, firstX] = first, [lastTime, lastX] = last;
  return lastTime > firstTime ? (lastX - firstX) / ((lastTime - firstTime) / 1000) : 0;
}

/** Carries a pane's configuration into `ResizablePanels`. Rendered on its own it shows its children unchanged. */
export function ResizablePanel({ children }: ResizablePanelProps) {
  return <>{children}</>;
}

export function ResizablePanels({ label, children, onLayoutChange, className }: ResizablePanelsProps) {
  const configs = Children.toArray(children).filter((child): child is ReactElement<ResizablePanelProps> => isValidElement(child)).map(child => child.props);
  const count = configs.length;
  const reduced = useReducedMotion() ?? false;
  const startsCollapsed = (config: ResizablePanelProps) => Boolean(config.collapsible && config.defaultCollapsed);
  // Sizes are flex-grow factors: the default shares before the first interaction, then px. Flex keeps them proportional as the group resizes.
  const [sizes] = useState(() => configs.map(config => motionValue(startsCollapsed(config) ? 0 : config.defaultSize)));
  const [fades] = useState(() => configs.map(config => motionValue(startsCollapsed(config) ? 0 : 1)));
  const [collapsed, setCollapsed] = useState(() => configs.map(startsCollapsed));
  const [free, setFree] = useState(() => configs.map(() => false));
  const [resizing, setResizing] = useState<number | null>(null);
  const [shares, setShares] = useState(() => toShares(configs.map(config => startsCollapsed(config) ? 0 : config.defaultSize)));
  const [available, setAvailable] = useState(0);
  const groupRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const restoreSizes = useRef<(number | null)[]>(configs.map(() => null));
  const running = useRef<AnimationPlaybackControls[]>([]);
  const token = useRef(0);
  const goals = useRef<number[] | null>(null);
  const stale = useRef(true);
  const drag = useRef<Drag | null>(null);
  // A group narrower than every minimum together scales the minimums down in proportion, the same floor the CSS applies,
  // so the panes fill the group instead of overflowing it and a press never re-lays them out.
  const minTotal = configs.reduce((sum, config) => sum + (config.minSize ?? DEFAULT_MIN), 0);
  const minOf = (index: number) => { const min = configs[index]?.minSize ?? DEFAULT_MIN; return available > 0 && available < minTotal ? min * available / minTotal : min; };
  const maxOf = (index: number) => configs[index]?.maxSize ?? Infinity;

  // Content fades as a pane is squeezed below its minimum, so a collapsing pane dissolves rather than crushes.
  const minKey = configs.map((_, index) => minOf(index)).join();
  useEffect(() => {
    const mins = minKey.split(",").map(Number);
    const stops = sizes.map((size, index) => size.on("change", value => fades[index]?.set(clamp(value / Math.max(1, mins[index] ?? DEFAULT_MIN), 0, 1))));
    return () => stops.forEach(stop => stop());
  }, [sizes, fades, minKey]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      stale.current = true;
      setAvailable(panelRefs.current.reduce((sum, node) => sum + (node?.getBoundingClientRect().width ?? 0), 0));
    });
    observer.observe(group);
    return () => observer.disconnect();
  }, []);

  /** Starts an interaction: stops anything in flight and makes sure the sizes are the px widths on screen, so nothing moves. */
  function begin(involved: number[]) {
    token.current += 1;
    running.current.forEach(controls => controls.stop());
    running.current = [];
    // Only a group resize (or the first interaction) can put the sizes out of step with the screen; otherwise they are the truth,
    // even before a jump has painted.
    if (stale.current) {
      stale.current = false;
      const widths = panelRefs.current.slice(0, count).map(node => node?.getBoundingClientRect().width ?? 0);
      if (widths.some((width, index) => Math.abs(width - sizes[index]!.get()) > .5)) widths.forEach((width, index) => sizes[index]!.jump(width));
    }
    // Freed panes drop their CSS limits while JS owns them, so rubber-banding and collapsing can go past them.
    if (involved.some(index => !free[index])) setFree(current => current.map((value, index) => value || involved.includes(index)));
    return sizes.map(size => size.get());
  }

  function commit() {
    const values = sizes.map(size => size.get());
    setFree(configs.map(() => false));
    setShares(toShares(values));
    onLayoutChange?.(toShares(values));
  }

  /** Springs panes to new widths from wherever they are, keeping their velocity, then hands the limits back to CSS. */
  function glide(targets: (number | null)[], transition: Transition = motionTokens.spring.smooth) {
    const mine = token.current;
    const finals = targets.map((target, index) => target ?? sizes[index]!.get());
    goals.current = finals;
    // Assistive technology hears the destination right away rather than after the spring's tail settles.
    setShares(toShares(finals));
    const moving = targets.flatMap((target, index) => target === null || Math.abs(target - sizes[index]!.get()) < .01 ? [] : [[index, target] as const]);
    let pending = moving.length;
    const done = () => { if (token.current === mine) commit(); };
    if (reduced || !pending) { moving.forEach(([index, target]) => sizes[index]!.jump(target)); done(); return; }
    running.current = moving.map(([index, target]) => animate(sizes[index], target, { ...transition, onComplete: () => { pending -= 1; if (!pending) done(); } }));
  }

  function limits(handle: number, a: number, b: number) {
    const pair = a + b;
    let lo = Math.max(minOf(handle), pair - maxOf(handle + 1)), hi = Math.min(maxOf(handle), pair - minOf(handle + 1));
    // A group too narrow for every minimum may already hold a pane below it; never yank it to the limit on grab.
    if (a > 0 && b > 0) { lo = Math.min(lo, a); hi = Math.max(hi, a); }
    if (lo > hi) lo = hi = clamp((lo + hi) / 2, 0, pair);
    return { pair, lo: clamp(lo, 0, pair), hi: clamp(hi, 0, pair) };
  }

  function resolve(handle: number, raw: number, pair: number, lo: number, hi: number): { mode: Mode; size: number } {
    if (configs[handle]!.collapsible && raw < collapseAt(minOf(handle))) return { mode: "before", size: 0 };
    if (configs[handle + 1]!.collapsible && pair - raw < collapseAt(minOf(handle + 1))) return { mode: "after", size: pair };
    return { mode: "open", size: band(raw, lo, hi) };
  }

  function setCollapsedPair(handle: number, mode: Mode) {
    setCollapsed(current => current.map((value, index) => index === handle ? mode === "before" : index === handle + 1 ? mode === "after" : value));
  }

  function remember(handle: number, a: number, b: number, mode: Mode) {
    if (mode === "before" && a > 0) restoreSizes.current[handle] = a;
    if (mode === "after" && b > 0) restoreSizes.current[handle + 1] = b;
  }

  function modeOf(handle: number): Mode {
    return collapsed[handle] ? "before" : collapsed[handle + 1] ? "after" : "open";
  }

  /** Sets a pane pair to a new boundary. Any change of collapse state springs; everything else moves with the pointer. */
  function moveBoundary(current: Drag, size: number) {
    const [a, b] = [sizes[current.handle]!, sizes[current.handle + 1]!];
    if (current.catching && !reduced) {
      if (Math.abs(a.get() - size) < .75) { current.catching = false; running.current.forEach(controls => controls.stop()); running.current = []; }
      else { running.current = [animate(a, size, motionTokens.spring.smooth), animate(b, current.pair - size, motionTokens.spring.smooth)]; return; }
    }
    a.set(size);
    b.set(current.pair - size);
  }

  function onPointerDown(handle: number, event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    const values = begin([handle, handle + 1]);
    const { pair, lo, hi } = limits(handle, values[handle]!, values[handle + 1]!);
    event.currentTarget.setPointerCapture(event.pointerId);
    const mode = modeOf(handle);
    drag.current = { handle, pointer: event.pointerId, startX: event.clientX, a0: values[handle]!, b0: values[handle + 1]!, pair, lo, hi, mode, startMode: mode, moved: false, catching: false, samples: [[event.timeStamp, event.clientX]] };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    if (!current.moved) { if (Math.abs(dx) < 2) return; current.moved = true; setResizing(current.handle); }
    const next = resolve(current.handle, current.a0 + dx, current.pair, current.lo, current.hi);
    if (next.mode !== current.mode) { current.mode = next.mode; current.catching = true; }
    moveBoundary(current, next.size);
    current.samples.push([event.timeStamp, event.clientX]);
    if (current.samples.length > 16) current.samples.shift();
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    setResizing(null);
    const { handle, pair, lo, hi } = current;
    if (!current.moved) {
      // A press on a divider that hides a pane brings it back.
      if (current.startMode !== "open" && !cancelled) restore(handle, current.startMode);
      else commit();
      return;
    }
    const raw = current.a0 + event.clientX - current.startX;
    const velocity = cancelled ? 0 : velocityOf(current.samples, event.timeStamp);
    const flung = resolve(handle, raw + project(velocity), pair, lo, hi);
    // A flick toward an edge collapses; a flick back out restores. Otherwise the divider stays where it was let go, inside its limits.
    const mode = cancelled ? current.startMode : flung.mode !== "open" ? flung.mode : "open";
    const size = mode === "before" ? 0 : mode === "after" ? pair : cancelled ? current.a0 : clamp(raw, lo, hi);
    remember(handle, current.a0, current.b0, mode);
    setCollapsedPair(handle, mode);
    glide(sizes.map((_, index) => index === handle ? size : index === handle + 1 ? pair - size : null));
  }

  function restore(handle: number, side: Mode) {
    const values = begin([handle, handle + 1]);
    const { pair, lo, hi } = limits(handle, values[handle]!, values[handle + 1]!);
    const size = side === "before" ? clamp(restoreSizes.current[handle] ?? minOf(handle), lo, hi) : clamp(pair - (restoreSizes.current[handle + 1] ?? minOf(handle + 1)), lo, hi);
    setCollapsedPair(handle, "open");
    glide(sizes.map((_, index) => index === handle ? size : index === handle + 1 ? pair - size : null));
  }

  function collapse(handle: number, side: Mode) {
    const values = begin([handle, handle + 1]);
    const pair = values[handle]! + values[handle + 1]!;
    remember(handle, values[handle]!, values[handle + 1]!, side);
    setCollapsedPair(handle, side);
    glide(sizes.map((_, index) => index === handle ? (side === "before" ? 0 : pair) : index === handle + 1 ? (side === "before" ? pair : 0) : null));
  }

  /** Resets to the default shares, fitted to the current width so every pane respects its limits. */
  function reset() {
    const values = begin(configs.map((_, index) => index));
    const total = values.reduce((sum, value) => sum + value, 0);
    const wanted = configs.map(config => startsCollapsed(config) ? 0 : config.defaultSize);
    const targets = [...wanted];
    const frozen = wanted.map(value => value === 0);
    for (let pass = 0; pass < count; pass++) {
      const fixed = targets.reduce((sum, value, index) => frozen[index] ? sum + value : sum, 0);
      const share = wanted.reduce((sum, value, index) => frozen[index] ? sum : sum + value, 0);
      let violated = false;
      targets.forEach((_, index) => {
        if (frozen[index]) return;
        const size = share ? wanted[index]! / share * (total - fixed) : 0;
        const bounded = clamp(size, minOf(index), maxOf(index));
        targets[index] = size;
        if (bounded !== size) { targets[index] = bounded; frozen[index] = true; violated = true; }
      });
      if (!violated) break;
    }
    setCollapsed(configs.map(startsCollapsed));
    glide(targets);
  }

  function onKeyDown(handle: number, event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = drag.current;
    if (event.key === "Escape" && current) {
      // Escape during a drag puts the divider back where it started.
      event.preventDefault();
      drag.current = null;
      setResizing(null);
      setCollapsedPair(handle, current.startMode);
      glide(sizes.map((_, index) => index === handle ? current.a0 : index === handle + 1 ? current.b0 : null));
      return;
    }
    if (current || !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
    event.preventDefault();
    const mode = modeOf(handle);
    const canCollapseBefore = Boolean(configs[handle]!.collapsible), canCollapseAfter = Boolean(configs[handle + 1]!.collapsible);
    if (event.key === "Enter") {
      if (mode !== "open") restore(handle, mode);
      else if (canCollapseBefore) collapse(handle, "before");
      else if (canCollapseAfter) collapse(handle, "after");
      return;
    }
    // Repeated presses build on where the divider is heading, not on where the spring happens to be this frame.
    const heading = goals.current && (sizes[handle]!.isAnimating() || sizes[handle + 1]!.isAnimating()) ? goals.current : null;
    const values = begin([handle, handle + 1]);
    const pair = values[handle]! + values[handle + 1]!;
    const a = heading ? clamp(heading[handle]!, 0, pair) : values[handle]!, step = event.shiftKey ? BIG_STEP : STEP;
    const { lo, hi } = limits(handle, a, pair - a);
    // Arrows walk out of a collapsed pane at its minimum, and past a limit into collapse when the pane allows it.
    if (event.key === "ArrowLeft" && mode === "after") return restoreTo(handle, hi, pair);
    if (event.key === "ArrowRight" && mode === "before") return restoreTo(handle, lo, pair);
    if (event.key === "ArrowLeft" && a <= lo + .5 && canCollapseBefore && mode === "open") return collapse(handle, "before");
    if (event.key === "ArrowRight" && a >= hi - .5 && canCollapseAfter && mode === "open") return collapse(handle, "after");
    if (mode !== "open") return;
    const size = event.key === "Home" ? lo : event.key === "End" ? hi : clamp(a + (event.key === "ArrowLeft" ? -step : step), lo, hi);
    glide(sizes.map((_, index) => index === handle ? size : index === handle + 1 ? pair - size : null), event.key.startsWith("Arrow") ? motionTokens.spring.snappy : motionTokens.spring.smooth);
  }

  function restoreTo(handle: number, size: number, pair: number) {
    setCollapsedPair(handle, "open");
    glide(sizes.map((_, index) => index === handle ? size : index === handle + 1 ? pair - size : null));
  }

  return <div ref={groupRef} className={[styles.group, className].filter(Boolean).join(" ")} role="group" aria-label={label} data-resizing={resizing !== null || undefined}>
    {configs.map((config, index) => <Fragment key={config.id}>
      {index > 0 && <Handle before={configs[index - 1]!} after={config} share={shares[index - 1]!} available={available} limits={available ? limits(index - 1, shares[index - 1]! / 100 * available, shares[index]! / 100 * available) : null}
        mode={collapsed[index - 1] ? "before" : collapsed[index] ? "after" : "open"} active={resizing === index - 1} reduced={reduced}
        onPointerDown={event => onPointerDown(index - 1, event)} onPointerMove={onPointerMove} onPointerUp={event => finish(event, false)} onPointerCancel={event => finish(event, true)}
        onKeyDown={event => onKeyDown(index - 1, event)} onDoubleClick={reset} />}
      <Pane config={config} size={sizes[index]!} fade={fades[index]!} collapsed={collapsed[index]!} free={free[index]!} anchor={index === 0 && count > 1 ? "end" : "start"} minTotal={minTotal} gaps={count - 1} paneRef={node => { panelRefs.current[index] = node; }} />
    </Fragment>)}
  </div>;
}

function Pane({ config, size, fade, collapsed, free, anchor, minTotal, gaps, paneRef }: { config: ResizablePanelProps; size: MotionValue<number>; fade: MotionValue<number>; collapsed: boolean; free: boolean; anchor: "start" | "end"; minTotal: number; gaps: number; paneRef: (node: HTMLDivElement | null) => void }) {
  const grow = useTransform(size, value => Math.max(0, value));
  const min = config.minSize ?? DEFAULT_MIN;
  // The group is a size container: below the sum of the minimums, each floor becomes its share of the room between the dividers.
  const style = { flexGrow: grow, "--panel-min": `min(${min}px, (100cqw - ${gaps}px) * ${+(min / Math.max(1, minTotal)).toFixed(5)})`, "--panel-max": config.maxSize ? `${config.maxSize}px` : "none" } as unknown as CSSProperties;
  // The content stays anchored to the moving edge, so a closing pane slides away like a drawer instead of being crushed.
  return <motion.div ref={paneRef} id={config.id} className={[styles.panel, config.className].filter(Boolean).join(" ")} style={style} data-collapsed={collapsed || undefined} data-free={free || undefined} data-anchor={anchor}>
    <motion.div className={styles.content} style={{ opacity: fade }} inert={collapsed}>{config.children}</motion.div>
  </motion.div>;
}

type HandleProps = {
  before: ResizablePanelProps; after: ResizablePanelProps; share: number; available: number; limits: { lo: number; hi: number } | null; mode: Mode; active: boolean; reduced: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void; onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void; onDoubleClick: () => void;
};

/** A one pixel divider with a wider grab area. It shows a grip while hovered or dragged, and a restore tab once a neighbouring pane is hidden. */
function Handle({ before, after, share, available, limits, mode, active, reduced, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown, onDoubleClick }: HandleProps) {
  const now = Math.round(share);
  const min = limits && available ? Math.round(limits.lo / available * 100) : 0;
  const max = limits && available ? Math.round(limits.hi / available * 100) : 100;
  const hidden = mode === "before" ? before.label : mode === "after" ? after.label : null;
  return <div role="separator" tabIndex={0} aria-orientation="vertical" aria-controls={before.id} aria-label={before.label} aria-valuenow={now} aria-valuemin={Math.min(min, now)} aria-valuemax={Math.max(max, now)}
    aria-valuetext={hidden ? `${hidden} hidden, press Enter to show` : `${now}%`} className={styles.handle} data-collapsed={mode === "open" ? undefined : mode} data-active={active || undefined}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyDown={onKeyDown} onDoubleClick={onDoubleClick}>
    <span className={styles.grip} aria-hidden="true" />
    <AnimatePresence initial={false}>
      {mode !== "open" && <motion.span key={mode} className={styles.restore} data-side={mode} aria-hidden="true" initial={reduced ? { opacity: 0 } : tabIn} animate={tabRest} exit={reduced ? { opacity: 0, transition: { duration: motionTokens.duration.instant } } : tabOut} transition={reduced ? { duration: motionTokens.duration.instant } : tabEnter}>
        {mode === "before" ? <ChevronRight size={14} strokeWidth={1.75} /> : <ChevronLeft size={14} strokeWidth={1.75} />}
      </motion.span>}
    </AnimatePresence>
  </div>;
}

export default ResizablePanels;
