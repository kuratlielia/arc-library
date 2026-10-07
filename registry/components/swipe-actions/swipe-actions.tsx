"use client";

import { createContext, useContext, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { AnimationPlaybackControls, MotionValue } from "motion/react";
import { MoreHorizontal } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./swipe-actions.module.css";

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  /** Fill of the revealed action. Pair `danger` with a label that names the destructive result. */
  tone?: "neutral" | "accent" | "danger";
  /** Runs for a full swipe, a tap on the revealed action, or the More actions menu. Remove the item here unless `keepRow` is set. */
  onSelect: () => void;
  /** The row springs home after the action instead of sliding away and collapsing, for actions such as Mark as unread. */
  keepRow?: boolean;
}

/**
 * A list whose rows reveal actions on a horizontal swipe, the way a mail inbox does. Use it for short lists where people triage items quickly.
 * Only one row stays open at a time; touching anywhere else or pressing Escape puts it away. Every row also has a More actions menu with the same
 * actions, so keyboard and screen reader users never need the gesture.
 */
export interface SwipeActionsProps { label: string; children: ReactNode; className?: string }

/** One row. `leading` actions sit under the left edge and `trailing` actions under the right; the outermost action on each side commits on a full swipe. */
export interface SwipeActionsRowProps {
  /** Names the row in its menu button, for example the message subject. */
  label: string;
  leading?: SwipeAction[];
  trailing?: SwipeAction[];
  /** Lets a long swipe commit the outermost action without a tap. On by default. */
  fullSwipe?: boolean;
  children: ReactNode;
  className?: string;
}

type Side = "leading" | "trailing";
type Group = { openId: string | null; setOpenId: Dispatch<SetStateAction<string | null>>; rows: Map<string, HTMLElement> };
type Drag = { pointer: number; type: string; startX: number; startY: number; origin: number; locked: "x" | "y" | null; samples: [number, number][] };

/** Width of one action while a row rests open. */
const ACTION = 76;
/** Movement before a press is read as a swipe or handed to the page as a scroll. */
const SLOP = 8;
/** Seconds of travel projected from the release velocity, roughly a 0.99 deceleration rate. */
const PROJECTION = .1;
/** Release speed in px/s that counts as a flick. */
const FLICK = 900;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Past its last stop the row still follows, but every pixel costs more, like pulling against elastic. */
const rubberBand = (overshoot: number, dimension: number) => (1 - 1 / (overshoot * .55 / dimension + 1)) * dimension;
const sideOf = (value: number): Side | null => value > 0 ? "leading" : value < 0 ? "trailing" : null;

const GroupContext = createContext<Group>({ openId: null, setOpenId: () => {}, rows: new Map() });

export function SwipeActions({ label, children, className }: SwipeActionsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [rows] = useState(() => new Map<string, HTMLElement>());
  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (event: PointerEvent) => { const row = rows.get(openId); if (row && event.target instanceof Node && row.contains(event.target)) return; setOpenId(null); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenId(null); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown, true); document.removeEventListener("keydown", onKeyDown); };
  }, [openId, rows]);
  const group = useMemo(() => ({ openId, setOpenId, rows }), [openId, rows]);
  return <GroupContext.Provider value={group}>
    <div className={[styles.surface, className].filter(Boolean).join(" ")}>
      <ul role="list" aria-label={label} tabIndex={-1} className={styles.list}>
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </div>
  </GroupContext.Provider>;
}

function velocityOf(samples: [number, number][]) {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const first = samples.find(sample => last[0] - sample[0] <= 80) ?? last;
  const elapsed = (last[0] - first[0]) / 1000;
  return elapsed > 0 ? (last[1] - first[1]) / elapsed : 0;
}

export function SwipeActionsRow({ label, leading = [], trailing = [], fullSwipe = true, children, className }: SwipeActionsRowProps) {
  const { openId, setOpenId, rows } = useContext(GroupContext);
  const id = useId();
  const reduced = useReducedMotion() ?? false;
  const present = useIsPresent();
  const rowRef = useRef<HTMLLIElement>(null);
  const x = useMotionValue(0);
  const cover = useMotionValue(0);
  const [covering, setCovering] = useState<{ side: Side; index: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const width = useRef(0);
  const drag = useRef<Drag | null>(null);
  const travel = useRef<AnimationPlaybackControls | null>(null);
  const stretch = useRef<AnimationPlaybackControls | null>(null);
  const armed = useRef(false);
  const leaving = useRef(false);
  const swallowClick = useRef(false);
  const focusNeighbour = useRef(false);
  const restoreTimer = useRef(0);

  const actionsOf = (side: Side) => side === "leading" ? leading : trailing;
  const openWidth = (side: Side) => actionsOf(side).length * ACTION;
  const outermost = (side: Side) => side === "leading" ? 0 : trailing.length - 1;
  const canCommit = (side: Side) => fullSwipe && actionsOf(side).length > 0;
  const threshold = (side: Side) => Math.max(openWidth(side) + 48, width.current * .56);

  function stretchTo(value: number) {
    stretch.current?.stop();
    if (reduced) { cover.jump(value); return; }
    stretch.current = animate(cover, value, motionTokens.spring.morph);
  }

  /** Springs the row to a stop, carrying the release velocity. Travel snaps instantly with reduced motion. */
  function settle(target: number, velocity = 0) {
    if (armed.current || (target !== 0 && cover.get() !== 0)) stretchTo(0);
    armed.current = false;
    const from = x.get();
    const home = () => { if (target === 0) { stretch.current?.stop(); cover.jump(0); } };
    if (reduced) { x.jump(target); home(); }
    else {
      // Heading home, the spring may not carry the row past zero, or the opposite actions would flash.
      const toward = target === 0 && Math.sign(velocity) === -Math.sign(from);
      const launch = toward ? Math.sign(velocity) * Math.min(Math.abs(velocity), Math.abs(from) * 12) : velocity;
      travel.current = animate(x, target, { ...(target === 0 ? motionTokens.spring.smooth : motionTokens.spring.snappy), velocity: launch, onComplete: home });
    }
    if (target === 0) setOpenId(current => current === id ? null : current);
    else setOpenId(id);
  }

  /** The chosen action stretches over the whole row while the row leaves in its direction; the list then closes the gap. */
  function commit(side: Side, index: number, velocity = 0) {
    const action = actionsOf(side)[index];
    if (!action || leaving.current) return;
    const direction = side === "leading" ? 1 : -1;
    armed.current = false;
    setCovering({ side, index });
    stretchTo(1);
    if (action.keepRow) { action.onSelect(); settle(0, velocity); return; }
    leaving.current = true;
    const row = rowRef.current;
    if (row) row.dataset.removing = "";
    travel.current?.stop();
    const end = direction * (width.current + 2);
    if (reduced) x.jump(end);
    else travel.current = animate(x, end, { ...motionTokens.spring.smooth, velocity: Math.sign(velocity) === direction ? velocity : 0 });
    setOpenId(current => current === id ? null : current);
    action.onSelect();
    // A list that keeps the item gets its row back instead of an empty band of colour.
    window.clearTimeout(restoreTimer.current);
    restoreTimer.current = window.setTimeout(() => { if (!leaving.current) return; leaving.current = false; if (row) delete row.dataset.removing; settle(0); }, 1400);
  }

  function arm(value: number, pointerType: string) {
    const side = sideOf(value);
    const limit = side ? threshold(side) : Infinity;
    const next = !!side && canCommit(side) && Math.abs(value) > (armed.current ? limit - 20 : limit);
    if (next === armed.current || !side) { if (!side && armed.current) { armed.current = false; stretchTo(0); } return; }
    armed.current = next;
    if (next) {
      setCovering({ side, index: outermost(side) });
      if (pointerType === "touch") navigator.vibrate?.(8);
    }
    stretchTo(next ? 1 : 0);
  }

  function constrain(raw: number) {
    const side = sideOf(raw);
    if (!side) return 0;
    const dimension = width.current || 320;
    const limit = actionsOf(side).length === 0 ? 0 : canCommit(side) ? dimension : openWidth(side);
    const distance = Math.abs(raw);
    return Math.sign(raw) * (distance <= limit ? distance : limit + rubberBand(distance - limit, dimension));
  }

  function release(velocity: number) {
    const value = x.get(), side = sideOf(value);
    if (!side || actionsOf(side).length === 0) { settle(0, velocity); return; }
    const direction = side === "leading" ? 1 : -1;
    const distance = Math.abs(value), outward = velocity * direction, open = openWidth(side);
    const projected = distance + outward * PROJECTION;
    const flung = distance > open && outward > FLICK && projected > threshold(side);
    // A flick back toward home cancels an armed full swipe.
    if (canCommit(side) && ((armed.current && outward > -FLICK) || flung)) { commit(side, outermost(side), velocity); return; }
    settle(projected > open / 2 ? direction * open : 0, velocity);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    swallowClick.current = false;
    if (leaving.current || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    // Catch the row mid-flight: the next move retargets from wherever it is now.
    travel.current?.stop();
    drag.current = { pointer: event.pointerId, type: event.pointerType, startX: event.clientX, startY: event.clientY, origin: x.get(), locked: null, samples: [[event.timeStamp, event.clientX]] };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId || current.locked === "y") return;
    if (!current.locked) {
      const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
      if (Math.hypot(dx, dy) < SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) { current.locked = "y"; return; }
      // Measure from here, so crossing the slop never jumps the row.
      current.locked = "x";
      current.startX = event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
      if (rowRef.current) rowRef.current.dataset.dragging = "";
      setOpenId(id);
    }
    const value = constrain(current.origin + event.clientX - current.startX);
    x.set(value);
    current.samples.push([event.timeStamp, event.clientX]);
    if (current.samples.length > 12) current.samples.shift();
    arm(value, current.type);
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    if (current.locked === "x") {
      swallowClick.current = true;
      if (rowRef.current) delete rowRef.current.dataset.dragging;
      current.samples.push([event.timeStamp, event.clientX]);
      release(event.type === "pointercancel" ? 0 : velocityOf(current.samples));
      return;
    }
    // A tap on an open row closes it instead of acting on what is underneath.
    if (current.locked === null && Math.abs(x.get()) > .5) { swallowClick.current = true; settle(0); }
  }

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function moveFocusToNeighbour() {
    const row = rowRef.current;
    if (!row) return;
    const staying = (step: "nextElementSibling" | "previousElementSibling") => {
      let node = row[step];
      while (node instanceof HTMLElement && "removing" in node.dataset) node = node[step];
      return node;
    };
    const neighbour = staying("nextElementSibling") ?? staying("previousElementSibling");
    (neighbour?.querySelector<HTMLElement>("[data-swipe-more]") ?? row.parentElement)?.focus({ preventScroll: true });
  }

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    rows.set(id, row);
    width.current = row.offsetWidth;
    const observer = new ResizeObserver(([entry]) => { if (entry) width.current = entry.contentRect.width; });
    observer.observe(row);
    return () => { observer.disconnect(); rows.delete(id); window.clearTimeout(restoreTimer.current); setOpenId(current => current === id ? null : current); };
  }, [id, rows, setOpenId]);

  // Another row opened, or someone touched outside: put this one away.
  const closeForOthers = useEffectEvent(() => { if (openId !== id && !leaving.current && drag.current?.locked !== "x" && x.get() !== 0) settle(0); });
  useEffect(() => { closeForOthers(); }, [openId]);

  // Undo brought the item back while it was still leaving: slide it home as the height reopens.
  const returnHome = useEffectEvent(() => {
    if (!leaving.current) return;
    leaving.current = false;
    window.clearTimeout(restoreTimer.current);
    if (rowRef.current) delete rowRef.current.dataset.removing;
    settle(0);
  });
  useEffect(() => { if (present) returnHome(); }, [present]);

  const menuItems = [...leading.map((action, index) => ({ action, side: "leading" as const, index })), ...trailing.map((action, index) => ({ action, side: "trailing" as const, index }))];
  const collapse = reduced
    ? { opacity: 0, transition: { duration: .15 } }
    : { height: 0, opacity: 0, transition: { height: { ...motionTokens.spring.smooth, delay: .12 }, opacity: { duration: motionTokens.duration.instant, delay: .34 } } };

  return <motion.li ref={rowRef} className={[styles.row, className].filter(Boolean).join(" ")} style={{ "--swipe-action-width": `${ACTION}px` } as CSSProperties}
    initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={collapse}
    transition={reduced ? { duration: .15 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } }}>
    {(["leading", "trailing"] as const).map(side => actionsOf(side).map((action, index) => {
      const count = actionsOf(side).length;
      const rank = side === "leading" ? count - 1 - index : index;
      const coverRank = covering?.side === side ? (side === "leading" ? count - 1 - covering.index : covering.index) : null;
      return <ActionLayer key={`${side}-${index}`} action={action} side={side} rank={rank} count={count} coverRank={coverRank} x={x} cover={cover} onPress={() => commit(side, index)} />;
    }))}
    <motion.div className={styles.content} style={{ x }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onClickCapture={onClickCapture}>
      <div className={styles.body}>{children}</div>
      {menuItems.length > 0 && <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        {/* Opens on click rather than on press, so a swipe that starts on the button still moves the row. */}
        <Menu.Trigger className={styles.more} data-swipe-more="" aria-label={`More actions for ${label}`} onPointerDown={event => event.preventDefault()} onClick={event => { if (event.detail > 0) setMenuOpen(open => !open); }}>
          <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className={styles.menu} align="end" sideOffset={6} collisionPadding={12} loop onCloseAutoFocus={event => { if (!focusNeighbour.current) return; focusNeighbour.current = false; event.preventDefault(); moveFocusToNeighbour(); }}>
            {menuItems.map(({ action, side, index }, order) => <Menu.Item key={`${side}-${index}`} className={styles.item} data-tone={action.tone} style={{ "--i": order } as CSSProperties} onSelect={() => { focusNeighbour.current = !action.keepRow; commit(side, index); }}>
              <span className={styles.itemIcon} aria-hidden="true">{action.icon}</span>{action.label}
            </Menu.Item>)}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>}
    </motion.div>
  </motion.li>;
}

type LayerProps = { action: SwipeAction; side: Side; rank: number; count: number; coverRank: number | null; x: MotionValue<number>; cover: MotionValue<number>; onPress: () => void };

/**
 * One revealed action. Rank 0 sits against the content and the highest rank at the row's outer edge. Every layer spans the full row and slides in by
 * transform only, so the actions share the revealed space evenly, widen together past the resting width, and the covering action can stretch across the row.
 */
function ActionLayer({ action, side, rank, count, coverRank, x, cover, onPress }: LayerProps) {
  const direction = side === "leading" ? 1 : -1;
  const segment = useTransform(x, value => Math.max(0, value * direction) / count);
  // Distance from the row's outer edge to this layer's inner edge.
  const inset = useTransform([x, cover], ([value = 0, progress = 0]: number[]) => {
    const revealed = Math.max(0, value * direction), base = (count - rank) * revealed / count;
    if (coverRank === rank) return base + progress * (revealed - base);
    if (coverRank !== null && rank > coverRank) return base * (1 - progress);
    return base;
  });
  const shift = useTransform(inset, value => direction * value);
  // The glyph rides the centre of its share, then hugs the content edge while this action covers the row.
  const glyphX = useTransform([segment, cover], ([share = 0, progress = 0]: number[]) => -direction * (coverRank === rank ? share / 2 + progress * (ACTION / 2 - share / 2) : share / 2));
  const iconReveal = useTransform([segment, cover], ([share = 0, progress = 0]: number[]) => {
    const own = clamp01((share - ACTION * .25) / (ACTION * .55));
    if (coverRank === rank) return Math.max(own, progress);
    return coverRank === null ? own : own * (1 - progress);
  });
  const labelReveal = useTransform([segment, cover], ([share = 0, progress = 0]: number[]) => {
    const own = clamp01((share - ACTION * .72) / (ACTION * .24));
    if (coverRank === rank) return Math.max(own, progress);
    return coverRank === null ? own : own * (1 - progress);
  });
  const iconScale = useTransform(iconReveal, value => .6 + .4 * value);
  // The menu button is the accessible path, so the revealed copy stays out of the tab order and the accessibility tree.
  return <motion.button type="button" tabIndex={-1} aria-hidden="true" className={styles.layer} data-side={side} data-tone={action.tone ?? "neutral"} style={{ x: shift, zIndex: rank + 1 }} onClick={onPress}>
    <motion.span className={styles.anchor} style={{ x: glyphX }}>
      <span className={styles.glyph}>
        <motion.span className={styles.icon} style={{ opacity: iconReveal, scale: iconScale }}>{action.icon}</motion.span>
        <motion.span className={styles.label} style={{ opacity: labelReveal }}>{action.label}</motion.span>
      </span>
    </motion.span>
  </motion.button>;
}

export default SwipeActions;
