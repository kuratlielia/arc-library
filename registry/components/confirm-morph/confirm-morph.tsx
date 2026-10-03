"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, Ref } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion } from "motion/react";
import type { AnimationPlaybackControls, Transition, Variants } from "motion/react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./confirm-morph.module.css";

/** Where the control is in its life: resting, asking, working, finished, or failed. */
export type ConfirmMorphState = "idle" | "confirming" | "pending" | "done" | "error";

/**
 * A button for destructive or important actions that asks in place. Pressing it morphs the same surface into an inline
 * question with Cancel and Confirm, then into a spinner, then into a result with Undo. The width springs to each face, so
 * nothing around it jumps. Escape, an outside press, or the timeout all return it to rest.
 * Use it where a modal dialog would be heavy: deleting a selection, revoking access, discarding a draft.
 */
export interface ConfirmMorphProps {
  /** The resting label, such as "Delete". */
  label: ReactNode;
  /** A plain icon before the resting label. */
  icon?: ReactNode;
  /** The question shown while confirming, such as "Delete 3 files?". Defaults to the label with a question mark. */
  prompt?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Shown beside the spinner while `onConfirm` resolves. */
  pendingLabel?: string;
  doneLabel?: string;
  errorLabel?: string;
  retryLabel?: string;
  undoLabel?: string;
  /** Shown beside the spinner while `onUndo` resolves. */
  undoingLabel?: string;
  /** `danger` colours the resting label red and gives the pill a faint red edge; the confirm button always follows the accent. `neutral` keeps the resting label on the foreground for important, reversible actions. */
  tone?: "danger" | "neutral";
  /** Runs on confirm. Return a promise to show the pending face; a rejection shows the error face with Retry. */
  onConfirm?: () => void | Promise<unknown>;
  /** Offering it adds Undo to the result. Return a promise to show a pending face while it runs. */
  onUndo?: () => void | Promise<unknown>;
  onCancel?: () => void;
  /** Controlled state. Pair it with `onStateChange`. */
  state?: ConfirmMorphState;
  /** Starting state when uncontrolled. */
  defaultState?: ConfirmMorphState;
  onStateChange?: (state: ConfirmMorphState) => void;
  /** Milliseconds before an unanswered question returns to rest. Resting the pointer on the control pauses it. 0 turns it off. */
  confirmTimeout?: number;
  /** Milliseconds a result stays before returning to rest. Resting the pointer on the control pauses it. 0 turns it off. */
  resultTimeout?: number;
  /** A press outside the control cancels an open question. Defaults to true. */
  cancelOnOutsidePress?: boolean;
  disabled?: boolean;
  className?: string;
  /** Receives the root element, which also takes focus while the action is pending. */
  ref?: Ref<HTMLDivElement>;
}

const TRAVEL = 12;
const { blur } = motionTokens;
type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;
/** Duration springs restated as stiffness and damping so a retarget keeps the velocity already in flight. */
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const GROW = physical(.44, .18), SHRINK = physical(.34, 0), SLIDE = physical(.36, .06);

const subscribe = () => () => {};
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

/** Forward steps arrive from the right, backward steps from the left; the old face leaves the other way, blurred, so the eye reads one morph. */
const faceVariants: Variants = {
  hidden: (direction: number) => ({ opacity: 0, x: direction * TRAVEL, filter: `blur(${blur.soft}px)` }),
  shown: { opacity: 1, x: 0, filter: "blur(0px)", transition: { x: SLIDE, opacity: { duration: .2, ease: enter, delay: .04 }, filter: { duration: .22, ease: enter, delay: .04 } } },
  gone: (direction: number) => ({ opacity: 0, x: direction * -TRAVEL * .6, filter: `blur(${blur.soft}px)`, transition: { x: SLIDE, opacity: { duration: .12, ease: standard }, filter: { duration: .12, ease: standard } } }),
};
const fadeVariants: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: .14 } }, gone: { opacity: 0, transition: { duration: .1 } } };

function Face({ id, direction, reduced, onSize, children, labelledBy }: { id: ConfirmMorphState; direction: number; reduced: boolean; onSize: (id: ConfirmMorphState, width: number) => void; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !present) return;
    // Measure the natural width, not the width a tight container squeezes the face to, so squeezing never feeds back into the spring.
    const report = () => {
      const flex = node.style.flex;
      node.style.flex = "none";
      const width = node.offsetWidth;
      node.style.flex = flex;
      onSize(id, width);
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, onSize, present]);
  return <motion.div ref={ref} className={styles.face} data-face={id} custom={direction} role={labelledBy ? "group" : undefined} aria-labelledby={labelledBy}
    variants={reduced ? fadeVariants : faceVariants} initial="hidden" animate="shown" exit="gone" inert={!present || undefined}>{children}</motion.div>;
}

/** A success disc that pops in with a tick drawing across it, the moment the action lands. */
function Check({ reduced }: { reduced: boolean }) {
  return <svg className={styles.check} viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <motion.circle className={styles.checkDisc} cx="9" cy="9" r="8" style={{ transformOrigin: "9px 9px" }}
      initial={reduced ? false : { scale: .4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ scale: physical(.34, .3), opacity: { duration: .12 } }} />
    <motion.path className={styles.checkTick} d="M5.6 9.3 7.8 11.4 12.4 6.7" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .28, ease: enter, delay: .12 }} />
  </svg>;
}

export function ConfirmMorph({
  label, icon, prompt, confirmLabel = "Delete", cancelLabel = "Cancel", pendingLabel = "Deleting", doneLabel = "Deleted", errorLabel = "Couldn’t finish",
  retryLabel = "Retry", undoLabel = "Undo", undoingLabel = "Restoring", tone = "danger", onConfirm, onUndo, onCancel,
  state: stateProp, defaultState = "idle", onStateChange, confirmTimeout = 6000, resultTimeout = 5000, cancelOnOutsidePress = true, disabled = false, className, ref,
}: ConfirmMorphProps) {
  const reduced = useReducedFlag();
  const uid = useId();
  const promptId = `${uid}-prompt`;
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => rootRef.current as HTMLDivElement, []);

  const [inner, setInner] = useState<ConfirmMorphState>(defaultState);
  const state = stateProp ?? inner;
  const [direction, setDirection] = useState(1);
  const [working, setWorking] = useState<"confirm" | "undo">("confirm");
  const [announcement, setAnnouncement] = useState("");

  const live = useRef({ state, onStateChange, controlled: stateProp !== undefined });
  useLayoutEffect(() => { live.current = { state, onStateChange, controlled: stateProp !== undefined }; });
  const pendingFocus = useRef(false);
  const run = useRef(0);

  const go = useCallback((next: ConfirmMorphState) => {
    const current = live.current.state;
    if (next === current) return;
    const root = rootRef.current;
    // Focus follows the control between faces, but only when it was already inside; a timeout never steals focus from elsewhere.
    pendingFocus.current = !!root && (root.contains(document.activeElement) || document.activeElement === document.body);
    // Every step moves forward except the return to rest, which comes back from the left.
    setDirection(next === "idle" ? -1 : 1);
    if (!live.current.controlled) setInner(next);
    live.current.state = next;
    live.current.onStateChange?.(next);
  }, []);

  const toIdle = useCallback(() => { run.current++; go("idle"); }, [go]);

  const perform = useCallback(async (kind: "confirm" | "undo") => {
    const handler = kind === "confirm" ? onConfirm : onUndo;
    const token = ++run.current;
    setWorking(kind);
    let result: void | Promise<unknown> | undefined;
    try { result = handler?.(); }
    catch { go("error"); setAnnouncement(errorLabel); return; }
    if (result && typeof (result as Promise<unknown>).then === "function") {
      go("pending");
      setAnnouncement(kind === "confirm" ? pendingLabel : undoingLabel);
      try { await result; }
      catch {
        if (token !== run.current) return;
        go("error");
        setAnnouncement(errorLabel);
        return;
      }
      if (token !== run.current) return;
    }
    if (kind === "undo") { go("idle"); setAnnouncement("Undone"); return; }
    go("done");
    setAnnouncement(onUndo ? `${doneLabel}. ${undoLabel} is available.` : doneLabel);
  }, [doneLabel, errorLabel, go, onConfirm, onUndo, pendingLabel, undoLabel, undoingLabel]);

  const cancel = useCallback(() => { onCancel?.(); toIdle(); setAnnouncement("Cancelled"); }, [onCancel, toIdle]);
  const expire = useRef(() => {});
  useLayoutEffect(() => { expire.current = () => { if (live.current.state === "confirming") cancel(); else toIdle(); }; });

  /* The shape: one surface whose width springs to whichever face is current. At rest it is auto, so it renders right before hydration. */
  const width = useMotionValue<number | "auto">("auto");
  const target = useRef(0);
  const flight = useRef(0);
  const onFaceSize = useCallback((id: ConfirmMorphState, w: number) => {
    if (id !== live.current.state || Math.abs(w - target.current) < .5) return;
    const from = target.current;
    target.current = w;
    if (!from || reduced) { width.jump("auto"); return; }
    if (width.get() === "auto") width.jump(from);
    const token = ++flight.current;
    animate(width, w, w > from ? GROW : SHRINK).then(() => { if (token === flight.current) width.jump("auto"); });
  }, [reduced, width]);

  /* The timeout runs as an invisible clock. A pointer resting on the control holds it, and so does a hidden tab. */
  const drain = useMotionValue(1);
  const clock = useRef<AnimationPlaybackControls | null>(null);
  const holds = useRef({ hover: false, hidden: false });
  const timeout = state === "confirming" ? confirmTimeout : state === "done" || state === "error" ? resultTimeout : 0;
  const sync = useCallback(() => {
    const control = clock.current;
    if (!control) return;
    const held = holds.current.hover || holds.current.hidden;
    if (held) control.pause(); else control.play();
  }, []);
  useEffect(() => {
    if (!timeout) return;
    drain.jump(1);
    const control = animate(drain, 0, { duration: timeout / 1000, ease: "linear" });
    clock.current = control;
    control.then(() => { if (clock.current === control) { clock.current = null; expire.current(); } });
    sync();
    return () => { if (clock.current === control) clock.current = null; control.stop(); };
  }, [drain, state, sync, timeout]);
  useEffect(() => {
    const onVisibility = () => { holds.current.hidden = document.hidden; sync(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [sync]);

  // An outside press answers the question with no.
  useEffect(() => {
    if (state !== "confirming" || !cancelOnOutsidePress) return;
    const down = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) cancel(); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [cancel, cancelOnOutsidePress, state]);

  // Focus lands on the safe choice: Cancel while asking, Undo or Retry on a result, the root while working, the trigger at rest.
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const root = rootRef.current;
    if (!root) return;
    const face = root.querySelector<HTMLElement>(`[data-face="${state}"]`);
    const autofocus = face?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)");
    (autofocus ?? root).focus({ preventScroll: true });
  }, [state]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    if (state === "confirming") { event.preventDefault(); event.stopPropagation(); cancel(); }
    else if (state === "done" || state === "error") { event.preventDefault(); event.stopPropagation(); toIdle(); }
  };

  const shownPrompt = prompt ?? <>{label}?</>;
  const face = (() => {
    switch (state) {
      case "confirming": return <>
        <span id={promptId} className={styles.prompt}>{shownPrompt}</span>
        <button type="button" className={styles.secondary} data-autofocus onClick={cancel}>{cancelLabel}</button>
        <button type="button" className={styles.primary} onClick={() => void perform("confirm")}>{confirmLabel}</button>
      </>;
      case "pending": return <span className={styles.status}>
        <LoaderCircle className={styles.spinner} size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{working === "undo" ? undoingLabel : pendingLabel}</span>
      </span>;
      case "done": return <>
        <span className={styles.status} data-tone="success"><Check reduced={reduced} /><span className={styles.statusText}>{doneLabel}</span></span>
        {onUndo && <button type="button" className={styles.secondary} data-autofocus onClick={() => void perform("undo")}>{undoLabel}</button>}
      </>;
      case "error": return <>
        <span className={styles.status} data-tone="danger"><CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" /><span className={styles.statusText}>{errorLabel}</span></span>
        <button type="button" className={styles.secondary} data-autofocus onClick={() => void perform(working)}>{retryLabel}</button>
      </>;
      default: return <button type="button" className={styles.trigger} data-autofocus disabled={disabled} onClick={() => { setAnnouncement(typeof shownPrompt === "string" ? shownPrompt : ""); go("confirming"); }}>
        {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
        <span>{label}</span>
      </button>;
    }
  })();

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} data-state={state} data-tone={tone} data-disabled={disabled || undefined}
    tabIndex={-1} onKeyDown={onKeyDown} aria-busy={state === "pending" || undefined}
    onPointerEnter={() => { holds.current.hover = true; sync(); }} onPointerLeave={() => { holds.current.hover = false; sync(); }}
    onPointerCancel={() => { holds.current.hover = false; sync(); }}>
    <motion.div className={styles.surface} style={{ width }}>
      <AnimatePresence initial={false} custom={direction}>
        <Face key={state} id={state} direction={direction} reduced={reduced} onSize={onFaceSize} labelledBy={state === "confirming" ? promptId : undefined}>{face}</Face>
      </AnimatePresence>
    </motion.div>
    <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
  </div>;
}

export default ConfirmMorph;
