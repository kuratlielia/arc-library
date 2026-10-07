"use client";
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./password-field.module.css";
/** The toggle's names. Both have English defaults; pass the ones you translate. */
export interface PasswordFieldMessages { showPassword: string; hidePassword: string }
export const defaultPasswordFieldMessages: PasswordFieldMessages = { showPassword: "Show password", hidePassword: "Hide password" };
export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  description?: string;
  /** Translated or reworded toggle names. */
  messages?: Partial<PasswordFieldMessages>;
}
/** One eye that a slash draws across, cutting the outline beneath it, instead of swapping two icons. */
function EyeMorph({ slashed }: { slashed: boolean }) {
  const reduced = useReducedMotion(); const maskId = `eye-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const slash = { pathLength: slashed ? 1 : 0, opacity: slashed ? 1 : 0 };
  const transition = reduced ? { duration: 0 } : { pathLength: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.standard] }, opacity: { duration: motionTokens.duration.instant } };
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white" stroke="none" /><motion.path d="M2 2l20 20" stroke="black" strokeWidth={5} initial={false} animate={slash} transition={transition} /></mask>
    <g mask={`url(#${maskId})`}><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></g>
    <motion.path d="M2 2l20 20" initial={false} animate={slash} transition={transition} />
  </svg>;
}
/** Changed words rise in and unblur while unchanged words hold still. Assistive tech reads the plain copy. */
function MotionText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const words = text.split(" ");
  return <><span className={styles.srOnly}>{text}</span><span className={styles.words} aria-hidden="true"><AnimatePresence initial={false} mode="popLayout">{words.map((word, index) => <motion.span key={`${index}:${word}`} className={styles.word}
    initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
    exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.35em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.exit] } }}
    transition={reduced ? { duration: motionTokens.duration.instant } : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{index < words.length - 1 ? `${word} ` : word}</motion.span>)}</AnimatePresence></span></>;
}

/** Helper and error copy: the row opens its height on a spring, then the words settle in. */
function FieldMessage({ id, text, className, alert }: { id?: string; text?: string; className?: string; alert?: boolean }) {
  return <AnimatePresence initial={false}>{text ? <MessageRow key="message" id={id} text={text} className={className} alert={alert} /> : null}</AnimatePresence>;
}

/** The row tracks the measured copy, so a longer message that wraps opens its next line instead of snapping. */
function MessageRow({ id, text, className, alert }: { id?: string; text: string; className?: string; alert?: boolean }) {
  const reduced = useReducedMotion();
  const copyRef = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useEffect(() => {
    const node = copyRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setHeight(entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <motion.span className={styles.messageSlot} initial={{ height: 0, opacity: 0 }} animate={{ height, opacity: 1 }} exit={{ height: 0, opacity: 0, transition: reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.instant } } }} transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } }}>
    <motion.span ref={copyRef} id={id} className={className} role={alert ? "alert" : undefined} initial={reduced ? false : { y: "0.35em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ y: 0, filter: "blur(0px)" }} transition={{ duration: reduced ? 0 : motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}><MotionText text={text} /></motion.span>
  </motion.span>;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField({ label, description, messages: messagesProp, id, className, ...props }, ref) {
  const messages = { ...defaultPasswordFieldMessages, ...messagesProp };
  const generated = useId(); const controlId = id ?? generated; const [visible, setVisible] = useState(false); const [toggled, setToggled] = useState(false);
  const hintId = description ? `${controlId}-description` : undefined;
  // data-reveal only appears after the first toggle, so the value resolves on each change but never on mount.
  return <div className={styles.field}><label htmlFor={controlId}>{label}</label><div className={styles.shell}><input {...props} ref={ref} id={controlId} type={visible ? "text" : "password"} data-reveal={toggled ? (visible ? "shown" : "hidden") : undefined} aria-describedby={[props["aria-describedby"], hintId].filter(Boolean).join(" ") || undefined} className={[styles.input, className].filter(Boolean).join(" ")} /><button type="button" onClick={() => { setVisible(current => !current); setToggled(true); }} aria-label={visible ? messages.hidePassword : messages.showPassword} aria-pressed={visible}><EyeMorph slashed={visible} /></button></div><FieldMessage id={hintId} text={description} className={styles.hint} /></div>;
});
