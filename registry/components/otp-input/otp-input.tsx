"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, ChangeEvent, FocusEvent } from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./otp-input.module.css";

export interface OtpInputProps {
  length?: number;
  value?: string;
  onChange?: (value: string) => void;
  label: string;
  description?: string;
  error?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  inputMode?: "numeric" | "text";
  className?: string;
}

/** Changed words rise in and unblur while unchanged words hold still. Assistive tech reads the plain copy. */
function MotionText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const words = text.split(" ");
  return <><span className={styles.srOnly}>{text}</span><span className={styles.words} aria-hidden="true"><AnimatePresence initial={false} mode="popLayout">{words.map((word, index) => <motion.span key={`${index}:${word}`} className={styles.word}
    initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
    exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.35em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }}
    transition={reduced ? { duration: motionTokens.duration.instant } : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{index < words.length - 1 ? `${word} ` : word}</motion.span>)}</AnimatePresence></span></>;
}

/** Helper and error copy: the row opens its height on a spring, then the words settle in. */
function FieldMessage({ id, text, className, alert }: { id?: string; text?: string; className: string; alert?: boolean }) {
  return <AnimatePresence initial={false}>{text ? <MessageRow key="message" id={id} text={text} className={className} alert={alert} /> : null}</AnimatePresence>;
}

/** The row tracks the measured copy, so a longer message that wraps opens its next line instead of snapping. */
function MessageRow({ id, text, className, alert }: { id?: string; text: string; className: string; alert?: boolean }) {
  const reduced = useReducedMotion();
  const copyRef = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useEffect(() => {
    const node = copyRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <motion.span className={styles.messageSlot} initial={{ height: 0, opacity: 0 }} animate={{ height, opacity: 1 }} exit={{ height: 0, opacity: 0, transition: reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.instant } } }} transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } }}>
    <motion.span ref={copyRef} id={id} className={className} role={alert ? "alert" : undefined} initial={reduced ? false : { y: "0.35em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ y: 0, filter: "blur(0px)" }} transition={{ duration: reduced ? 0 : motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}><MotionText text={text} /></motion.span>
  </motion.span>;
}

export function OtpInput({ length = 6, value = "", onChange, label, description, error, autoFocus = false, disabled = false, inputMode = "numeric", className }: OtpInputProps) {
  const generatedId = useId();
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const values = Array.from({ length }, (_, index) => value[index] ?? "");
  const hintId = description ? `${generatedId}-description` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const focusAt = (index: number) => inputRefs.current[Math.max(0, Math.min(index, length - 1))]?.focus();
  const sanitize = (next: string) => inputMode === "numeric" ? next.replace(/\D/g, "") : next;
  // One ring for the whole row. It glides between slots while focus stays inside, and fades in where focus lands when it arrives from outside.
  const [ring, setRing] = useState({ x: 0, width: 0, shown: false, glide: false });
  // A paste fills several slots in one update; those digits land as a short left to right wave.
  const [fill, setFill] = useState({ value, wave: false });
  if (fill.value !== value) setFill({ value, wave: Array.from({ length }, (_, index) => (fill.value[index] ?? "") !== (value[index] ?? "")).filter(Boolean).length > 1 });
  const lastError = useRef(error);

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus();
  }, [autoFocus]);

  // Slots shrink at narrow widths; keep the ring on the focused slot when the row resizes.
  useEffect(() => {
    const row = scope.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const slot = (row.contains(document.activeElement) ? document.activeElement?.parentElement : null) as HTMLElement | null;
      if (slot) setRing(current => (current.x === slot.offsetLeft && current.width === slot.offsetWidth ? current : { ...current, x: slot.offsetLeft, width: slot.offsetWidth, glide: false }));
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [scope]);

  // A new error nudges the row side to side once, so a rejected code reads as a response to the attempt.
  useEffect(() => {
    if (error && error !== lastError.current && !reduced && scope.current) animate(scope.current, { x: [0, -6, 5, -3, 2, 0] }, { duration: .36, ease: [...motionTokens.ease.standard] });
    lastError.current = error;
  }, [error, reduced, animate, scope]);

  const updateAt = (index: number, raw: string) => {
    const next = values.slice();
    const clean = sanitize(raw).slice(-1);
    next[index] = clean;
    onChange?.(next.join(""));
    if (clean && index < length - 1) focusAt(index + 1);
  };

  const handleChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const raw = sanitize(event.target.value);
    if (raw.length <= 1) {
      updateAt(index, raw);
      return;
    }

    const next = values.slice();
    raw.slice(0, length - index).split("").forEach((character, offset) => { next[index + offset] = character; });
    onChange?.(next.join(""));
    focusAt(Math.min(index + raw.length, length - 1));
  };
  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = sanitize(event.clipboardData.getData("text")).slice(0, length - index);
    if (!pasted) return;
    const next = values.slice();
    pasted.split("").forEach((character, offset) => { next[index + offset] = character; });
    onChange?.(next.join(""));
    focusAt(Math.min(index + pasted.length, length - 1));
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); focusAt(index - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); focusAt(index + 1); }
    if (event.key === "Backspace" && !values[index] && index > 0) {
      event.preventDefault();
      const next = values.slice();
      next[index - 1] = "";
      onChange?.(next.join(""));
      focusAt(index - 1);
    }
    if (event.key === "Delete" && values[index]) {
      const next = values.slice();
      next[index] = "";
      onChange?.(next.join(""));
    }
  };
  const handleFocus = (event: FocusEvent<HTMLInputElement>) => { const slot = event.currentTarget.parentElement as HTMLElement; setRing(current => ({ x: slot.offsetLeft, width: slot.offsetWidth, shown: true, glide: current.shown })); };
  const handleBlur = (event: FocusEvent<HTMLInputElement>) => { if (!scope.current?.contains(event.relatedTarget as Node | null)) setRing(current => ({ ...current, shown: false, glide: false })); };
  const glyphTransition = (index: number): Transition => reduced ? { duration: motionTokens.duration.instant } : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter], delay: fill.wave ? index * motionTokens.stagger.item : 0 };

  return <div className={[styles.field, className].filter(Boolean).join(" ")}>
    <span className={styles.label}>{label}</span>
    <div ref={scope} className={styles.inputs} role="group" aria-label={label} data-invalid={error ? "true" : undefined}>
      {values.map((character, index) => <div key={`${generatedId}-${index}`} className={styles.slot}>
        <input
          ref={(node) => { inputRefs.current[index] = node; }}
          className={styles.input}
          aria-label={`${label}, digit ${index + 1} of ${length}`}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          value={character}
          data-filled={character ? "true" : undefined}
          maxLength={1}
          inputMode={inputMode}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          disabled={disabled}
          onChange={(event) => handleChange(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {/* The input text is transparent; this copy of the digit rises into the slot and unblurs. */}
        <AnimatePresence initial={false}>{character ? <motion.span key={character} className={styles.glyph} aria-hidden="true" initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: .9, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }} transition={glyphTransition(index)}>{character}</motion.span> : null}</AnimatePresence>
      </div>)}
      <motion.span className={styles.ring} aria-hidden="true" initial={false} animate={{ x: ring.x, width: ring.width, opacity: ring.shown ? 1 : 0, scale: ring.shown ? 1 : .94 }} transition={reduced ? { duration: 0 } : { x: ring.glide ? motionTokens.spring.snappy : { duration: 0 }, width: { duration: 0 }, scale: motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast } }} />
    </div>
    <FieldMessage id={hintId} text={description} className={styles.description} />
    <FieldMessage id={errorId} text={error} className={styles.error} alert />
  </div>;
}
