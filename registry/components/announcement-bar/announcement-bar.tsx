"use client";

import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { AnimationPlaybackControls, Transition, Variants } from "motion/react";
import { ArrowRight, ChevronDown, ChevronUp, Pause, Play, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./announcement-bar.module.css";

export interface AnnouncementAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface Announcement {
  /** Stable id, reported to callbacks. */
  id: string;
  message: ReactNode;
  action?: AnnouncementAction;
  /** Counts down to a moment, for example the end of a sale. */
  countdown?: { to: Date | string | number; label?: string };
}

/**
 * A slim bar for the top of a page. It can rotate several messages, each rising in from below while the bar springs to
 * the new height; rotation pauses on hover, focus, or a hidden tab, and `controls` adds previous, next, and a pause ring. Messages can carry a
 * call to action and a live countdown. Dismissing collapses the height smoothly so the page below eases up, and with an
 * `id` the dismissal is remembered in `localStorage`.
 */
export interface AnnouncementBarProps {
  messages: Announcement[];
  /** Remembers dismissal under this id. Change the id to show a new campaign to everyone again. */
  id?: string;
  /** Whether the bar is shown. Leave it out to let the component manage it. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Index of the visible message. */
  index?: number;
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  /** Milliseconds each message stays before the next one. Defaults to 6000. */
  interval?: number;
  /** Rotate automatically. Pauses on hover, focus, or a hidden tab, and is turned off when the visitor prefers reduced motion. Defaults to true. */
  autoPlay?: boolean;
  /** Show previous, next, and pause controls when there are several messages. Defaults to false: only the close button shows. */
  controls?: boolean;
  dismissible?: boolean;
  tone?: "neutral" | "inverted";
  onAction?: (announcement: Announcement) => void;
  onCountdownEnd?: (announcement: Announcement) => void;
  /** Accessible name of the region. */
  label?: string;
  className?: string;
}

const storageKey = (id: string) => `arc-announcement:${id}`;
/** Forgets a remembered dismissal so the bar with this id shows again. */
export function clearAnnouncementDismissal(id: string) {
  try { window.localStorage.removeItem(storageKey(id)); } catch { /* Storage can be blocked. */ }
}

type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const RISE = physical(.46, .1), HEIGHT = physical(.42, 0), COLLAPSE = physical(.44, 0);

/** Next rises from below and leaves upward; previous runs the other way. */
const faceVariants: Variants = {
  hidden: (direction: number) => ({ opacity: 0, y: `${direction * 70}%`, filter: `blur(${motionTokens.blur.soft}px)` }),
  shown: { opacity: 1, y: "0%", filter: "blur(0px)", transition: { y: RISE, opacity: { duration: motionTokens.duration.standard, ease: enter }, filter: { duration: motionTokens.duration.standard, ease: enter } } },
  gone: (direction: number) => ({ opacity: 0, y: `${direction * -60}%`, filter: `blur(${motionTokens.blur.soft}px)`, transition: { y: RISE, opacity: { duration: motionTokens.duration.fast, ease: standard }, filter: { duration: motionTokens.duration.fast, ease: standard } } }),
};
const fadeVariants: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: motionTokens.duration.standard, ease: standard } }, gone: { opacity: 0, transition: { duration: motionTokens.duration.instant, ease: standard } } };

function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(total / 86400), h: Math.floor(total % 86400 / 3600), m: Math.floor(total % 3600 / 60), s: total % 60 };
}
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * One character cell. A changed digit drops in from above while the old one falls away, like a counter winding down.
 * The invisible sizer keeps the cell in the text flow, so it shares the baseline of the words around it.
 */
function Digit({ char, reduced }: { char: string; reduced: boolean }) {
  return <span className={styles.digit}>
    <span className={styles.digitSizer} aria-hidden="true">0</span>
    <AnimatePresence initial={false}>
      <motion.span key={char} className={styles.digitFace}
        initial={reduced ? { opacity: 0 } : { y: "-70%", opacity: 0 }} animate={{ y: "0%", opacity: 1 }} exit={reduced ? { opacity: 0 } : { y: "70%", opacity: 0 }}
        transition={reduced ? { duration: motionTokens.duration.instant } : { y: physical(.32, .08), opacity: { duration: motionTokens.duration.fast, ease: standard } }}>{char}</motion.span>
    </AnimatePresence>
  </span>;
}

function Countdown({ to, label, reduced, onEnd }: { to: Date | string | number; label?: string; reduced: boolean; onEnd?: () => void }) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState<number | null>(null);
  const ended = useRef(false);
  const endRef = useRef(onEnd);
  useEffect(() => { endRef.current = onEnd; }, [onEnd]);
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= target) {
        if (!ended.current) { ended.current = true; endRef.current?.(); }
        return;
      }
      // Wake just after each whole second so digits change on the beat.
      timer = window.setTimeout(tick, 1000 - (current % 1000) + 8);
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [target]);
  const { d, h, m, s } = parts(now === null ? 0 : target - now);
  const pending = now === null;
  const spoken = pending ? "" : `${d ? `${d} days ` : ""}${h} hours ${m} minutes`;
  const digits = (value: string, key: string) => value.split("").map((char, index) => <Digit key={`${key}${value.length - index}`} char={pending ? "0" : char} reduced={reduced} />);
  return <span className={styles.countdown}>
    {label ? <span className={styles.countdownLabel}>{label}</span> : null}
    <span role="timer" aria-live="off" aria-label={spoken} className={styles.time} data-pending={pending || undefined}>
      {d ? <><span className={styles.unit}>{digits(String(d), "d")}<span className={styles.unitMark} aria-hidden="true">d</span></span><span className={styles.gap} aria-hidden="true" /></> : null}
      {digits(pad(h), "h")}<span className={styles.sep} aria-hidden="true">:</span>{digits(pad(m), "m")}<span className={styles.sep} aria-hidden="true">:</span>{digits(pad(s), "s")}
    </span>
  </span>;
}

function Face({ announcement, direction, reduced, position, total, onSize, onAction, onCountdownEnd }: { announcement: Announcement; direction: number; reduced: boolean; position: number; total: number; onSize: (height: number) => void; onAction?: (announcement: Announcement) => void; onCountdownEnd?: (announcement: Announcement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !present) return;
    const report = () => onSize(node.offsetHeight);
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onSize, present]);
  const { action, countdown } = announcement;
  const cta = action ? action.href
    ? <a className={styles.cta} href={action.href} onClick={() => { action.onClick?.(); onAction?.(announcement); }}>{action.label}<ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" /></a>
    : <button type="button" className={styles.cta} onClick={() => { action.onClick?.(); onAction?.(announcement); }}>{action.label}<ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" /></button> : null;
  return <motion.div ref={ref} className={styles.face} custom={direction} variants={reduced ? fadeVariants : faceVariants} initial="hidden" animate="shown" exit="gone"
    role={total > 1 ? "group" : undefined} aria-roledescription={total > 1 ? "slide" : undefined} aria-label={total > 1 ? `${position} of ${total}` : undefined} inert={!present || undefined}>
    <p className={styles.message}>
      <span className={styles.text}>{announcement.message}</span>
      {countdown ? <Countdown to={countdown.to} label={countdown.label} reduced={reduced} onEnd={() => onCountdownEnd?.(announcement)} /> : null}
      {cta}
    </p>
  </motion.div>;
}

const RING = 2 * Math.PI * 8;

export const AnnouncementBar = forwardRef<HTMLElement, AnnouncementBarProps>(function AnnouncementBar({
  messages, id, open: openProp, defaultOpen = true, onOpenChange, index: indexProp, defaultIndex = 0, onIndexChange,
  interval = 6000, autoPlay = true, controls = false, dismissible = true, tone = "neutral", onAction, onCountdownEnd, label = "Announcements", className,
}, ref) {
  const reduced = !!useReducedMotion();
  const uid = useId();
  const total = messages.length;

  /* Open state: controlled, or internal and hidden at once when this id was dismissed before. */
  const [openInternal, setOpenInternal] = useState(defaultOpen);
  const [remembered, setRemembered] = useState(false);
  useLayoutEffect(() => {
    if (!id || openProp !== undefined) return;
    let stored = false;
    try { stored = window.localStorage.getItem(storageKey(id)) === "dismissed"; } catch { /* Storage can be blocked. */ }
    // Storage is only readable on the client; hide before paint so a dismissed bar never flashes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setRemembered(true);
  }, [id, openProp]);
  const open = openProp ?? (openInternal && !remembered);

  const dismiss = () => {
    if (id) { try { window.localStorage.setItem(storageKey(id), "dismissed"); } catch { /* Storage can be blocked. */ } }
    if (openProp === undefined) setOpenInternal(false);
    onOpenChange?.(false);
  };

  /* Rotation. */
  const [indexInternal, setIndexInternal] = useState(defaultIndex);
  const current = total ? ((indexProp ?? indexInternal) % total + total) % total : 0;
  const [direction, setDirection] = useState(1);
  const go = useCallback((step: number) => {
    if (total < 2) return;
    const next = ((current + step) % total + total) % total;
    setDirection(step > 0 ? 1 : -1);
    if (indexProp === undefined) setIndexInternal(next);
    onIndexChange?.(next);
  }, [current, indexProp, onIndexChange, total]);

  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const read = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);
  const rotating = autoPlay && !reduced && total > 1;
  const running = rotating && open && !userPaused && !hovered && !focused && !hidden;

  /* The ring is the clock: its progress runs to one, then advances. Pausing stops it where it is; resuming finishes the rest. */
  const progress = useMotionValue(0);
  const dash = useTransform(progress, value => RING * (1 - value));
  const goRef = useRef(go);
  useEffect(() => { goRef.current = go; }, [go]);
  useEffect(() => { progress.jump(0); }, [current, progress]);
  useEffect(() => {
    if (!running) return;
    let controls: AnimationPlaybackControls | null = animate(progress, 1, {
      duration: interval / 1000 * (1 - progress.get()), ease: "linear",
      onComplete: () => { controls = null; goRef.current(1); },
    });
    return () => controls?.stop();
  }, [running, current, interval, progress]);

  /* The viewport springs to the height of the current message, which can wrap on narrow screens. */
  const height = useMotionValue<number | "auto">("auto");
  const measured = useRef(0);
  const onSize = useCallback((next: number) => {
    if (Math.abs(next - measured.current) < .5) return;
    const first = measured.current === 0;
    measured.current = next;
    if (first || reduced) height.jump(next);
    else animate(height, next, HEIGHT);
  }, [height, reduced]);

  const announcement = messages[current];
  if (!announcement) return null;
  const navigable = controls && total > 1;
  const controlCount = (navigable ? 2 + (rotating ? 1 : 0) : 0) + (dismissible ? 1 : 0);

  return <AnimatePresence initial={false}>
    {open ? <motion.section key="bar" ref={ref} className={[styles.collapse, className].filter(Boolean).join(" ")} aria-label={label}
      aria-roledescription={total > 1 ? "carousel" : undefined}
      initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
      exit={reduced ? { opacity: 0, transition: { duration: motionTokens.duration.fast } } : { height: 0, opacity: 0, transition: { height: COLLAPSE, opacity: { duration: motionTokens.duration.exit, ease: standard } } }}
      transition={reduced ? { duration: motionTokens.duration.fast } : { height: COLLAPSE, opacity: { duration: motionTokens.duration.standard, ease: enter } }}
      onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }} onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
      <div className={styles.bar} data-tone={tone} style={{ "--controls": controlCount } as CSSProperties}>
        <div className={styles.side} aria-hidden="true" />
        <motion.div className={styles.viewport} style={{ height }} id={`${uid}-slides`} aria-live={running ? "off" : "polite"} aria-atomic="false">
          <AnimatePresence initial={false} custom={direction}>
            <Face key={announcement.id} announcement={announcement} direction={direction} reduced={reduced} position={current + 1} total={total}
              onSize={onSize} onAction={onAction} onCountdownEnd={onCountdownEnd} />
          </AnimatePresence>
        </motion.div>
        <div className={styles.controls}>
          {navigable ? <>
            <button type="button" className={styles.icon} aria-label="Previous announcement" aria-controls={`${uid}-slides`} onClick={() => go(-1)}><ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" /></button>
            {rotating ? <button type="button" className={styles.ring} aria-label={userPaused ? "Resume announcements" : "Pause announcements"} aria-pressed={userPaused} onClick={() => setUserPaused(paused => !paused)}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="8" className={styles.ringTrack} />
                <motion.circle cx="10" cy="10" r="8" className={styles.ringFill} strokeDasharray={RING} style={{ strokeDashoffset: dash }} />
              </svg>
              <span className={styles.ringIcon}>{userPaused ? <Play size={9} strokeWidth={2.4} aria-hidden="true" /> : <Pause size={9} strokeWidth={2.4} aria-hidden="true" />}</span>
            </button> : null}
            <button type="button" className={styles.icon} aria-label="Next announcement" aria-controls={`${uid}-slides`} onClick={() => go(1)}><ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          </> : null}
          {dismissible ? <button type="button" className={styles.icon} aria-label="Dismiss" onClick={dismiss}><X size={16} strokeWidth={1.75} aria-hidden="true" /></button> : null}
        </div>
      </div>
    </motion.section> : null}
  </AnimatePresence>;
});

export default AnnouncementBar;
