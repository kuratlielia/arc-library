"use client";

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition, type Variants } from "motion/react";
import { AnimatedCounter } from "@/registry/components/animated-counter/animated-counter";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./billing-toggle.module.css";

export interface BillingToggleOption {
  value: string;
  label: string;
  /** Short savings note, e.g. "Save 20%". */
  badge?: string;
  /** Badge text once this option is selected, e.g. "You save $48". Defaults to `badge`. */
  activeBadge?: string;
}

export interface BillingToggleProps {
  value: string;
  onValueChange: (value: string) => void;
  options?: BillingToggleOption[];
  /** Accessible name of the group. */
  label?: string;
  size?: "md" | "lg";
  className?: string;
}

const { duration, ease, blur } = motionTokens;

/** Critically damped: the thumb glides and lands without overshoot. */
const glide: Transition = { type: "spring", visualDuration: 0.34, bounce: 0 };

const DEFAULT_OPTIONS: BillingToggleOption[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly", badge: "Save 20%" },
];

const swap: Variants = {
  hidden: { opacity: 0, y: "0.45em", filter: `blur(${blur.subtle}px)` },
  shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: duration.standard, ease: [...ease.enter] } },
  gone: { opacity: 0, y: "-0.45em", filter: `blur(${blur.subtle}px)`, transition: { duration: duration.fast, ease: [...ease.standard] } },
};
const still: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: duration.fast } }, gone: { opacity: 0, transition: { duration: 0 } } };

/**
 * Text that swaps in place. Every candidate sits in the same grid cell, so the box always has the
 * width of the longest one and nothing around it moves when the text changes.
 */
function StableSwap({ text, candidates, reduced, className }: { text: string; candidates: string[]; reduced: boolean; className?: string }) {
  return (
    <span className={[styles.swap, className].filter(Boolean).join(" ")}>
      {[...new Set(candidates)].map(candidate => <span key={candidate} className={styles.swapSizer} aria-hidden="true">{candidate}</span>)}
      <AnimatePresence initial={false}>
        <motion.span key={text} className={styles.swapText} variants={reduced ? still : swap} initial="hidden" animate="shown" exit="gone">{text}</motion.span>
      </AnimatePresence>
    </span>
  );
}

type Thumb = { x: number; width: number };

/**
 * A billing period switch. One thumb glides between the options on a critically damped spring, and
 * the savings note on the cheaper period tints and rewrites itself in place once it is chosen.
 */
export function BillingToggle({ value, onValueChange, options = DEFAULT_OPTIONS, label = "Billing period", size = "md", className }: BillingToggleProps) {
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));

  const measure = useCallback(() => {
    const node = refs.current[selectedIndex];
    if (!node) return;
    setThumb(current => current && current.x === node.offsetLeft && current.width === node.offsetWidth ? current : { x: node.offsetLeft, width: node.offsetWidth });
  }, [selectedIndex]);

  useLayoutEffect(() => {
    measure();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : step ? (index + step + options.length) % options.length : -1;
    if (target < 0) return;
    event.preventDefault();
    onValueChange(options[target]!.value);
    refs.current[target]?.focus();
  };

  return (
    <div ref={rootRef} role="radiogroup" aria-label={label} className={[styles.root, className].filter(Boolean).join(" ")} data-size={size}>
      {thumb ? (
        <motion.span
          className={styles.thumb}
          aria-hidden="true"
          initial={false}
          animate={{ x: thumb.x, width: thumb.width }}
          transition={reduced ? { duration: 0 } : glide}
        />
      ) : null}
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        const badgeText = selected ? option.activeBadge ?? option.badge : option.badge;
        const candidates = [option.badge, option.activeBadge].filter((text): text is string => !!text);
        return (
          <button
            key={option.value}
            ref={node => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.option}
            data-selected={selected || undefined}
            onClick={() => onValueChange(option.value)}
            onKeyDown={event => onKeyDown(event, index)}
          >
            {selected && !thumb ? <span className={styles.thumbStatic} aria-hidden="true" /> : null}
            <span className={styles.content}>
              <span className={styles.label}>{option.label}</span>
              {badgeText ? (
                <span className={styles.badge} data-active={selected || undefined}>
                  <StableSwap text={badgeText} candidates={candidates} reduced={reduced} />
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface BillingPriceProps {
  amount: number;
  currency?: string;
  /** Period after the price, e.g. "per month". Swaps in place when it changes. */
  period?: string;
  /** Previous price, shown struck through when it is higher than `amount`. */
  was?: number;
  decimals?: number;
  className?: string;
}

const clip: Transition = { type: "spring", visualDuration: 0.36, bounce: 0 };

/** A price that rolls to its new amount. The old price and the period ease their width, so nothing beside them jumps. */
export function BillingPrice({ amount, currency = "$", period, was, decimals = 0, className }: BillingPriceProps) {
  const reduced = !!useReducedMotion();
  const showWas = was !== undefined && was > amount;
  const periodRef = useRef<HTMLSpanElement>(null);
  const [periodWidth, setPeriodWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const sizer = periodRef.current;
    if (sizer) setPeriodWidth(sizer.offsetWidth);
  }, [period]);

  return (
    <span className={[styles.price, className].filter(Boolean).join(" ")}>
      <span className={styles.amount}>
        <span className={styles.currency}>{currency}</span>
        <span className={styles.counter}><AnimatedCounter value={amount} decimals={decimals} /></span>
      </span>
      <span className={styles.aside}>
        <AnimatePresence initial={false}>
          {showWas ? (
            <motion.span
              key="was"
              className={styles.wasSlot}
              initial={reduced ? { opacity: 0 } : { opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, width: 0, transition: { ...clip, opacity: { duration: duration.fast } } }}
              transition={reduced ? { duration: duration.fast } : { ...clip, opacity: { duration: duration.standard, ease: [...ease.enter] } }}
            >
              <del className={styles.was}>{currency}{was.toFixed(decimals)}</del>
            </motion.span>
          ) : null}
        </AnimatePresence>
        {period ? (
          <motion.span
            className={styles.period}
            initial={false}
            animate={periodWidth === null ? undefined : { width: periodWidth }}
            transition={reduced ? { duration: 0 } : clip}
          >
            <span ref={periodRef} className={styles.periodSizer} aria-hidden="true">{period}</span>
            <AnimatePresence initial={false}>
              <motion.span key={period} className={styles.periodText} variants={reduced ? still : swap} initial="hidden" animate="shown" exit="gone">{period}</motion.span>
            </AnimatePresence>
          </motion.span>
        ) : null}
      </span>
    </span>
  );
}

export default BillingToggle;
