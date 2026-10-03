"use client";

import { isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { TargetAndTransition } from "motion/react";
import { ChevronDown } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./button-group.module.css";

export type ButtonGroupVariant = "outline" | "solid";
export type ButtonGroupSize = "sm" | "md";
export type ButtonGroupOrientation = "horizontal" | "vertical";

export interface ButtonGroupItem {
  /** Stable key for the segment. */
  id: string;
  /** Visible text and the accessible name. Changing it crossfades in place, so "Share" can answer "Copied". */
  label: string;
  /** Every other label this segment can show, such as ["Copied"]. The segment sizes to the widest, so a label change never resizes it. */
  reserve?: string[];
  icon?: ReactNode;
  /** Shows only the icon; the label becomes the accessible name and the tooltip. */
  iconOnly?: boolean;
  /** Visible content in place of the label, such as a live value. The label stays the accessible name. */
  content?: ReactNode;
  onSelect?: () => void;
  /** Renders the segment as a link. */
  href?: string;
  disabled?: boolean;
}

export interface ButtonGroupMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  /** Colors the item as a destructive action. */
  destructive?: boolean;
}

export interface ButtonGroupMenu {
  /** Accessible name and tooltip of the chevron segment, such as "More actions". */
  label: string;
  items: ButtonGroupMenuItem[];
}

export interface ButtonGroupProps {
  items: ButtonGroupItem[];
  /** Adds a trailing chevron segment that opens these actions in a menu aligned to the group's edge. */
  menu?: ButtonGroupMenu;
  /** Accessible name of the group, such as "Document actions". */
  label: string;
  variant?: ButtonGroupVariant;
  size?: ButtonGroupSize;
  orientation?: ButtonGroupOrientation;
  /** When the row does not fit its container, segments with an icon drop their label and keep the icon. Horizontal only. */
  collapseLabels?: boolean;
  /** Disables every segment and the menu. */
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Key of the chevron segment. Plain text, because the HTML parser rewrites control characters in server-rendered attributes. */
const MENU = "button-group-menu";

const rest: TargetAndTransition = { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" };
const textIn: TargetAndTransition = { opacity: 0, y: 4, filter: `blur(${motionTokens.blur.soft}px)` };
const textOut: TargetAndTransition = { opacity: 0, y: -3, filter: `blur(${motionTokens.blur.soft}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
const fadeIn: TargetAndTransition = { ...rest, opacity: 0 };
const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } };

/** Names the icon element, so swapping Link for Check morphs while a re-render of the same icon stays still. */
function iconKey(node: ReactNode): string {
  if (!isValidElement(node)) return node == null || typeof node === "boolean" ? "" : String(node);
  const type = node.type as string | { displayName?: string; name?: string };
  return typeof type === "string" ? type : type?.displayName ?? type?.name ?? "icon";
}

/** Springs the slot to the natural width of its content when the label changes; other resizes (a late web font, collapsing labels) jump. */
function useMorphWidth(content: RefObject<HTMLElement | null>, key: string, reduced: boolean) {
  const width = useMotionValue<number | "auto">("auto");
  const lastKey = useRef(key), armedUntil = useRef(0);
  useLayoutEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    armedUntil.current = performance.now() + 700;
  }, [key]);
  useEffect(() => {
    const node = content.current, slot = node?.parentElement;
    if (!node || !slot || typeof ResizeObserver === "undefined") return;
    let measured = false;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width;
      if (!next || !measured || reduced || performance.now() > armedUntil.current) { measured = next > 0; width.jump(next || "auto"); delete slot.dataset.morphing; return; }
      slot.dataset.morphing = "";
      animate(width, next, { ...motionTokens.spring.morph, onComplete: () => { delete slot.dataset.morphing; } });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [content, reduced, width]);
  return width;
}

/**
 * Icon and label of one segment. Every reserved label sits invisibly in the same grid cell, so the segment is as wide as its widest
 * state and a new label crossfades inside a fixed box: it rises in from a soft blur while the old one lifts away. A label nobody
 * reserved still never snaps: the slot springs to its width.
 */
function SegmentContent({ item, reduced }: { item: ButtonGroupItem; reduced: boolean }) {
  const contentRef = useRef<HTMLSpanElement>(null);
  const key = `${iconKey(item.icon)}|${item.content !== undefined ? "\u0000content" : item.iconOnly ? "" : item.label}`;
  const width = useMorphWidth(contentRef, key, reduced);
  const sizers = item.iconOnly || item.content !== undefined ? [] : [...new Set([item.label, ...(item.reserve ?? [])])];
  return <motion.span className={styles.slot} style={{ width }} aria-hidden="true">
    <span ref={contentRef} className={styles.slotContent}>
      {sizers.map(text => <span key={text} className={`${styles.phase} ${styles.sizer}`}>{item.icon ? <span className={styles.iconBox} /> : null}<span className={styles.label} data-collapsible={item.icon ? "" : undefined}>{text}</span></span>)}
      <AnimatePresence initial={false}>
        <motion.span key={key} className={styles.phase} initial={reduced ? fadeIn : textIn} animate={rest} exit={reduced ? fadeOut : textOut} transition={reduced ? { duration: motionTokens.duration.instant } : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>
          {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
          {item.content !== undefined ? <span className={styles.value}>{item.content}</span> : item.iconOnly ? null : <span className={styles.label} data-collapsible={item.icon ? "" : undefined}>{item.label}</span>}
        </motion.span>
      </AnimatePresence>
    </span>
  </motion.span>;
}

const inside = (node: HTMLElement, x: number, y: number) => {
  const rect = node.getBoundingClientRect();
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
};
/** Segments are found by their data-key, so the group needs no ref per segment. */
const segmentsIn = (root: HTMLElement | null) => Array.from(root?.querySelectorAll<HTMLElement>(":scope > [data-key]") ?? []);
const segmentIn = (root: HTMLElement | null, key: string | null) => key === null ? undefined : segmentsIn(root).find(node => node.dataset.key === key);
/** The segment's box inside the group at sub-pixel precision, undoing any scale an ancestor applies. */
function boxOf(group: HTMLElement, node: HTMLElement) {
  const outer = group.getBoundingClientRect(), inner = node.getBoundingClientRect();
  // offsetWidth is rounded to whole pixels, so only a real transform (more than a pixel apart) counts as scale.
  const scale = group.offsetWidth && Math.abs(outer.width - group.offsetWidth) > 1 ? outer.width / group.offsetWidth : 1;
  return [(inner.left - outer.left) / scale - group.clientLeft + group.scrollLeft, (inner.top - outer.top) / scale - group.clientTop + group.scrollTop, inner.width / scale, inner.height / scale];
}
const inert = (node: HTMLElement) => (node as HTMLButtonElement).disabled || node.getAttribute("aria-disabled") === "true";

/**
 * Related actions joined into one surface: a shared border and radius, hairline dividers, no gaps. One soft highlight glides
 * between segments under the pointer or keyboard focus, the pressed segment answers in place, and an optional chevron
 * segment opens more actions in a menu aligned to the group's edge.
 */
export function ButtonGroup({ items, menu, label, variant = "outline", size = "md", orientation = "horizontal", collapseLabels = true, disabled = false, className, style }: ButtonGroupProps) {
  const reduced = useReducedMotion() ?? false;
  const root = useRef<HTMLDivElement>(null);
  const vertical = orientation === "vertical";

  // The highlight sits on the pointer's segment, else the pressed one (touch), else the open menu's chevron, else keyboard focus.
  const [hover, setHover] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const active = hover ?? pressed ?? (menuOpen ? MENU : null) ?? focused;
  const keys = [...items.map(item => item.id), ...(menu ? [MENU] : [])];
  const activeIndex = active ? keys.indexOf(active) : -1;
  const inertKey = `${disabled}${items.map(item => item.disabled ? 1 : 0).join("")}`;

  const x = useMotionValue(0), y = useMotionValue(0), width = useMotionValue(0), height = useMotionValue(0), opacity = useMotionValue(0);
  const shown = useRef<string | null>(null);

  useLayoutEffect(() => {
    const node = segmentIn(root.current, active);
    // Hovering a disabled segment shows nothing; focus on one still shows where the keyboard is.
    if (!node || (inert(node) && active !== focused)) {
      if (shown.current) animate(opacity, 0, { duration: reduced ? motionTokens.duration.instant : motionTokens.duration.fast, ease: [...motionTokens.ease.standard] });
      shown.current = null;
      return;
    }
    const target = boxOf(root.current!, node);
    const values = [x, y, width, height];
    if (!shown.current || reduced) {
      // Arriving from nowhere, it appears in place; only moves between segments travel.
      values.forEach((value, index) => value.jump(target[index]));
      animate(opacity, 1, { duration: reduced ? motionTokens.duration.instant : motionTokens.duration.fast, ease: [...motionTokens.ease.standard] });
    } else {
      values.forEach((value, index) => animate(value, target[index], motionTokens.spring.snappy));
      animate(opacity, 1, { duration: motionTokens.duration.fast });
    }
    shown.current = active;
    // inertKey re-checks a segment that turns disabled under a still pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, inertKey, reduced, x, y, width, height, opacity]);

  // Segments resize when a label morphs or labels collapse; the highlight stays locked to its segment.
  const keyList = keys.join("\u0000");
  useEffect(() => {
    const group = root.current;
    if (!group || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const node = segmentIn(group, shown.current);
      if (!node) return;
      const target = boxOf(group, node);
      [x, y, width, height].forEach((value, index) => {
        if (Math.abs(value.get() - target[index]) < .01) return;
        if (value.isAnimating() && !reduced) animate(value, target[index], motionTokens.spring.snappy); else value.jump(target[index]);
      });
    });
    observer.observe(group);
    segmentsIn(group).forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [keyList, reduced, x, y, width, height]);

  // Labels collapse to icons when the row overflows, and come back once the container is wide enough for the full row again.
  const [overflowing, setCompact] = useState(false);
  const fullWidth = useRef(0), blockedAt = useRef(0);
  const collapsible = collapseLabels && !vertical && items.some(item => item.icon && !item.iconOnly && item.content === undefined);
  const compact = collapsible && overflowing;
  useEffect(() => {
    const group = root.current, parent = group?.parentElement;
    if (!group || !parent || !collapsible || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const box = getComputedStyle(parent);
      const available = parent.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
      if (group.dataset.compact === undefined) {
        if (group.scrollWidth > group.clientWidth + 1) { fullWidth.current = group.scrollWidth + 2; blockedAt.current = available; setCompact(true); }
      } else if (available > blockedAt.current && available >= fullWidth.current) setCompact(false);
    };
    const observer = new ResizeObserver(check);
    observer.observe(group);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [collapsible, keyList]);

  // Pressing tracks the segment under the finger, so touch gets the same highlight a pointer gets on hover.
  useEffect(() => {
    if (!pressed) return;
    const release = () => setPressed(null);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); };
  }, [pressed]);

  const hit = (event: PointerEvent) => {
    for (const node of segmentsIn(root.current)) if (inside(node, event.clientX, event.clientY)) return inert(node) ? null : node.dataset.key ?? null;
    return null;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== "touch") setHover(hit(event)); };
  const onPointerLeave = () => setHover(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => { if (event.button === 0) setPressed(hit(event)); };

  // Keyboard focus shows the highlight; a mouse click focuses without it, so nothing stays lit after the pointer leaves.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const key = target.dataset.key;
    if (key === undefined) return;
    let visible = true;
    try { visible = target.matches(":focus-visible"); } catch { /* older engines */ }
    setFocused(visible ? key : null);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setFocused(null); };

  // Tab visits every segment in order; arrow keys along the orientation, Home and End also move between them.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    // Disabled segments stay focusable (aria-disabled), so the keyboard can find them and hear why nothing happens.
    const list = segmentsIn(root.current).filter(node => !(node as HTMLButtonElement).disabled);
    const index = list.findIndex(node => node === document.activeElement);
    if (index < 0) return;
    const rtl = !vertical && getComputedStyle(root.current!).direction === "rtl";
    const forward = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    const last = list.length - 1;
    const target = event.key === forward ? (index === last ? 0 : index + 1) : event.key === backward ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (target < 0) return;
    event.preventDefault();
    list[target].focus();
  };

  // A label that changes right after its segment is pressed, such as "Copied", is announced once; the quiet revert is not.
  const [announcement, setAnnouncement] = useState("");
  const labels = useRef<Map<string, string> | null>(null);
  const activated = useRef({ key: "", at: 0 });
  const labelList = items.map(item => `${item.id}\u0000${item.label}`).join("\u0001");
  useEffect(() => {
    const previous = labels.current;
    labels.current = new Map(items.map(item => [item.id, item.label]));
    if (!previous) return;
    const recent = performance.now() - activated.current.at < 1000;
    const changed = items.filter(item => recent && item.id === activated.current.key && previous.has(item.id) && previous.get(item.id) !== item.label && item.content === undefined);
    if (changed.length) setAnnouncement(changed.map(item => item.label).join(", "));
    // labelList carries the only part of items this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelList]);

  const select = (item: ButtonGroupItem) => { activated.current = { key: item.id, at: performance.now() }; item.onSelect?.(); };
  const quiet = (index: number) => activeIndex >= 0 && (index === activeIndex || index === activeIndex + 1) ? "" : undefined;

  const segments = items.map((item, index) => {
    const off = item.disabled && !disabled;
    const named = item.iconOnly || item.content !== undefined || (compact && !!item.icon);
    const common = {
      className: [styles.segment, item.iconOnly ? styles.iconOnly : ""].filter(Boolean).join(" "),
      "data-key": item.id,
      "data-quiet": quiet(index),
      "data-collapsible": item.icon && !item.iconOnly && item.content === undefined ? "" : undefined,
      "aria-label": named ? item.label : undefined,
      title: item.iconOnly || (compact && item.icon) ? item.label : undefined,
    };
    const body = <span className={styles.content}><SegmentContent item={item} reduced={reduced} /></span>;
    if (item.href && !off && !disabled) return <a key={item.id} {...common} href={item.href} onClick={() => select(item)}>{body}{named ? null : <span className={styles.srOnly}>{item.label}</span>}</a>;
    return <button key={item.id} {...common} type="button" disabled={disabled} aria-disabled={off || undefined} onClick={off ? undefined : () => select(item)}>{body}{named ? null : <span className={styles.srOnly}>{item.label}</span>}</button>;
  });

  const classes = [styles.group, styles[variant], styles[size], vertical ? styles.vertical : "", compact ? styles.compact : "", className].filter(Boolean).join(" ");
  const group = <div ref={root} className={classes} style={style} role="group" aria-label={label} aria-disabled={disabled || undefined} data-orientation={orientation} data-compact={compact ? "" : undefined} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown} onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>
    <motion.span className={styles.highlight} style={{ x, y, width, height, opacity }} data-pressed={pressed && pressed === active ? "" : undefined} aria-hidden="true" />
    {segments}
    {menu ? <DropdownPrimitive.Trigger className={[styles.segment, styles.trigger].join(" ")} data-key={MENU} data-quiet={quiet(items.length)} aria-label={menu.label} title={menu.label} disabled={disabled}>
      <span className={styles.content}><ChevronDown className={styles.chevron} aria-hidden="true" /></span>
    </DropdownPrimitive.Trigger> : null}
    <span className={styles.srOnly} aria-live="polite">{announcement}</span>
  </div>;

  if (!menu) return group;
  // Non-modal: no scroll lock, so opening the menu never shifts the page by a scrollbar's width.
  return <DropdownPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
    {group}
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content className={styles.menu} side="bottom" align={vertical ? "start" : "end"} alignOffset={-1} sideOffset={6} collisionPadding={12} loop>
        {menu.items.map((action, index) => {
          const classes = [styles.item, action.destructive ? styles.destructive : ""].filter(Boolean).join(" ");
          const body = <>{action.icon ? <span className={styles.itemIcon} aria-hidden="true">{action.icon}</span> : null}<span className={styles.itemLabel}>{action.label}</span></>;
          return action.href
            ? <DropdownPrimitive.Item key={action.id} className={classes} style={{ "--i": index } as CSSProperties} disabled={action.disabled} onSelect={action.onSelect} asChild><a href={action.href}>{body}</a></DropdownPrimitive.Item>
            : <DropdownPrimitive.Item key={action.id} className={classes} style={{ "--i": index } as CSSProperties} disabled={action.disabled} onSelect={action.onSelect}>{body}</DropdownPrimitive.Item>;
        })}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  </DropdownPrimitive.Root>;
}

export default ButtonGroup;
