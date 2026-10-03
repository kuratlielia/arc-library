"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { TargetAndTransition, Variants } from "motion/react";
import { Check, CircleAlert, Pencil, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./inline-edit.module.css";

/**
 * Click-to-edit text for names and short fields that are read far more often than they change, such as a project name or its description.
 * The text turns into a field in place with the same metrics, so nothing around it moves, and the box grows with what you type. Enter saves
 * optimistically and a check draws once the save lands; Escape rolls the text back. A failed save restores the last saved value and says why.
 * Use a regular form when several fields must be saved together.
 */
export interface InlineEditProps {
  /** The saved value. A new value from outside replaces the text while it is not being edited. */
  value: string;
  /** Persists the new value. Return a promise to show the saving state, and reject it to roll back. */
  onSave: (next: string) => void | Promise<unknown>;
  /** Accessible name, for example “Project name”. */
  label: string;
  /** Returns a message when the draft cannot be saved. */
  validate?: (next: string) => string | null | undefined;
  /** Shown when the value is empty. */
  placeholder?: string;
  /** Wraps onto several lines and grows in height. Enter still saves; Shift+Enter adds a line break. */
  multiline?: boolean;
  /** `title` for names and headings, `body` for descriptions. */
  variant?: "title" | "body";
  /** The element that holds the text, so a title can stay a heading. */
  as?: "span" | "p" | "h1" | "h2" | "h3";
  className?: string;
}

type Phase = "idle" | "saving" | "saved" | "failed";

const enter = [...motionTokens.ease.enter] as [number, number, number, number];
const standard = [...motionTokens.ease.standard] as [number, number, number, number];
const blur = (px: number) => `blur(${px}px)`;
const noop = () => () => {};
/** Typing retargets many times a second, so the frame follows on a quicker spring without overshoot and keeps up with a fast typist. */
const typingSpring = { ...motionTokens.spring.snappy, visualDuration: motionTokens.duration.fast, bounce: 0 };

/** Reduced motion only counts after hydration, so the server and the first client render always agree. */
function useReduced() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const reduced = useReducedMotion() ?? false;
  return hydrated && reduced;
}

/** Text rises in from a soft blur. A rollback runs the other way, dropping the old words down and the saved ones in from above. */
const textMotion: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${direction * .3}em`, filter: blur(motionTokens.blur.soft) }),
  rest: { opacity: 1, y: "0em", filter: blur(0), transition: { duration: motionTokens.duration.standard, ease: enter } },
  exit: (direction: number) => ({ opacity: 0, y: `${direction * -.3}em`, filter: blur(motionTokens.blur.subtle), transition: { duration: motionTokens.duration.fast, ease: standard } }),
};
const textFade: Variants = { enter: { opacity: 0 }, rest: { opacity: 1, transition: { duration: motionTokens.duration.fast } }, exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };
const rest: TargetAndTransition = { opacity: 1, scale: 1, filter: blur(0) };
const iconIn: TargetAndTransition = { opacity: 0, scale: .6, filter: blur(motionTokens.blur.subtle) };
const iconOut: TargetAndTransition = { ...iconIn, transition: { duration: motionTokens.duration.fast, ease: standard } };
const fadeIn: TargetAndTransition = { opacity: 0 };
const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } };
/** Scale rides the spring; opacity and blur tween so the blur never overshoots below zero. */
const iconEnter = { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: enter }, filter: { duration: motionTokens.duration.fast, ease: enter } };

/** The tick draws itself from its short stroke, the way a hand would write it. */
function DrawnCheck({ reduced }: { reduced: boolean }) {
  return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <motion.path d="M4 12.5l5 5L20 6.5" initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { duration: .32, ease: enter, delay: .06 }, opacity: { duration: .05, delay: .06 } }} />
  </svg>;
}

/** A message row that opens and closes its height on a spring while the words rise in, so an error never pushes the page in one frame. */
function Reveal({ id, message, reduced }: { id: string; message: { key: string; tone: "error" | "failed"; node: ReactNode } | null; reduced: boolean }) {
  const inner = useRef<HTMLSpanElement>(null);
  const height = useMotionValue(0);
  useEffect(() => {
    const node = inner.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let measured = false;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
      if (!measured || reduced) { measured = true; height.jump(next); return; }
      animate(height, next, motionTokens.spring.smooth);
    });
    observer.observe(node, { box: "border-box" });
    return () => { observer.disconnect(); height.stop(); };
  }, [height, reduced]);
  return <motion.span className={styles.reveal} style={{ height }}>
    <span ref={inner} id={id} className={styles.revealInner} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false} custom={1}>
        {message && <motion.span key={message.key} className={styles.message} data-tone={message.tone} custom={1} variants={reduced ? textFade : textMotion} initial="enter" animate="rest" exit="exit">{message.node}</motion.span>}
      </AnimatePresence>
    </span>
  </motion.span>;
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

export function InlineEdit({ value, onSave, label, validate, placeholder = "", multiline = false, variant = "title", as: Tag = "span", className }: InlineEditProps) {
  const reduced = useReduced();
  const ids = useId();
  const displayHintId = `${ids}-display`, editHintId = `${ids}-edit`, messageId = `${ids}-message`;
  const [committed, setCommitted] = useState(value);
  const [shown, setShown] = useState(value);
  const [seen, setSeen] = useState(value);
  const [layer, setLayer] = useState({ key: 0, direction: 1 });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [flash, setFlash] = useState<"on" | "off" | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const display = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const selection = useRef<number | "all" | null>(null);
  const focusDisplay = useRef(false);
  const saveRun = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const frame = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  // Single line: the layout box and the input take a new width at once, so the input never scrolls, while the visible frame springs after it.
  // Multiline: the box's height springs, so content below glides, while the textarea already has the room its text needs.
  // Both start at their natural size ("100%", "auto"), so the server markup is already right before any script runs.
  const frameWidth = useMotionValue<number | string>("100%");
  const boxHeight = useMotionValue<number | string>("auto");
  const size = useRef(0);
  const wasEditing = useRef(false);

  // A new value from outside replaces the text, unless the person is typing or a save is still in flight.
  if (value !== seen) {
    setSeen(value);
    if (value !== committed) {
      setCommitted(value);
      if (!editing && phase !== "saving" && value !== shown) { setShown(value); setLayer(current => ({ key: current.key + 1, direction: 1 })); }
    }
  }

  const layerText = editing ? draft : shown;
  const saving = phase === "saving";
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const naturalSize = () => { const node = display.current; return node ? parseFloat(getComputedStyle(node)[multiline ? "height" : "width"]) : 0; };
  /** Written straight to the DOM before paint, because a motion value only reaches the style on its next frame, and one frame at the wrong size shows. */
  const snap = (next: number) => {
    const field = control.current;
    if (multiline && field) { field.style.height = `${next}px`; field.scrollTop = 0; }
    const surface = multiline ? box.current : frame.current;
    if (surface) surface.style[multiline ? "height" : "width"] = `${next}px`;
    (multiline ? boxHeight : frameWidth).jump(next);
  };

  // Changes the person caused (typing, switching modes, a rollback) spring from the size on screen. Measured in a layout effect, so no frame shows the new size early.
  const onContentChange = useEffectEvent(() => {
    const next = naturalSize();
    const previous = size.current;
    const typing = editing && wasEditing.current;
    size.current = next;
    wasEditing.current = editing;
    if (!next) return;
    const field = control.current;
    if (multiline && field) { field.style.height = `${next}px`; field.scrollTop = 0; }
    const target = multiline ? boxHeight : frameWidth;
    if (!previous || reduced || typeof target.get() !== "number") { snap(next); return; }
    if (Math.abs(next - previous) < .1) return;
    animate(target, next, multiline ? motionTokens.spring.smooth : typing ? typingSpring : motionTokens.spring.morph);
  });
  useLayoutEffect(() => { onContentChange(); }, [layerText, editing, multiline, reduced]);

  // A late web font or a resized container follows at once instead of animating.
  const onResize = useEffectEvent(() => {
    const next = naturalSize();
    if (!next || Math.abs(next - size.current) < .1) return;
    size.current = next;
    snap(next);
  });
  useEffect(() => {
    const node = display.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // Border box, so the room added while editing (padding, not content) is noticed too.
    const observer = new ResizeObserver(() => onResize());
    observer.observe(node, { box: "border-box" });
    return () => observer.disconnect();
  }, []);

  // Focus follows the mode: into the field with the caret where the text was clicked, and back to the text after Enter or Escape.
  useLayoutEffect(() => {
    const field = control.current;
    if (editing && field && selection.current !== null) {
      const at = selection.current;
      selection.current = null;
      field.focus({ preventScroll: true });
      if (at === "all") field.select(); else field.setSelectionRange(at, at);
    }
    if (!editing && focusDisplay.current) { focusDisplay.current = false; display.current?.focus({ preventScroll: true }); }
  });

  function startEdit(at: number | "all", text = shown) {
    if (editing || saving) return;
    setDraft(text);
    setEditing(true);
    setError(null);
    setFailed(null);
    setFlash(null);
    if (phase !== "idle") setPhase("idle");
    selection.current = at;
  }

  /** The caret lands on the character that was clicked, the way it would in a text field. */
  function caretAt(x: number, y: number) {
    const node = display.current?.querySelector(`[data-layer="${layer.key}"]`)?.firstChild;
    if (!node || !shown) return shown.length;
    const doc = document as CaretDocument;
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position) return position.offsetNode === node ? Math.min(position.offset, shown.length) : shown.length;
    const range = doc.caretRangeFromPoint?.(x, y);
    return range && range.startContainer === node ? Math.min(range.startOffset, shown.length) : shown.length;
  }

  function onDisplayClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (saving) return;
    // A keyboard activation selects everything, ready to retype; a click puts the caret where it landed.
    startEdit(event.detail === 0 ? "all" : caretAt(event.clientX, event.clientY));
  }

  const clean = (text: string) => multiline ? text.trim() : text.replace(/\s+/g, " ").trim();

  function submit(source: "key" | "button" | "blur") {
    const next = clean(draft);
    const problem = validate?.(next) || null;
    if (problem) { setError(problem); if (source !== "blur") control.current?.focus(); return; }
    setEditing(false);
    setError(null);
    if (source !== "blur") focusDisplay.current = true;
    // Trimmed spaces would shift the text in one frame, so a cleaned value arrives with the text motion instead.
    if (next !== draft) setLayer(current => ({ key: current.key + 1, direction: 1 }));
    if (next === shown) return;
    const previous = committed;
    const run = ++saveRun.current;
    setShown(next);
    setPhase("saving");
    setAnnouncement(`Saving ${label.toLowerCase()}`);
    Promise.resolve().then(() => onSave(next)).then(() => {
      if (run !== saveRun.current) return;
      setCommitted(next);
      setPhase("saved");
      setAnnouncement(`${label} saved`);
      later(() => setPhase(current => current === "saved" ? "idle" : current), 1800);
    }, () => {
      if (run !== saveRun.current) return;
      setShown(previous);
      setLayer(current => ({ key: current.key + 1, direction: -1 }));
      setPhase("failed");
      setFailed(next);
      setFlash("on");
      setAnnouncement("");
      later(() => setFlash(current => current === "on" ? "off" : current), 1400);
      later(() => setFlash(current => current === "off" ? null : current), 2000);
    });
  }

  function cancel() {
    setEditing(false);
    setError(null);
    focusDisplay.current = true;
    if (draft !== shown) setLayer(current => ({ key: current.key + 1, direction: -1 }));
  }

  function retry() {
    if (!failed) return;
    startEdit(failed.length, failed);
  }

  function onChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const next = event.target.value;
    setDraft(next);
    if (error) setError(validate?.(clean(next)) || null);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (event.key === "Enter" && !event.nativeEvent.isComposing && !(multiline && event.shiftKey)) { event.preventDefault(); submit("key"); }
  }

  // Leaving the component saves, the way a rename does; switching windows does not.
  function onBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (!editing) return;
    const next = event.relatedTarget as Node | null;
    if (next && root.current?.contains(next)) return;
    if (!next && !document.hasFocus()) return;
    submit("blur");
  }

  const noun = label.toLowerCase();
  const message = error
    ? { key: `error:${error}`, tone: "error" as const, node: <><CircleAlert className={styles.messageIcon} size={14} strokeWidth={2} aria-hidden="true" /><span>{error}</span></> }
    : failed && !editing
      ? { key: `failed:${failed}`, tone: "failed" as const, node: <><CircleAlert className={styles.messageIcon} size={14} strokeWidth={2} aria-hidden="true" /><span>{`Couldn’t save “${failed}”, so the last saved ${noun} is back.`} <button type="button" className={styles.retry} onClick={retry}>Try again</button></span></> }
      : null;
  const slot = editing ? "edit" : phase;
  const describedBy = (hint: string) => [hint, message ? messageId : null].filter(Boolean).join(" ");
  const fieldProps = {
    className: styles.control, value: draft, onChange, onKeyDown, placeholder, "aria-label": label, "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(editHintId), autoComplete: "off", spellCheck: variant === "body",
  };

  return <div ref={root} className={[styles.root, className].filter(Boolean).join(" ")} data-variant={variant} data-multiline={multiline || undefined} data-editing={editing || undefined}
    data-phase={phase} data-invalid={error ? "" : undefined} data-flash={flash ?? undefined} onBlur={onBlur}>
    <Tag className={styles.line}>
      <motion.span ref={box} className={styles.box} style={multiline ? { height: boxHeight } : undefined}>
        {/* The text stays in flow while editing, hidden and mirroring the draft, so it sizes the box and can roll back with motion on Escape. */}
        <button ref={display} type="button" className={styles.display} onClick={onDisplayClick} tabIndex={editing ? -1 : undefined}
          aria-label={`${label}: ${shown || placeholder}`} aria-describedby={describedBy(displayHintId)} aria-disabled={saving || undefined}>
          <span className={styles.layer} data-empty={layerText ? undefined : ""}>
            <AnimatePresence mode="popLayout" initial={false} custom={layer.direction}>
              <motion.span key={layer.key} data-layer={layer.key} className={styles.text} custom={layer.direction} variants={reduced ? textFade : textMotion} initial="enter" animate="rest" exit="exit">
                {/* A zero-width space keeps the line box, so an empty field never collapses. */}
                {(layerText || placeholder || "\u200b") + (multiline && editing ? "\u200b" : "")}
              </motion.span>
            </AnimatePresence>
          </span>
        </button>
        {editing && (multiline
          ? <textarea ref={node => { control.current = node; }} {...fieldProps} rows={1} enterKeyHint="done" />
          : <input ref={node => { control.current = node; }} {...fieldProps} type="text" enterKeyHint="done" />)}
        <motion.span ref={frame} className={styles.frame} style={multiline ? undefined : { width: frameWidth }}>
          <span className={styles.slot}>
            <AnimatePresence initial={false}>
              <motion.span key={slot} className={styles.slotItem} initial={reduced ? fadeIn : iconIn} animate={rest} exit={reduced ? fadeOut : iconOut} transition={reduced ? { duration: motionTokens.duration.fast } : iconEnter}>
                {slot === "edit" ? <span className={styles.actions}>
                  <button type="button" className={styles.save} aria-label={`Save ${noun}`} onPointerDown={event => event.preventDefault()} onClick={() => submit("button")}><Check size={15} strokeWidth={2} aria-hidden="true" /></button>
                  <button type="button" className={styles.cancel} aria-label="Cancel editing" onPointerDown={event => event.preventDefault()} onClick={cancel}><X size={15} strokeWidth={2} aria-hidden="true" /></button>
                </span>
                  : slot === "saving" ? <span className={styles.spinner} aria-hidden="true" />
                  : slot === "saved" ? <span className={styles.saved} aria-hidden="true"><DrawnCheck reduced={reduced} /></span>
                  : slot === "failed" ? <CircleAlert className={styles.failedIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
                  : <Pencil className={styles.pencil} size={14} strokeWidth={1.75} aria-hidden="true" onClick={() => startEdit(shown.length)} />}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.span>
      </motion.span>
    </Tag>
    <Reveal id={messageId} message={message} reduced={reduced} />
    <span id={displayHintId} className={styles.srOnly}>Activate to edit.</span>
    <span id={editHintId} className={styles.srOnly}>{multiline ? "Enter saves, Shift+Enter adds a line break, Escape cancels." : "Enter saves, Escape cancels."}</span>
    <span className={styles.srOnly} role="status">{announcement}</span>
  </div>;
}

export default InlineEdit;
