"use client";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, type AnimationPlaybackControls, type HTMLMotionProps, type MotionProps, type PanInfo, type TargetAndTransition, type Transition, type Variants } from "motion/react";
import { X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./toast.module.css";
export interface ToastProps { title: string; description?: string; open?: boolean; onOpenChange?: (open: boolean) => void; duration?: number; }

const subscribeHydration = () => () => {};
const exitFast: Transition = { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] };
const enter: Transition = { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] };
const textIn: TargetAndTransition = { opacity: 0, y: "0.3em", filter: `blur(${motionTokens.blur.soft}px)` };
const textOut: TargetAndTransition = { opacity: 0, y: "-0.3em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: exitFast };
const textShown: TargetAndTransition = { opacity: 1, y: "0em", filter: "blur(0px)" };
const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } };
/** A swipe past this distance (px) or speed (px/s) dismisses the toast in the direction it was thrown. */
const swipe = { distance: 80, velocity: 480 };

/** Outgoing copies are hidden from assistive tech while they fade, so the live region reads only the current text. */
function Swap(props: HTMLMotionProps<"span">) {
  const present = useIsPresent();
  return <motion.span {...props} aria-hidden={present ? props["aria-hidden"] : true} />;
}

/** Follows its content height. After `morphKey` changes, the height springs from the old size to the new one and then returns to auto, so passive reflows (a resize, a font swap) follow instantly. It clips only while moving, so focus rings stay visible at rest. */
function HeightFrame({ reduce, morphKey, children }: { reduce: boolean | null; morphKey: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | "auto">("auto");
  const changedAt = useRef(0);
  useLayoutEffect(() => { changedAt.current = performance.now(); }, [morphKey]);
  useEffect(() => {
    const node = content.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let last: number | undefined;
    let controls: AnimationPlaybackControls | undefined;
    const settle = () => { height.jump("auto"); if (frame.current) Object.assign(frame.current.style, { overflow: "", height: "auto" }); };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
      const current = height.get();
      const from = typeof current === "number" ? current : last;
      last = next;
      controls?.stop();
      if (reduce || from === undefined || from === next || performance.now() - changedAt.current > 120) return settle();
      // Pin the old height before this frame paints, then spring to the new one.
      if (frame.current) Object.assign(frame.current.style, { overflow: "hidden", height: `${from}px` });
      controls = animate(height, [from, next], { ...motionTokens.spring.smooth, onComplete: settle });
    });
    observer.observe(node);
    return () => { observer.disconnect(); controls?.stop(); };
  }, [height, reduce]);
  return <motion.div ref={frame} className={styles.frame} style={{ height }}>
    <div ref={content} className={styles.copy}>{children}</div>
  </motion.div>;
}

export default function Toast({ title, description, open = true, onOpenChange, duration = 4500 }: ToastProps) {
  const reduce = useReducedMotion();
  // Toasts that mount after hydration rise in from their edge; server-rendered ones start settled.
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [enterOnMount] = useState(hydrated);
  const [dismissed, setDismissed] = useState(false);
  const [throwX, setThrowX] = useState(0);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) { setLastOpen(open); if (open) { setDismissed(false); setThrowX(0); } }
  const visible = open && !dismissed;
  const surface = useRef<HTMLDivElement>(null);
  // The drag offset is owned here, so a release hands its velocity straight to the spring home or to the throw.
  const x = useMotionValue(0);
  const releaseVelocity = useRef(0);

  /** Closing tells the parent at once, while the exit plays out here, so a new toast can be raised mid-exit and simply turns back. */
  function dismiss(to: number) {
    setThrowX(to);
    setDismissed(true);
    onOpenChange?.(false);
  }

  useEffect(() => {
    if (!visible || !onOpenChange || duration <= 0) return;
    const timer = window.setTimeout(() => { setThrowX(0); setDismissed(true); onOpenChange(false); }, duration);
    return () => window.clearTimeout(timer);
  }, [visible, onOpenChange, duration]);

  function handleDragEnd(_: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    const direction = Math.sign(info.offset.x || info.velocity.x);
    // A short swipe springs back with its release velocity and a slight settle instead of drifting home.
    if (Math.abs(info.offset.x) < swipe.distance && Math.abs(info.velocity.x) < swipe.velocity) {
      animate(x, 0, { ...motionTokens.spring.snappy, velocity: info.velocity.x });
      return;
    }
    releaseVelocity.current = info.velocity.x;
    dismiss(direction * ((surface.current?.offsetWidth ?? 320) + 48));
  }

  const variants: Variants = reduce ? {
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: { duration: motionTokens.duration.instant } },
    exit: fadeOut,
  } : {
    // x resets here because the drag value outlives a thrown toast; the next one must rise from the center.
    hidden: { opacity: 0, x: 0, y: 16, scale: .96 },
    // x returns to center too, in case the toast is raised again while a throw is still leaving.
    shown: { opacity: 1, x: 0, y: 0, scale: 1, transition: { ...motionTokens.spring.morph, opacity: enter } },
    // A thrown toast keeps its release velocity; a closed one sinks back toward the edge it came from.
    // The throw settles loosely: it is invisible once the fade ends, so no long unseen tail keeps it mounted.
    exit: (to: number) => to
      ? { x: to, opacity: 0, transition: { x: { type: "spring", visualDuration: .3, bounce: 0, velocity: releaseVelocity.current, restDelta: 2, restSpeed: 40 }, opacity: { duration: motionTokens.duration.exit } } }
      : { opacity: 0, y: 8, scale: .97, transition: { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.standard] } },
  };
  const swap: MotionProps = { initial: reduce ? { opacity: 0 } : textIn, animate: textShown, exit: reduce ? fadeOut : textOut, transition: reduce ? { duration: motionTokens.duration.instant } : enter };

  return (
    <AnimatePresence initial={enterOnMount} custom={throwX}>
      {visible && <motion.div
        key="toast"
        ref={surface}
        className={styles.toast}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        custom={throwX}
        variants={variants}
        initial="hidden"
        animate="shown"
        exit="exit"
        style={{ x }}
        // Drag writes touch-action into the markup, so the reduced motion switch waits for hydration to keep server and client in step.
        drag={reduce && hydrated ? false : "x"}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
      >
        <span className={styles.icon} aria-hidden="true">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M4 12.5l5 5L20 6.5" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter], delay: .12 }} />
          </svg>
        </span>
        {/* The copy column follows its content height, so a longer message grows the toast instead of snapping it. */}
        <HeightFrame reduce={reduce} morphKey={`${title}\n${description ?? ""}`}>
          <strong className={styles.title}><AnimatePresence mode="popLayout" initial={false}><Swap key={title} className={styles.line} {...swap}>{title}</Swap></AnimatePresence></strong>
          <AnimatePresence mode="popLayout" initial={false}>{description ? <Swap key={description} className={styles.description} {...swap}>{description}</Swap> : null}</AnimatePresence>
        </HeightFrame>
        <button
          className={styles.close}
          type="button"
          aria-label="Dismiss notification"
          onClick={() => dismiss(0)}
        >
          <X width={16} height={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </motion.div>}
    </AnimatePresence>
  );
}
