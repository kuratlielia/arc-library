"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from "motion/react";
import type { AnimationPlaybackControls, MotionValue, Variants } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import { useToday } from "@/lib/use-today";
import styles from "./calendar.module.css";

export type CalendarDateMatcher = (date: Date) => boolean;

export interface CalendarProps {
  value?: Date;
  onChange?: (date: Date) => void;
  month?: Date;
  onMonthChange?: (month: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  disabledDates?: CalendarDateMatcher;
  locale?: string;
  className?: string;
  /** Adds a Today button that slides back to the current month and selects today when it is available. */
  showToday?: boolean;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const sameDay = (a?: Date, b?: Date) => Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
const sameMonth = (a?: Date, b?: Date) => Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth());
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const addMonths = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
/** Moves by whole months and keeps the day, clamped to the shorter month: January 31 plus one month is February 28. */
const shiftMonths = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth() + amount, Math.min(date.getDate(), new Date(date.getFullYear(), date.getMonth() + amount + 1, 0).getDate()));
const isBefore = (a: Date, b?: Date) => Boolean(b && startOfDay(a).getTime() < startOfDay(b).getTime());
const isAfter = (a: Date, b?: Date) => Boolean(b && startOfDay(a).getTime() > startOfDay(b).getTime());
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** Every month shows six weeks, so the grid keeps one height and never jumps while months change. */
const makeWeeks = (month: Date) => {
  const start = addDays(month, -month.getDay());
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)));
};

const subscribeNothing = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
/** The viewer's local date (lib/use-today.ts, shared with date-range-picker). Re-exported so existing imports from calendar keep working. */
export { useToday } from "@/lib/use-today";

const { spring, duration, ease } = motionTokens;
/** Months sit side by side on one strip. Rapid clicks retarget the same spring, so the strip never queues or stacks panes. */
const stripSpring = { type: "spring", visualDuration: 0.36, bounce: 0, restDelta: 0.002 } as const;
const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
const fromIndex = (index: number) => new Date(Math.floor(index / 12), ((index % 12) + 12) % 12, 1);

/** The title crossfades in place: the old month leaves toward the side the strip travels to while the new one arrives from the other. */
const titleSlide: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 12 }),
  center: { opacity: 1, x: 0, transition: { duration: duration.standard, ease: ease.enter } },
  exit: (direction: number) => ({ opacity: 0, x: direction * -12, transition: { duration: 0.14, ease: ease.standard } }),
};
/** Reduced motion swaps the title in place, with no travel and no blank frame. */
const titleFade: Variants = { enter: { opacity: 1, x: 0 }, center: { opacity: 1, x: 0, transition: { duration: 0 } }, exit: { opacity: 0, transition: { duration: 0 } } };

/**
 * The selected disc of one month. It is positioned by week and weekday rather than measured, so it glides on a straight
 * line between any two days, keeps gliding while the strip slides, and retargets mid-flight on a new pick.
 * It only grows in or fades out when the selection enters or leaves this month.
 */
function SelectionDisc({ cell, reduced }: { cell: number; reduced: boolean }) {
  const visible = cell >= 0;
  const col = useMotionValue(visible ? cell % 7 : 0);
  const row = useMotionValue(visible ? Math.floor(cell / 7) : 0);
  const opacity = useMotionValue(visible ? 1 : 0);
  const scale = useMotionValue(visible ? 1 : 0.6);
  // Each step is one cell plus the 4px gap; percentages resolve against the disc's own size, which matches a cell.
  const transform = useTransform(() => `translate(calc(${col.get()} * (100% + 4px)), calc(${row.get()} * (100% + 4px))) scale(${scale.get()})`);
  const hidden = useRef(!visible);
  useLayoutEffect(() => {
    if (!visible) {
      hidden.current = true;
      const fade = reduced ? { duration: 0 } : { duration: 0.14, ease: ease.standard };
      const controls = [animate(opacity, 0, fade), animate(scale, 0.6, fade)];
      return () => controls.forEach((control) => control.stop());
    }
    const nextCol = cell % 7, nextRow = Math.floor(cell / 7);
    const controls: AnimationPlaybackControls[] = [];
    if (hidden.current || reduced) { col.jump(nextCol); row.jump(nextRow); }
    else controls.push(animate(col, nextCol, spring.morph), animate(row, nextRow, spring.morph));
    hidden.current = false;
    controls.push(animate(opacity, 1, reduced ? { duration: 0 } : { duration: duration.fast, ease: ease.enter }), animate(scale, 1, reduced ? { duration: 0 } : spring.snappy));
    return () => controls.forEach((control) => control.stop());
  }, [cell, visible, reduced, col, row, opacity, scale]);
  return <motion.span className={styles.highlight} style={{ transform, opacity }} aria-hidden="true"><span className={styles.highlightFill} /></motion.span>;
}

/** One month on the strip. Only the month being navigated to is focusable and exposed; the one sliding past is inert. */
function MonthPane({ index, position, present, children }: { index: number; position: MotionValue<number>; present: boolean; children: ReactNode }) {
  const x = useTransform(position, (value) => `calc(${(index - value) * 100}% + ${(index - value) * 16}px)`);
  const opacity = useTransform(position, (value) => 1 - Math.min(1, Math.abs(index - value)) * 0.6);
  return <motion.div className={styles.monthBody} style={{ x, opacity }} data-present={present || undefined} aria-hidden={present ? undefined : true} inert={!present}>{children}</motion.div>;
}

export function Calendar({
  value,
  onChange,
  month: controlledMonth,
  onMonthChange,
  minDate,
  maxDate,
  disabledDates,
  locale = "en-US",
  className,
  showToday = false,
}: CalendarProps) {
  const titleId = useId();
  const today = useToday();
  // Motion preference only counts after hydration, so server and client markup agree.
  const hydrated = useSyncExternalStore(subscribeNothing, clientSnapshot, serverSnapshot);
  const reducedMotion = (useReducedMotion() ?? false) && hydrated;
  const [internalMonth, setInternalMonth] = useState(() => (value ? monthStart(value) : undefined));
  const [focusedDate, setFocusedDate] = useState(value);
  const viewportRef = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<string | null>(null);
  // Without a value or month the calendar waits for the client's today, then settles on that month once.
  const fallback = value ?? today;
  const month = controlledMonth ? monthStart(controlledMonth) : internalMonth ?? (fallback && monthStart(fallback));
  if (!controlledMonth && !internalMonth && month) setInternalMonth(month);
  const monthTime = month?.getTime();
  const monthKey = month ? dateKey(month) : "pending";
  // Direction is read from the month itself, so arrows, keys, Today, and a controlled month all travel the same way.
  const [shownMonth, setShownMonth] = useState(monthTime);
  const [direction, setDirection] = useState(0);
  if (shownMonth !== monthTime) {
    setShownMonth(monthTime);
    setDirection(shownMonth === undefined || monthTime === undefined ? 0 : monthTime > shownMonth ? 1 : -1);
  }
  const weeks = useMemo(() => (monthTime === undefined ? [] : makeWeeks(new Date(monthTime))), [monthTime]);
  // The strip position is measured in months. The panes on either side of it render, plus the month being navigated to.
  const target = month ? monthIndex(month) : 0;
  const position = useMotionValue(target);
  const [span, setSpan] = useState<[number, number]>([target, target]);
  useMotionValueEvent(position, "change", (value) => {
    const next: [number, number] = [Math.floor(value + 1e-3), Math.ceil(value - 1e-3)];
    setSpan((current) => (current[0] === next[0] && current[1] === next[1] ? current : next));
  });
  const ready = month !== undefined;
  const placed = useRef(ready);
  useLayoutEffect(() => {
    if (!ready) return;
    const from = position.get();
    if (from === target) return;
    // The first month and reduced motion land in place; everything else slides on the strip.
    if (!placed.current || reducedMotion) { placed.current = true; position.jump(target); return; }
    // Long jumps (Today, a year with Shift) start one month away, so the strip never scrolls through the months between.
    if (Math.abs(target - from) > 2) position.jump(target - Math.sign(target - from));
    const controls = animate(position, target, stripSpring);
    return () => controls.stop();
  }, [ready, target, reducedMotion, position]);
  const paneIndexes = Array.from(new Set([span[0], span[1], target])).sort((a, b) => a - b);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }), [locale]);
  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) => weekdayFormatter.format(new Date(2024, 0, 7 + index))), [weekdayFormatter]);
  const monthLabel = month ? formatter.format(month) : "";
  // The selected disc glides between days, so each number flips color as the disc actually passes it:
  // the day it leaves waits longer on short hops, the day it lands on waits longer on long ones.
  const valueKey = value ? dateKey(value) : "";
  const [last, setLast] = useState({ key: valueKey, date: value });
  const [handoff, setHandoff] = useState({ from: "", to: "", distance: 0 });
  if (last.key !== valueKey) {
    const days = last.date && value ? Math.round((startOfDay(value).getTime() - startOfDay(last.date).getTime()) / 864e5) : 0;
    const columns = last.date && value ? value.getDay() - last.date.getDay() : 0;
    setLast({ key: valueKey, date: value });
    setHandoff({ from: last.key, to: valueKey, distance: Math.hypot(columns, (days - columns) / 7) });
  }
  const numberDelay = (key: string): CSSProperties | undefined => {
    if (!handoff.distance || reducedMotion || (key !== handoff.to && key !== handoff.from)) return undefined;
    const delay = key === handoff.to ? Math.min(260, 95 + 85 * Math.log(handoff.distance)) : Math.max(20, 130 / handoff.distance);
    return { "--number-delay": `${Math.round(delay)}ms` } as CSSProperties;
  };

  const isDisabled = (date: Date) => isBefore(date, minDate) || isAfter(date, maxDate) || Boolean(disabledDates?.(date));
  const previousMonth = month && addMonths(month, -1);
  const nextMonth = month && addMonths(month, 1);
  // While the month is still unknown the controls keep their resting look, so hydration does not flash them dim.
  const previousDisabled = Boolean(previousMonth && minDate && previousMonth.getTime() < monthStart(minDate).getTime());
  const nextDisabled = Boolean(nextMonth && maxDate && nextMonth.getTime() > monthStart(maxDate).getTime());
  const todaySelectable = Boolean(today && !isDisabled(today) && onChange);
  const todayIdle = Boolean(today && sameMonth(month, today) && (!todaySelectable || sameDay(value, today)));
  // Roving tab stop: the day last focused, else the selection, else today, else the first open day of the month.
  const tabbableKey = (() => {
    const open = (date?: Date) => (date && sameMonth(date, month) && !isDisabled(date) ? dateKey(date) : "");
    return open(focusedDate) || open(value) || open(today) || dateKey(weeks.flat().find((date) => sameMonth(date, month) && !isDisabled(date)) ?? new Date(0));
  })();

  const changeMonth = (target: Date) => {
    const normalized = monthStart(target);
    if (!controlledMonth) setInternalMonth(normalized);
    onMonthChange?.(normalized);
  };

  /** Keyboard focus lands on the new day in the same frame the month starts to slide. */
  useLayoutEffect(() => {
    const key = focusRequest.current;
    if (!key) return;
    const button = viewportRef.current?.querySelector<HTMLButtonElement>(`[data-present] [data-date="${key}"]`);
    if (button) { focusRequest.current = null; button.focus({ preventScroll: true }); }
  });

  /** Clamps a keyboard move to the allowed range and steps past blocked days in the direction of travel. */
  const moveFocus = (from: Date, target: Date, step: number) => {
    let next = isBefore(target, minDate) && minDate ? startOfDay(minDate) : isAfter(target, maxDate) && maxDate ? startOfDay(maxDate) : target;
    for (let tries = 0; tries < 42 && isDisabled(next); tries += 1) next = addDays(next, step);
    if (isDisabled(next) || sameDay(next, from)) return;
    setFocusedDate(next);
    focusRequest.current = dateKey(next);
    if (!sameMonth(next, month)) changeMonth(next);
  };

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isDisabled(date)) onChange?.(date);
      return;
    }
    const moves: Record<string, [Date, number]> = {
      ArrowLeft: [addDays(date, -1), -1],
      ArrowRight: [addDays(date, 1), 1],
      ArrowUp: [addDays(date, -7), -1],
      ArrowDown: [addDays(date, 7), 1],
      Home: [addDays(date, -date.getDay()), 1],
      End: [addDays(date, 6 - date.getDay()), -1],
      PageUp: [shiftMonths(date, event.shiftKey ? -12 : -1), -1],
      PageDown: [shiftMonths(date, event.shiftKey ? 12 : 1), 1],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveFocus(date, move[0], move[1]);
  };

  const goToToday = () => {
    if (!today || !month || todayIdle) return;
    setFocusedDate(today);
    if (!sameMonth(today, month)) changeMonth(today);
    if (todaySelectable && !sameDay(value, today)) onChange?.(today);
  };

  const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");
  // Six fixed weeks per month, so a day's cell is its distance from the first day on the grid.
  const cellOf = (paneMonth: Date) => {
    if (!value) return -1;
    const first = addDays(paneMonth, -paneMonth.getDay());
    const index = Math.round((startOfDay(value).getTime() - first.getTime()) / 864e5);
    return index >= 0 && index < 42 ? index : -1;
  };

  const renderMonth = (paneMonth: Date, present: boolean) => <>
    <SelectionDisc cell={cellOf(paneMonth)} reduced={reducedMotion} />
    <div className={styles.grid} role="grid" aria-label={formatter.format(paneMonth)}>
    {makeWeeks(paneMonth).map((week) => <div key={dateKey(week[0]!)} className={styles.week} role="row">
      {week.map((date) => {
        const key = dateKey(date);
        const selected = sameDay(date, value);
        const isToday = sameDay(date, today);
        return <button
          key={key}
          type="button"
          role="gridcell"
          data-date={key}
          aria-label={date.toLocaleDateString(locale, { dateStyle: "full" })}
          aria-selected={selected}
          aria-current={isToday ? "date" : undefined}
          tabIndex={present && key === tabbableKey ? 0 : -1}
          disabled={isDisabled(date)}
          style={present ? numberDelay(key) : undefined}
          className={cx(styles.day, !sameMonth(date, paneMonth) && styles.outside, selected && styles.selected, isToday && styles.today)}
          onFocus={() => setFocusedDate(date)}
          onKeyDown={(event) => onDayKeyDown(event, date)}
          onClick={() => onChange?.(date)}
        ><span className={styles.dayNumber}>{date.getDate()}</span></button>;
      })}
    </div>)}
    </div>
  </>;

  return <section className={cx(styles.calendar, className)} aria-labelledby={titleId}>
      <div className={styles.header}>
        <h2 id={titleId} className={styles.heading}>
          <span className={styles.srOnly}>{monthLabel}</span>
          <span className={styles.title} aria-hidden="true">
            <AnimatePresence initial={false} custom={direction}>
              {month && <motion.span key={monthKey} className={styles.titleRow} custom={direction} variants={reducedMotion || !direction ? titleFade : titleSlide} initial="enter" animate="center" exit="exit">{monthLabel}</motion.span>}
            </AnimatePresence>
          </span>
        </h2>
        <span className={styles.srOnly} aria-live="polite">{direction ? monthLabel : ""}</span>
        <div className={styles.navigation}>
          {showToday && <button type="button" className={styles.todayButton} aria-disabled={todayIdle || undefined} aria-label={today ? `Today, ${today.toLocaleDateString(locale, { dateStyle: "full" })}` : "Today"} onClick={goToToday}>Today</button>}
          <button type="button" className={styles.navButton} aria-label="Previous month" aria-disabled={previousDisabled || undefined} onClick={() => { if (!previousDisabled && previousMonth) changeMonth(previousMonth); }}><ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          <button type="button" className={styles.navButton} aria-label="Next month" aria-disabled={nextDisabled || undefined} onClick={() => { if (!nextDisabled && nextMonth) changeMonth(nextMonth); }}><ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
      </div>
      <div className={styles.weekdays} aria-hidden="true">{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day.slice(0, 2)}</span>)}</div>
      <div className={styles.monthViewport} ref={viewportRef}>
        {month ? paneIndexes.map((index) => <MonthPane key={index} index={index} position={position} present={index === target}>{renderMonth(fromIndex(index), index === target)}</MonthPane>)
          : <div className={styles.monthBody} aria-hidden="true"><div className={styles.grid}>{Array.from({ length: 6 }, (_, week) => <div key={week} className={styles.week}>{Array.from({ length: 7 }, (_, day) => <span key={day} className={styles.placeholderDay} />)}</div>)}</div></div>}
      </div>
    </section>;
}

export { addDays, addMonths, sameDay, startOfDay };
