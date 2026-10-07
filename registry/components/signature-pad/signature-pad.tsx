"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { Check, Download, Eraser, Play, Redo2, Square, Undo2, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./signature-pad.module.css";

/** A sampled point: position in pad units, pen pressure between 0 and 1 (or -1 when the device has none), and ms since the stroke began. */
export interface InkPoint { x: number; y: number; p: number; t: number }
export type InkColor = "black" | "blue" | "violet";
export type InkWidth = "fine" | "medium" | "bold";
export interface InkStroke {
  id: string;
  points: InkPoint[];
  color: InkColor;
  width: InkWidth;
  /** When the stroke began, in ms. Replay keeps the real rhythm between strokes. */
  at: number;
}

export interface OutlineOptions {
  /** Diameter of the stroke at half pressure, in pad units. */
  size: number;
  /** How much pressure changes the width, from 0 to 1. */
  thinning?: number;
  /** How far each point trails the pointer, from 0 to 1. Higher is smoother but lags more. */
  streamline?: number;
  /** Derive pressure from speed when the device reports none: fast is thin, slow is full. */
  simulatePressure?: boolean;
  /** Length over which the start and the end taper, in pad units. */
  taperStart?: number;
  taperEnd?: number;
  /** False while the stroke is still being drawn, so the end does not taper yet. */
  last?: boolean;
}

/** Pad coordinates. Strokes are stored in this space and scale with the pad. */
export const PAD_WIDTH = 600, PAD_HEIGHT = 260;

const INK: Record<InkColor, { label: string; export: string }> = {
  black: { label: "Black ink", export: "#17171a" },
  blue: { label: "Blue ink", export: "#1d3fae" },
  violet: { label: "Violet ink", export: "#5b35c8" },
};
const WIDTHS: Record<InkWidth, { label: string; size: number }> = {
  fine: { label: "Fine", size: 3.4 },
  medium: { label: "Medium", size: 5.6 },
  bold: { label: "Bold", size: 8.4 },
};
const COLORS = Object.keys(INK) as InkColor[];
const SIZES = Object.keys(WIDTHS) as InkWidth[];

type Vec = [number, number];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Vec, n: number): Vec => [a[0] * n, a[1] * n];
const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (a: Vec): Vec => { const l = Math.hypot(a[0], a[1]); return l ? [a[0] / l, a[1] / l] : [0, 0]; };
const perp = (a: Vec): Vec => [a[1], -a[0]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
const rotAround = (p: Vec, c: Vec, r: number): Vec => {
  const s = Math.sin(r), co = Math.cos(r), px = p[0] - c[0], py = p[1] - c[1];
  return [px * co - py * s + c[0], px * s + py * co + c[1]];
};
const easeOut = (t: number) => t * (2 - t);

/**
 * Turns sampled points into the outline of a variable width stroke, in the spirit of perfect-freehand. Points are streamlined
 * toward the pointer, width follows pen pressure or, for a mouse or finger, speed, the ends taper, sharp turns get round joins,
 * and both ends get round caps. Returns the outline polygon; pass it to `outlineToPath` for SVG.
 */
export function getStrokeOutline(input: InkPoint[], options: OutlineOptions): Vec[] {
  const { size, thinning = .62, streamline = .42, simulatePressure = true, taperStart = 0, taperEnd = 0, last = true } = options;
  const [head] = input;
  if (!head) return [];
  const usePen = !simulatePressure && input.some(point => point.p > 0);

  // Streamline: each point eases toward the raw input, which removes jitter without a smoothing pass.
  const pts: { at: Vec; pressure: number; length: number; vector: Vec }[] = [];
  let prev: Vec = [head.x, head.y], length = 0;
  const start = { at: prev, pressure: usePen ? head.p : .5, length: 0, vector: [1, 0] as Vec };
  pts.push(start);
  for (let i = 1; i < input.length; i++) {
    const sample = input[i]!;
    const raw: Vec = [sample.x, sample.y];
    const at = i === input.length - 1 && last ? raw : lerp(prev, raw, 1 - streamline);
    const d = dist(at, prev);
    if (d < .4) continue;
    length += d;
    pts.push({ at, pressure: usePen ? sample.p : .5, length, vector: norm(sub(prev, at)) });
    prev = at;
  }
  const second = pts[1];
  if (second) start.vector = second.vector;
  const total = length;

  // A dot: a round mark sized by the first pressure.
  if (pts.length === 1) {
    const r = Math.max(.6, size * (.5 - thinning * (.5 - start.pressure)) * .9);
    return Array.from({ length: 18 }, (_, i) => add(start.at, mul([Math.cos(i / 18 * Math.PI * 2), Math.sin(i / 18 * Math.PI * 2)], r)));
  }

  const left: Vec[] = [], right: Vec[] = [];
  let pressure = start.pressure, prevVector = start.vector;
  const radii: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const point = pts[i]!;
    if (!usePen) {
      // Speed thins the line: a long step between samples reads as a fast stroke.
      const step = i === 0 ? 0 : dist(point.at, pts[i - 1]!.at);
      const speed = Math.min(1, step / size);
      const target = Math.min(1, 1 - speed);
      pressure = Math.min(1, pressure + (target - pressure) * speed * .3);
    } else {
      pressure = point.pressure;
    }
    let radius = Math.max(.25, size * (.5 - thinning * (.5 - pressure)));
    const ts = taperStart ? easeOut(Math.min(1, point.length / taperStart)) : 1;
    const te = taperEnd && last ? easeOut(Math.min(1, (total - point.length) / taperEnd)) : 1;
    radius = Math.max(.12 * size, radius * Math.min(ts, te));
    radii.push(radius);

    const next = pts[i + 1]?.vector ?? point.vector;
    const offset = mul(perp(lerp(next, point.vector, .5)), radius);
    // A sharp turn: sweep round the corner so the outline does not pinch.
    if (i > 0 && i < pts.length - 1 && dot(point.vector, next) < -.2) {
      const corner = mul(perp(prevVector), radius);
      for (let t = 0; t <= 1; t += 1 / 12) {
        left.push(rotAround(sub(point.at, corner), point.at, Math.PI * t));
        right.push(rotAround(add(point.at, corner), point.at, -Math.PI * t));
      }
    } else {
      left.push(sub(point.at, offset));
      right.push(add(point.at, offset));
    }
    prevVector = point.vector;
  }

  // Round caps: half circles swept around the first and last points, on the side facing away from the stroke.
  const cap = (center: Vec, from: Vec, to: Vec, away: Vec) => {
    const out: Vec[] = [];
    const r = dist(center, from), start = Math.atan2(from[1] - center[1], from[0] - center[0]);
    const mid = start + Math.PI / 2;
    const sign = dot([Math.cos(mid), Math.sin(mid)], away) >= 0 ? 1 : -1;
    for (let k = 1; k < 12; k++) {
      const a = start + sign * Math.PI * k / 12;
      out.push([center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r]);
    }
    out.push(to);
    return out;
  };
  const end = pts[pts.length - 1]!;
  const endCap = cap(end.at, left[left.length - 1]!, right[right.length - 1]!, mul(end.vector, -1));
  const startCap = cap(start.at, right[0]!, left[0]!, start.vector);
  return [...left, ...endCap, ...right.reverse(), ...startCap];
}

const round = (value: number) => Math.round(value * 100) / 100;
/** Draws an outline as one smooth closed path, with quadratic curves through the midpoints of its edges. */
export function outlineToPath(points: Vec[]) {
  if (points.length < 3) return "";
  let d = `M${round(points[0]![0])} ${round(points[0]![1])} Q`;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!, [x1, y1] = points[(i + 1) % points.length]!;
    d += `${round(x0)} ${round(y0)} ${round((x0 + x1) / 2)} ${round((y0 + y1) / 2)} `;
  }
  return `${d}Z`;
}

function strokeOptions(stroke: Pick<InkStroke, "width" | "points">, last: boolean): OutlineOptions {
  const size = WIDTHS[stroke.width].size;
  const pen = stroke.points.some(point => point.p > 0);
  return { size, simulatePressure: !pen, taperStart: size * 1.5, taperEnd: pen ? 0 : size * 5, last };
}
/** The SVG path of a stroke, or of its first `upTo` ms while it is replayed. */
export function strokePath(stroke: Pick<InkStroke, "width" | "points">, upTo = Infinity) {
  const all = stroke.points;
  const done = upTo >= all[all.length - 1]!.t;
  const points = done ? all : all.filter(point => point.t <= upTo);
  return outlineToPath(getStrokeOutline(points, strokeOptions(stroke, done)));
}

/** Tight bounds of the ink, padded, for export. */
function inkBounds(strokes: InkStroke[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) for (const point of stroke.points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const pad = 16;
  return { x: Math.floor(minX - pad), y: Math.floor(minY - pad), width: Math.ceil(maxX - minX + pad * 2), height: Math.ceil(maxY - minY + pad * 2) };
}

/** A standalone SVG of the signature, cropped to the ink, with print ink colors. */
export function signatureToSvg(strokes: InkStroke[]) {
  if (!strokes.length) return "";
  const box = inkBounds(strokes);
  const paths = strokes.map(stroke => `<path d="${strokePath(stroke)}" fill="${INK[stroke.color].export}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" width="${box.width}" height="${box.height}">${paths}</svg>`;
}

/** A transparent PNG of the signature, cropped to the ink, at `scale` times pad resolution. */
export function signatureToPng(strokes: InkStroke[], scale = 3): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!strokes.length) return reject(new Error("Nothing to export"));
    const box = inkBounds(strokes);
    const canvas = document.createElement("canvas");
    canvas.width = box.width * scale; canvas.height = box.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("Canvas is unavailable"));
    ctx.scale(scale, scale);
    ctx.translate(-box.x, -box.y);
    for (const stroke of strokes) { ctx.fillStyle = INK[stroke.color].export; ctx.fill(new Path2D(strokePath(stroke))); }
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Export failed")), "image/png");
  });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A signature field with real ink. Width follows pen pressure, or speed for a mouse or finger, and the ends taper like a nib
 * lifting off. It keeps undo and redo, clears with a wipe across the pad, replays the signature in its original rhythm,
 * and exports a cropped PNG or SVG. A "Sign here" hint rests on the baseline until the first stroke.
 * Keyboard: Mod+Z undoes, Shift+Mod+Z or Mod+Y redoes, and Delete clears.
 */
export interface SignaturePadProps {
  /** Printed under the baseline, such as the signer's name. */
  signer?: string;
  /** Resting hint on the baseline before the first stroke. */
  hint?: string;
  defaultColor?: InkColor;
  defaultWidth?: InkWidth;
  /** Receives the strokes after every change. */
  onChange?: (strokes: InkStroke[]) => void;
  /** File name for exports, without extension. */
  fileName?: string;
  /** Accessible name of the drawing surface. */
  label?: string;
  className?: string;
}

/** `fresh` is the stroke just drawn: it is already on screen from the live path, so it appears without a fade. */
interface History { past: InkStroke[][]; present: InkStroke[]; future: InkStroke[][]; fresh: string | null }
type Saved = null | "png" | "svg" | "failed";

const { spring, duration, ease, blur } = motionTokens;
const subscribe = () => () => {};
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

export function SignaturePad({ signer, hint = "Sign here", defaultColor = "black", defaultWidth = "medium", onChange, fileName = "signature", label = "Signature pad", className }: SignaturePadProps) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const reduced = useReducedFlag();
  const [history, setHistory] = useState<History>({ past: [], present: [], future: [], fresh: null });
  const [color, setColor] = useState<InkColor>(defaultColor);
  const [width, setWidth] = useState<InkWidth>(defaultWidth);
  const [drawing, setDrawing] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [replay, setReplay] = useState<{ at: number; offsets: number[] } | null>(null);
  const [saved, setSaved] = useState<Saved>(null);
  const [status, setStatus] = useState("");

  const padRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const live = useRef<{ id: number; stroke: InkStroke; stamp: number } | null>(null);
  const replayFrame = useRef(0);
  const savedTimer = useRef(0);
  const wipeAnimation = useRef<{ stop: () => void; complete: () => void } | null>(null);
  const counter = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const strokes = history.present;
  const empty = strokes.length === 0;
  const replaying = replay !== null;

  useEffect(() => { onChangeRef.current?.(strokes); }, [strokes]);
  useEffect(() => () => { cancelAnimationFrame(replayFrame.current); window.clearTimeout(savedTimer.current); }, []);

  const commit = useCallback((next: InkStroke[], fresh: string | null = null) => {
    setHistory(current => ({ past: [...current.past, current.present].slice(-60), present: next, future: [], fresh }));
  }, []);

  const stopReplay = useCallback(() => { cancelAnimationFrame(replayFrame.current); setReplay(null); }, []);
  /** A wipe in flight completes at once, so whatever comes next starts from a clear pad. */
  const settleWipe = useCallback(() => { wipeAnimation.current?.complete(); }, []);

  function toPad(event: { clientX: number; clientY: number }) {
    const box = padRef.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width * PAD_WIDTH, y: (event.clientY - box.top) / box.height * PAD_HEIGHT };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (live.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    settleWipe();
    if (replaying) stopReplay();
    padRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = toPad(event);
    const now = event.nativeEvent.timeStamp;
    counter.current += 1;
    const pen = event.pointerType === "pen" && event.pressure > 0;
    live.current = { id: event.pointerId, stamp: event.nativeEvent.timeStamp, stroke: { id: `${uid}-${counter.current}`, color, width, at: now, points: [{ x, y, p: pen ? event.pressure : -1, t: 0 }] } };
    setDrawing(true);
    paintLive();
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = live.current;
    if (!current || current.id !== event.pointerId) return;
    const samples = typeof event.nativeEvent.getCoalescedEvents === "function" ? event.nativeEvent.getCoalescedEvents() : [];
    const list = samples.length ? samples : [event.nativeEvent];
    for (const sample of list) {
      const { x, y } = toPad(sample);
      const pen = sample.pointerType === "pen" && sample.pressure > 0;
      current.stroke.points.push({ x, y, p: pen ? sample.pressure : -1, t: Math.max(current.stroke.points[current.stroke.points.length - 1]!.t, sample.timeStamp - current.stamp) });
    }
    paintLive();
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = live.current;
    if (!current || current.id !== event.pointerId) return;
    live.current = null;
    commit([...strokes, current.stroke], current.stroke.id);
    liveRef.current?.setAttribute("d", "");
    setDrawing(false);
    setStatus(`Stroke added. ${strokes.length + 1} in the signature.`);
  }
  function paintLive() {
    const current = live.current;
    if (!current || !liveRef.current) return;
    liveRef.current.setAttribute("d", outlineToPath(getStrokeOutline(current.stroke.points, strokeOptions(current.stroke, false))));
  }

  function undo() {
    if (!history.past.length || live.current) return;
    settleWipe(); stopReplay();
    setHistory(current => current.past.length ? { past: current.past.slice(0, -1), present: current.past[current.past.length - 1]!, future: [current.present, ...current.future], fresh: null } : current);
    setStatus("Undone");
  }
  function redo() {
    if (!history.future.length || live.current) return;
    settleWipe(); stopReplay();
    setHistory(current => current.future.length ? { past: [...current.past, current.present], present: current.future[0]!, future: current.future.slice(1), fresh: null } : current);
    setStatus("Redone");
  }

  function clear() {
    if (empty || wiping || live.current) return;
    stopReplay();
    const node = inkRef.current;
    const finish = () => {
      wipeAnimation.current = null;
      commit([]); setWiping(false); setStatus("Signature cleared. Undo brings it back.");
      // Lift the clip only once the wiped strokes have left, so they never flash back for a frame.
      if (node) requestAnimationFrame(() => requestAnimationFrame(() => { node.style.clipPath = ""; }));
    };
    if (!node || reduced) { finish(); return; }
    setWiping(true);
    // The ink is cut away behind a squeegee edge that sweeps across the pad; the edge itself is drawn by the sweep element.
    const controls = animate(node, { clipPath: ["inset(0% 0% 0% 0%)", "inset(0% 0% 0% 100%)"] }, { duration: .56, ease: [...ease.inOut] });
    wipeAnimation.current = { stop: () => controls.stop(), complete: () => { controls.complete(); } };
    controls.then(finish);
  }

  function toggleReplay() {
    if (replaying) { stopReplay(); setStatus("Replay stopped"); return; }
    if (empty || live.current) return;
    settleWipe();
    // Build a timeline: each stroke keeps its own rhythm, and pauses between strokes are capped so the replay never stalls.
    const offsets: number[] = [];
    let cursor = 0;
    strokes.forEach((stroke, index) => {
      if (index > 0) {
        const previous = strokes[index - 1]!;
        const gap = stroke.at - (previous.at + previous.points[previous.points.length - 1]!.t);
        cursor += Math.min(260, Math.max(90, gap));
      }
      offsets.push(cursor);
      cursor += stroke.points[stroke.points.length - 1]!.t;
    });
    const speed = Math.max(1, cursor / 3200);
    const total = cursor + 120;
    const begin = performance.now();
    const tick = (now: number) => {
      const at = (now - begin) * speed;
      if (at >= total) { setReplay(null); setStatus("Replay finished"); return; }
      setReplay({ at, offsets });
      replayFrame.current = requestAnimationFrame(tick);
    };
    setReplay({ at: 0, offsets });
    setStatus("Replaying signature");
    replayFrame.current = requestAnimationFrame(tick);
  }
  async function save(kind: "png" | "svg") {
    if (empty) return;
    window.clearTimeout(savedTimer.current);
    try {
      const blob = kind === "svg" ? new Blob([signatureToSvg(strokes)], { type: "image/svg+xml" }) : await signatureToPng(strokes);
      download(blob, `${fileName}.${kind}`);
      setSaved(kind);
      setStatus(`Saved ${fileName}.${kind}`);
    } catch {
      setSaved("failed");
      setStatus("Export failed. Try again.");
    }
    savedTimer.current = window.setTimeout(() => setSaved(null), 1800);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    else if (mod && key === "y") { event.preventDefault(); redo(); }
    else if (!mod && (event.key === "Delete" || event.key === "Backspace") && event.currentTarget === event.target) { event.preventDefault(); clear(); }
    else if (event.key === "Escape" && replaying) { stopReplay(); }
  }

  // During replay each stroke shows only the part drawn so far, and the nib rides its newest point.
  let nib: InkPoint | null = null, nibColor: InkColor = color;
  const visible: { stroke: InkStroke; d: string | null }[] = [];
  for (let index = 0; index < strokes.length; index++) {
    const stroke = strokes[index]!;
    if (replay === null) { visible.push({ stroke, d: null }); continue; }
    const local = replay.at - (replay.offsets[index] ?? 0);
    const lastT = stroke.points[stroke.points.length - 1]!.t;
    if (local < 0) { visible.push({ stroke, d: "" }); continue; }
    if (local >= lastT) { visible.push({ stroke, d: null }); continue; }
    nib = stroke.points.findLast(point => point.t <= local) ?? stroke.points[0]!;
    nibColor = stroke.color;
    visible.push({ stroke, d: strokePath(stroke, local) });
  }
  const showHint = empty && !drawing && !wiping;
  const hintHidden = reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: .97, filter: `blur(${blur.soft}px)` };
  const t: Transition = reduced ? { duration: duration.instant } : spring.snappy;

  return <div className={[styles.root, className].filter(Boolean).join(" ")} data-ink={color}>
    <div ref={padRef} className={styles.pad} tabIndex={0} role="img" aria-roledescription="signature pad"
      aria-label={`${label}. ${empty ? "Empty." : `${strokes.length} ${strokes.length === 1 ? "stroke" : "strokes"}.`} Draw with a pointer, pen, or finger.`}
      aria-describedby={`${uid}-keys`} data-drawing={drawing ? "" : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
      <div className={styles.guide} aria-hidden="true">
        <X className={styles.mark} size={14} strokeWidth={1.75} />
        <span className={styles.baseline} />
        {signer && <span className={styles.signer}>{signer}</span>}
        <AnimatePresence initial={false}>
          {showHint && <motion.span key="hint" className={styles.hint} initial={hintHidden} animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ ...hintHidden, transition: { duration: duration.fast, ease: [...ease.standard] } }}
            transition={reduced ? { duration: duration.instant } : { duration: duration.standard, ease: [...ease.enter] }}>{hint}</motion.span>}
        </AnimatePresence>
      </div>
      <div ref={inkRef} className={styles.ink}>
        <svg viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <AnimatePresence initial={false}>
            {visible.map(({ stroke, d }) => <motion.path key={stroke.id} className={styles.stroke} data-color={stroke.color}
              d={d ?? strokePath(stroke)} initial={history.fresh === stroke.id ? false : { opacity: 0 }} animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: wiping ? 0 : duration.standard, ease: [...ease.standard] } }}
              transition={{ duration: duration.standard, ease: [...ease.standard] }} />)}
          </AnimatePresence>
          <path ref={liveRef} className={styles.stroke} data-color={color} />
          {nib && <circle className={styles.nib} data-color={nibColor} cx={nib.x} cy={nib.y} r={WIDTHS[width].size * .9} />}
        </svg>
      </div>
      {wiping && <motion.span className={styles.sweep} aria-hidden="true" initial={{ x: "0%", opacity: 0 }} animate={{ x: "100%", opacity: [0, 1, 1, 0] }}
        transition={{ duration: .56, ease: [...ease.inOut], opacity: { duration: .56, times: [0, .12, .85, 1] } }} />}
    </div>

    <div className={styles.toolbar}>
      <div className={styles.group}>
        <Choice label="Ink color" options={COLORS} value={color} onChange={next => { setColor(next); setStatus(`${INK[next].label} selected`); }} layoutId={`${uid}-color`} reduced={reduced}
          render={option => <span className={styles.swatch} data-color={option} />} name={option => INK[option].label} />
        <span className={styles.divider} aria-hidden="true" />
        <Choice label="Stroke width" options={SIZES} value={width} onChange={next => { setWidth(next); setStatus(`${WIDTHS[next].label} nib selected`); }} layoutId={`${uid}-width`} reduced={reduced}
          render={option => <span className={styles.weight} style={{ width: WIDTHS[option].size + 2, height: WIDTHS[option].size + 2 }} />} name={option => WIDTHS[option].label} />
      </div>
      <div className={styles.group}>
        <IconButton label="Undo" onClick={undo} disabled={!history.past.length || wiping}><Undo2 size={18} strokeWidth={1.75} aria-hidden="true" /></IconButton>
        <IconButton label="Redo" onClick={redo} disabled={!history.future.length || wiping}><Redo2 size={18} strokeWidth={1.75} aria-hidden="true" /></IconButton>
        <IconButton label={replaying ? "Stop replay" : "Replay signature"} onClick={toggleReplay} disabled={empty || wiping} pressed={replaying}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={replaying ? "stop" : "play"} className={styles.swap} initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .6 }} transition={t}>
              {replaying ? <Square size={15} strokeWidth={1.75} aria-hidden="true" /> : <Play size={17} strokeWidth={1.75} aria-hidden="true" />}
            </motion.span>
          </AnimatePresence>
        </IconButton>
        <IconButton label="Clear signature" onClick={clear} disabled={empty || wiping}><Eraser size={18} strokeWidth={1.75} aria-hidden="true" /></IconButton>
      </div>
    </div>

    <div className={styles.exports}>
      <span className={styles.exportLabel}>Save as</span>
      {(["png", "svg"] as const).map(kind => <button key={kind} type="button" className={styles.export} onClick={() => save(kind)} disabled={empty}
        aria-label={`Download ${kind.toUpperCase()}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={saved === kind ? "done" : saved === "failed" ? "failed" : "idle"} className={styles.exportContent}
            initial={{ opacity: 0, y: reduced ? 0 : 4, filter: reduced ? "blur(0px)" : `blur(${blur.subtle}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: reduced ? 0 : -4, transition: { duration: duration.instant } }} transition={reduced ? { duration: duration.instant } : { duration: duration.fast, ease: [...ease.enter] }}>
            {saved === kind ? <><Check size={15} strokeWidth={1.75} aria-hidden="true" />Saved</> : <><Download size={15} strokeWidth={1.75} aria-hidden="true" />{kind.toUpperCase()}</>}
          </motion.span>
        </AnimatePresence>
      </button>)}
    </div>
    <p id={`${uid}-keys`} className={styles.srOnly}>Press Control or Command Z to undo, add Shift to redo, and Delete to clear.</p>
    <p className={styles.srOnly} role="status" aria-live="polite">{status}</p>
  </div>;
}

function IconButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return <button type="button" className={styles.iconButton} aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={pressed}>{children}</button>;
}

/** A compact radio group with a highlight that glides to the chosen option. Arrow keys move the choice. */
function Choice<T extends string>({ label, options, value, onChange, render, name, layoutId, reduced }: {
  label: string; options: T[]; value: T; onChange: (value: T) => void; render: (option: T) => ReactNode; name: (option: T) => string; layoutId: string; reduced: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (options.indexOf(value) + step + options.length) % options.length;
    onChange(options[index]!);
    refs.current[index]?.focus();
  }
  return <div className={styles.choice} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
    {options.map((option, index) => <button key={option} ref={node => { refs.current[index] = node; }} type="button" role="radio" aria-checked={option === value}
      aria-label={name(option)} title={name(option)} tabIndex={option === value ? 0 : -1} className={styles.option} onClick={() => onChange(option)}>
      {option === value && <motion.span layoutId={layoutId} className={styles.selected} transition={reduced ? { duration: 0 } : spring.morph} />}
      {render(option)}
    </button>)}
  </div>;
}

export default SignaturePad;
