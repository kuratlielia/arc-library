"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { AnimatePresence, animate, motion, useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./treemap.module.css";

export interface TreemapNode {
  /** Stable identity, unique in the tree. A tile that survives a data change morphs to its new size. */
  id: string;
  label: string;
  /** Leaf size. A branch's size is the sum of its children. */
  value?: number;
  /** Optional second measure for shading, such as growth. A branch uses the size weighted mean of its children. */
  color?: number;
  children?: TreemapNode[];
}

/** Use a treemap for a hierarchy of parts, such as revenue by region, country, and plan, when sizes matter more than exact comparisons. */
export interface TreemapProps {
  /** The root. Its label names the whole in the first breadcrumb. */
  data: TreemapNode;
  /** What the whole is, such as "Revenue". Names the chart for assistive technology. */
  label: string;
  formatValue?: (value: number) => string;
  /** Names the shading measure in the tooltip and scale, such as "Growth". Tiles take the hue of their top level branch and grow deeper with the measure. Leave it out to draw every tile at one depth. */
  colorLabel?: string;
  formatColor?: (value: number) => string;
  /** Range of the color measure. Defaults to the range of the leaves. */
  colorDomain?: [number, number];
  /** Controlled id of the node that fills the view. */
  focus?: string;
  defaultFocus?: string;
  onFocusChange?: (id: string) => void;
  /** Height of the tiles in pixels. */
  height?: number;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
}

type Rect = { x: number; y: number; w: number; h: number };
type Flat = { id: string; label: string; value: number; color: number | null; depth: number; parent: string | null; children: string[]; path: string[] };
type Drawn = Rect & { o: number };

const { spring, ease, blur, duration } = motionTokens;
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .0005) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const zoom = physical({ visualDuration: .62, bounce: .06 });
const reveal = physical({ visualDuration: .9, bounce: 0 });
const glide = physical(spring.snappy, .01);
const follow = { stiffness: glide.stiffness, damping: glide.damping, restDelta: .01 };
/** Top level branches take the four series hues in order; a fifth and beyond stay neutral rather than reuse a hue. */
const hueOf = (index: number) => index < 0 ? "var(--series-1)" : index < 4 ? `var(--series-${index + 1})` : "var(--foreground)";
const GAP = 2, PAD = 3, HEADER = 22, TIP = 14, STEPS = 5;
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const inset = (r: Rect, top: number, side: number): Rect => ({ x: r.x + side, y: r.y + top, w: Math.max(0, r.w - side * 2), h: Math.max(0, r.h - top - side) });

function flatten(root: TreemapNode) {
  const flat = new Map<string, Flat>();
  const visit = (node: TreemapNode, depth: number, parent: string | null, path: string[]): { value: number; weighted: number; colored: number } => {
    const kids = node.children ?? [];
    let value = 0, weighted = 0, colored = 0;
    if (kids.length) for (const kid of kids) { const r = visit(kid, depth + 1, node.id, depth === 0 ? [] : [...path, node.label]); value += r.value; weighted += r.weighted; colored += r.colored; }
    else { value = Math.max(0, node.value ?? 0); if (node.color !== undefined && Number.isFinite(node.color)) { weighted = node.color * value; colored = value; } }
    flat.set(node.id, { id: node.id, label: node.label, value, color: colored ? weighted / colored : null, depth, parent, children: kids.map(kid => kid.id), path: depth === 0 ? [node.label] : [...path, node.label] });
    return { value, weighted, colored };
  };
  visit(root, 0, null, []);
  return flat;
}

/** Squarified layout: rows of tiles along the short side, each row closed when adding a tile would make the worst aspect ratio worse. */
function squarify(items: { id: string; value: number }[], rect: Rect, out: Map<string, Rect>) {
  const list = items.filter(item => item.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((sum, item) => sum + item.value, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) { for (const item of items) out.set(item.id, { x: rect.x, y: rect.y, w: 0, h: 0 }); return; }
  const scale = (rect.w * rect.h) / total;
  let { x, y, w, h } = rect, i = 0;
  const worst = (row: number[], side: number) => { const sum = row.reduce((a, b) => a + b, 0), max = Math.max(...row), min = Math.min(...row); return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min)); };
  while (i < list.length) {
    const side = Math.min(w, h), row: number[] = [list[i]!.value * scale];
    let j = i + 1;
    while (j < list.length) { const next = [...row, list[j]!.value * scale]; if (worst(next, side) > worst(row, side)) break; row.push(list[j]!.value * scale); j++; }
    const sum = row.reduce((a, b) => a + b, 0);
    if (w >= h) { const cw = sum / h; let cy = y; for (let k = i; k < j; k++) { const th = (list[k]!.value * scale) / cw; out.set(list[k]!.id, { x, y: cy, w: cw, h: th }); cy += th; } x += cw; w -= cw; }
    else { const rh = sum / w; let cx = x; for (let k = i; k < j; k++) { const tw = (list[k]!.value * scale) / rh; out.set(list[k]!.id, { x: cx, y, w: tw, h: rh }); cx += tw; } y += rh; h -= rh; }
    i = j;
  }
  for (const item of items) if (!out.has(item.id)) out.set(item.id, { x: rect.x, y: rect.y, w: 0, h: 0 });
}

/** Rects of every descendant when `focus` fills the view: its children fill the view, and each branch holds its own children under a header. */
function layoutFrom(flat: Map<string, Flat>, focus: string, view: Rect) {
  const out = new Map<string, Rect>();
  const nest = (id: string, rect: Rect, top: boolean) => {
    const node = flat.get(id)!;
    if (!node.children.length) return;
    const room = top ? rect : inset(rect, rect.h > 48 && rect.w > 64 ? HEADER : PAD, PAD);
    const placed = new Map<string, Rect>();
    squarify(node.children.map(child => ({ id: child, value: flat.get(child)!.value })), room, placed);
    for (const [child, r] of placed) { const gapped = { x: r.x + GAP / 2, y: r.y + GAP / 2, w: Math.max(0, r.w - GAP), h: Math.max(0, r.h - GAP) }; out.set(child, gapped); nest(child, gapped, false); }
  };
  nest(focus, view, true);
  return out;
}
/** The affine map that carries rect `from` onto rect `to`, applied to `r`. */
const carry = (r: Rect, from: Rect, to: Rect): Rect => { const sx = to.w / (from.w || 1), sy = to.h / (from.h || 1); return { x: to.x + (r.x - from.x) * sx, y: to.y + (r.y - from.y) * sy, w: r.w * sx, h: r.h * sy }; };

const subscribeNothing = () => () => {};
function useReducedMotionSafe() {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

export function Treemap({ data, label, formatValue = value => grouped.format(value), colorLabel, formatColor = value => grouped.format(value), colorDomain, focus, defaultFocus, onFocusChange, height = 420, emptyLabel = "No data yet", ref, className }: TreemapProps) {
  const reduced = useReducedMotionSafe();
  const figure = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLDivElement>());
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const inView = useInView(figure, { once: true, amount: .25 });

  const signature = JSON.stringify(data);
  const flat = useMemo(() => flatten(data), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const root = flat.get(data.id)!;
  const nodes = useMemo(() => [...flat.values()].filter(node => node.depth > 0), [flat]);
  const [ownFocus, setOwnFocus] = useState(defaultFocus ?? data.id);
  const wanted = flat.get(focus ?? ownFocus);
  const center = wanted && wanted.children.length ? wanted : root;
  const zoomTo = (id: string) => { if (focus === undefined) setOwnFocus(id); onFocusChange?.(id); };
  const [active, setActive] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);
  const view = useMemo<Rect>(() => ({ x: 0, y: 0, w: width, h: height }), [width, height]);
  const target = useMemo(() => layoutFrom(flat, center.id, view), [flat, center.id, view]);
  const levelOf = (node: Flat) => node.depth - center.depth;

  // Color scale: a few neutral steps from light to dark, so shade reads as more without adding a hue.
  const leaves = nodes.filter(node => !node.children.length && node.color !== null);
  const [lo, hi] = colorDomain ?? (leaves.length ? [Math.min(...leaves.map(node => node.color!)), Math.max(...leaves.map(node => node.color!))] : [0, 1]);
  const colored = colorLabel !== undefined && leaves.length > 0;
  const shade = (value: number | null) => { if (!colored || value === null) return 34; const t = clamp((value - lo) / (hi - lo || 1), 0, 1); return Math.round(14 + Math.round(t * (STEPS - 1)) / (STEPS - 1) * 44); };
  const branchOf = useMemo(() => { const map = new Map<string, number>(); root.children.forEach((id, index) => { const walk = (at: string) => { map.set(at, index); flat.get(at)?.children.forEach(walk); }; walk(id); }); return map; }, [flat, root]);

  // Every tile keeps its on screen rect; a spring carries it to the new layout. Tiles entering or leaving ride the same zoom as the tile they belong to.
  const drawn = useRef(new Map<string, Drawn>());
  const levels = useRef(new Map<string, number>());
  const lastFocus = useRef<{ id: string; layout: Map<string, Rect> } | null>(null);
  const paint = () => {
    for (const node of nodes) {
      const el = tiles.current.get(node.id), d = drawn.current.get(node.id);
      if (!el) continue;
      if (!d || d.o < .01 || d.w < .5 || d.h < .5) { el.style.visibility = "hidden"; el.style.pointerEvents = "none"; continue; }
      el.style.visibility = "visible";
      el.style.transform = `translate3d(${d.x.toFixed(2)}px, ${d.y.toFixed(2)}px, 0)`;
      el.style.width = `${d.w.toFixed(2)}px`; el.style.height = `${d.h.toFixed(2)}px`;
      el.style.opacity = d.o.toFixed(3);
      el.style.pointerEvents = d.o > .6 ? "auto" : "none";
      const level = levels.current.get(node.id) ?? 0;
      el.dataset.level = String(level);
      el.dataset.room = d.w > 64 && d.h > 38 ? (d.h > 54 ? "full" : "name") : "none";
    }
  };
  const paintRef = useRef(paint);
  useLayoutEffect(() => { paintRef.current = paint; });

  const shown = (inView || reduced) && width > 0;
  useEffect(() => {
    if (!shown) return;
    const prev = lastFocus.current;
    const isUnder = (id: string, ancestor: string) => { for (let at: Flat | undefined = flat.get(id); at; at = at.parent ? flat.get(at.parent) : undefined) if (at.id === ancestor) return true; return false; };
    const visible = (node: Flat) => { const l = node.depth - center.depth; return l >= 1 && l <= 2 && isUnder(node.id, center.id); };
    const nextVisible = new Set(nodes.filter(visible).map(node => node.id));
    const before = new Map(drawn.current);
    const wasVisible = new Set([...before].filter(([, d]) => d.o > .5).map(([id]) => id));
    // The pivot: the tile that grows to fill the view, or the view that shrinks back into its tile.
    let toOld: ((r: Rect) => Rect) | null = null, toNew: ((r: Rect) => Rect) | null = null;
    if (prev && prev.id !== center.id && before.size) {
      if (isUnder(center.id, prev.id)) { const inOld = prev.layout.get(center.id); if (inOld) { toOld = r => carry(r, view, inOld); toNew = r => carry(r, inOld, view); } }
      else if (isUnder(prev.id, center.id)) { const inNew = target.get(prev.id); if (inNew) { toOld = r => carry(r, inNew, view); toNew = r => carry(r, view, inNew); } }
    }
    const from = new Map<string, Drawn>(), to = new Map<string, Drawn>();
    const first = !before.size;
    for (const node of nodes) {
      const goal = target.get(node.id), now = before.get(node.id);
      const inNext = nextVisible.has(node.id), inPrev = wasVisible.has(node.id);
      if (inNext && goal) {
        to.set(node.id, { ...goal, o: 1 });
        if (inPrev && now) from.set(node.id, now);
        else if (first) from.set(node.id, { x: goal.x + goal.w / 2, y: goal.y + goal.h / 2, w: 0, h: 0, o: 0 });
        else from.set(node.id, { ...(toOld ? toOld(goal) : goal), o: 0 });
        levels.current.set(node.id, levelOf(node));
      } else if (inPrev && now) {
        from.set(node.id, now);
        to.set(node.id, { ...(toNew ? toNew(now) : now), o: 0 });
      }
    }
    for (const node of nodes) if (!from.has(node.id)) drawn.current.set(node.id, { x: 0, y: 0, w: 0, h: 0, o: 0 });
    lastFocus.current = { id: center.id, layout: target };
    const finish = () => { for (const [id, d] of to) drawn.current.set(id, d); paintRef.current(); };
    if (reduced) { finish(); return; }
    const controls = animate(0, 1, { ...(first ? reveal : zoom), onUpdate: t => {
      for (const [id, a] of from) {
        const b = to.get(id)!;
        // On the first reveal, tiles grow in a quick wave from the largest.
        const local = first ? clamp((t - Math.min(.3, (1 - b.w * b.h / (view.w * view.h || 1)) * .3)) / .7, 0, 1) : t;
        drawn.current.set(id, { x: mix(a.x, b.x, local), y: mix(a.y, b.y, local), w: mix(a.w, b.w, local), h: mix(a.h, b.h, local), o: mix(a.o, b.o, local) });
      }
      paintRef.current();
    }, onComplete: finish });
    return () => controls.stop();
  }, [shown, target, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { paintRef.current(); });

  const activeNode = active ? flat.get(active) ?? null : null;
  const parentOf = (node: Flat) => node.parent ? flat.get(node.parent)! : node;
  const share = (node: Flat, of: Flat) => of.value ? node.value / of.value : 0;

  // Tooltip: trails the pointer, or sits by the tile in focus, and stays inside the chart.
  const tipX = useMotionValue(0), tipY = useMotionValue(0);
  const tipSpringX = useSpring(tipX, follow), tipSpringY = useSpring(tipY, follow);
  const wasOn = useRef(false);
  useLayoutEffect(() => {
    const bubble = tip.current;
    if (!bubble || !activeNode || !width) { wasOn.current = false; return; }
    const r = target.get(activeNode.id);
    const ax = pointer?.x ?? (r ? r.x + r.w / 2 : 0), ay = pointer?.y ?? (r ? r.y + Math.min(r.h / 2, 28) : 0);
    const tw = bubble.offsetWidth, th = bubble.offsetHeight;
    let left = ax + TIP;
    if (left + tw > width) left = ax - TIP - tw;
    let top = ay + TIP;
    if (top + th > height) top = ay - TIP - th;
    tipX.set(clamp(left, 0, Math.max(0, width - tw))); tipY.set(clamp(top, 0, Math.max(0, height - th)));
    if (!wasOn.current || reduced) { tipSpringX.jump(tipX.get()); tipSpringY.jump(tipY.get()); }
    wasOn.current = true;
  });

  // Keyboard: arrows hop to the nearest tile in that direction on the top level, Enter zooms in, Escape zooms out.
  const topTiles = center.children.map(id => flat.get(id)!).filter(node => node.value > 0);
  const topOf = (node: Flat | null) => { let at = node; while (at && at.parent && at.parent !== center.id) at = flat.get(at.parent) ?? null; return at && at.parent === center.id ? at : null; };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = topOf(activeNode);
    const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    if (event.key in dirs) {
      event.preventDefault(); setPointer(null);
      if (!current) { setActive(topTiles[0]?.id ?? null); return; }
      const [dx, dy] = dirs[event.key]!, o = target.get(current.id)!, ox = o.x + o.w / 2, oy = o.y + o.h / 2;
      let best: Flat | null = null, score = Infinity;
      for (const node of topTiles) { if (node.id === current.id) continue; const r = target.get(node.id); if (!r) continue; const vx = r.x + r.w / 2 - ox, vy = r.y + r.h / 2 - oy, along = vx * dx + vy * dy, across = Math.abs(vx * dy - vy * dx); if (along <= 1) continue; const s = along + across * 1.5; if (s < score) { score = s; best = node; } }
      if (best) setActive(best.id);
    } else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setPointer(null); setActive((event.key === "Home" ? topTiles[0] : topTiles[topTiles.length - 1])?.id ?? null); }
    else if (event.key === "Enter" || event.key === " ") { if (current?.children.length) { event.preventDefault(); zoomTo(current.id); setActive(current.children[0]!); } }
    else if (event.key === "Escape" || event.key === "Backspace") { if (center.parent) { event.preventDefault(); zoomTo(center.parent); setActive(center.id); } else if (active) { event.preventDefault(); setActive(null); } }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>, id: string) => {
    if (event.pointerType !== "mouse") return;
    const rect = stage.current?.getBoundingClientRect();
    if (rect) setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    setActive(id);
  };
  const onTileClick = (node: Flat) => { const top = topOf(node); if (top?.children.length) zoomTo(top.id); else if (!activeNode || activeNode.id !== node.id) setActive(node.id); };

  const trail: Flat[] = [];
  for (let at: Flat | undefined = center; at; at = at.parent ? flat.get(at.parent) : undefined) trail.unshift(at);
  const empty = !root.value;
  const describe = (node: Flat) => `${node.path.join(", ")}, ${formatValue(node.value)}, ${percent.format(share(node, parentOf(node)))} of ${parentOf(node).label}${colored && node.color !== null ? `, ${colorLabel} ${formatColor(node.color)}` : ""}`;
  const focusTop = topOf(activeNode);

  return <figure ref={figure} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label}>
    <div className={styles.bar}>
      <nav className={styles.crumbs} aria-label={`${label} path`}>
        <ol className={styles.crumbList}>
          <AnimatePresence initial={false} mode="popLayout">
            {trail.map((node, index) => <motion.li key={node.id} className={styles.crumb} layout={reduced ? false : "position"} initial={{ opacity: 0, x: reduced ? 0 : -6, filter: reduced ? "none" : `blur(${blur.subtle}px)` }} animate={{ opacity: 1, x: 0, filter: "blur(0px)" }} exit={{ opacity: 0, x: reduced ? 0 : -6, transition: { duration: duration.instant, ease: [...ease.exit] } }} transition={{ ...spring.smooth }}>
              {index > 0 && <span className={styles.crumbSep} aria-hidden="true">/</span>}
              {index < trail.length - 1 ? <button type="button" className={styles.crumbButton} onClick={() => { zoomTo(node.id); setActive(null); }}>{node.label}</button> : <span className={styles.crumbCurrent} aria-current="location">{node.label}</span>}
            </motion.li>)}
          </AnimatePresence>
        </ol>
      </nav>
      <p className={styles.total}><AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={formatValue(center.value)} className={styles.totalValue} initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -6 }} transition={{ duration: duration.standard, ease: [...ease.enter] }}>{formatValue(center.value)}</motion.span>
      </AnimatePresence></p>
    </div>
    <div ref={stage} className={styles.stage} style={{ height }} data-active={activeNode ? true : undefined} role="group" tabIndex={empty ? -1 : 0} aria-roledescription="treemap"
      aria-label={`${label}, ${center.label}. Arrow keys move between tiles, Enter zooms in, Escape zooms out.`}
      onKeyDown={onKeyDown} onBlur={() => setActive(null)} onPointerLeave={() => { setActive(null); setPointer(null); }}>
      {nodes.map(node => { const top = topOf(node); return <div key={node.id} ref={element => { if (element) tiles.current.set(node.id, element); else tiles.current.delete(node.id); }} className={styles.tile}
        data-branch={node.children.length > 0 || undefined} data-active={active === node.id || undefined} data-lineage={focusTop?.id === node.id && active !== node.id || undefined} data-dim={focusTop !== null && top !== null && focusTop.id !== top.id || undefined}
        style={{ "--hue": hueOf(branchOf.get(node.id) ?? -1), "--fill": `color-mix(in oklab, ${hueOf(branchOf.get(node.id) ?? -1)} ${shade(node.color)}%, var(--surface))`, zIndex: node.depth } as CSSProperties}
        onPointerMove={event => { event.stopPropagation(); onPointerMove(event, node.id); }} onClick={event => { event.stopPropagation(); onTileClick(node); }}>
        <span className={styles.tileLabel}>{node.label}</span>
        <span className={styles.tileValue}>{formatValue(node.value)}</span>
      </div>; })}
      {empty && <p className={styles.message}>{emptyLabel}</p>}
      <motion.div ref={tip} className={styles.tooltip} style={{ x: reduced ? tipX : tipSpringX, y: reduced ? tipY : tipSpringY }} aria-hidden="true">
        {activeNode && <>
          <p className={styles.tipTitle}>{activeNode.path.slice(0, -1).join(" / ") || root.label}</p>
          <p className={styles.tipValue}><span className={styles.tipName}>{activeNode.label}</span><span className={styles.tipAmount}>{formatValue(activeNode.value)}</span></p>
          <p className={styles.tipNote}>{percent.format(share(activeNode, parentOf(activeNode)))} of {parentOf(activeNode).label}</p>
          {colored && activeNode.color !== null && <p className={styles.tipNote}>{colorLabel} {formatColor(activeNode.color)}</p>}
        </>}
      </motion.div>
    </div>
    {colored && <div className={styles.scale} aria-hidden="true">
      <span className={styles.scaleLabel}>{colorLabel}</span>
      <span className={styles.scaleEnd}>{formatColor(lo)}</span>
      <span className={styles.steps}>{Array.from({ length: STEPS }, (_, i) => <span key={i} className={styles.step} style={{ "--fill": `color-mix(in oklab, ${center.depth === 0 ? "var(--foreground)" : hueOf(branchOf.get(center.id) ?? -1)} ${Math.round(14 + (i / (STEPS - 1)) * 44)}%, var(--surface))` } as CSSProperties} />)}</span>
      <span className={styles.scaleEnd}>{formatColor(hi)}</span>
    </div>}
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{activeNode ? describe(activeNode) : `${center.label}, ${formatValue(center.value)}`}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Path</th><th scope="col">Value</th><th scope="col">Share of parent</th>{colored && <th scope="col">{colorLabel}</th>}</tr></thead>
      <tbody>{nodes.map(node => <tr key={node.id}><th scope="row">{node.path.join(" / ")}</th><td>{formatValue(node.value)}</td><td>{percent.format(share(node, parentOf(node)))}</td>{colored && <td>{node.color === null ? "" : formatColor(node.color)}</td>}</tr>)}</tbody>
    </table></div>}
  </figure>;
}

export default Treemap;
