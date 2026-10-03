"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, Reorder, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { Transition } from "motion/react";
import { Check, Pipette, Plus } from "lucide-react";
import { TextMorph } from "@/registry/components/text-morph/text-morph";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./color-picker.module.css";

export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch";
export interface ColorSwatch { id: string; color: string }

/**
 * A color field whose swatch grows into a full picker. Pick saturation and brightness on the area, hue and opacity on the sliders, or type a value
 * in hex, RGB, HSL, or OKLCH; the format button morphs the text between them. The eyedropper appears where the browser supports it, saved
 * swatches can be added, applied, dragged or moved with Alt and the arrow keys, and removed with Delete. A contrast readout compares the color with
 * the background it will sit on. Arrow keys move every thumb, Shift takes bigger steps, and Escape closes the panel.
 */
export interface ColorPickerProps {
  /** Any color the picker can read: hex, rgb(), hsl(), or oklch(). */
  value?: string;
  defaultValue?: string;
  /** Receives the color as hex, with two alpha digits when it is not opaque. */
  onValueChange?: (hex: string) => void;
  /** The background the color will sit on, for the contrast readout. */
  background?: string;
  /** Name shown on the swatch, such as "Accent". */
  label?: string;
  swatches?: ColorSwatch[];
  defaultSwatches?: ColorSwatch[];
  onSwatchesChange?: (swatches: ColorSwatch[]) => void;
  /** Most saved swatches. Saving past it drops the oldest. */
  maxSwatches?: number;
  defaultFormat?: ColorFormat;
  className?: string;
}

export type Hsva = { h: number; s: number; v: number; a: number };
type Rgba = { r: number; g: number; b: number; a: number };

const { spring, duration, ease, blur } = motionTokens;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 0) => { const f = 10 ** digits; return Math.round(value * f) / f; };
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1, restDelta: .0005, restSpeed: .005 };
};
/** Thumbs chase the pointer on a quick spring with a little life, so a click lands with a soft settle and a drag trails by a hair. */
const thumbSpring = physical(.26, .22);
/** Under a finger or mouse drag the thumb stays glued to the pointer: a stiff spring with no bounce, so it never trails or wobbles. */
const dragSpring = physical(.1, 0);
const openSpring = physical(spring.morph.visualDuration, .1), closeSpring = physical(.3, 0);
const instant: Transition = { duration: 0 };

/* Color math. sRGB channels are 0 to 1. */
function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return { r: f(5), g: f(3), b: f(1), a };
}
function rgbToHsv({ r, g, b, a }: Rgba, hue = 0): Hsva {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = hue;
  if (d > 1e-6) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}
function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  const k = (n: number) => (n + h / 30) % 12, c = s * Math.min(l, 1 - l);
  const f = (n: number) => l - c * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0), g: f(8), b: f(4), a };
}
function rgbToHsl({ r, g, b }: Rgba, hue: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: d < 1e-6 ? hue : rgbToHsv({ r, g, b, a: 1 }).h, s, l };
}
const toLinear = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const fromLinear = (c: number) => c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055;
function rgbToOklch({ r, g, b }: Rgba, hue: number) {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(.4122214708 * lr + .5363325363 * lg + .0514459929 * lb);
  const m = Math.cbrt(.2119034982 * lr + .6806995451 * lg + .1073969566 * lb);
  const s = Math.cbrt(.0883024619 * lr + .2817188376 * lg + .6299787005 * lb);
  const L = .2104542553 * l + .793617785 * m - .0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
  const B = .0259040371 * l + .7827717662 * m - .808675766 * s;
  const C = Math.hypot(A, B);
  let H = Math.atan2(B, A) * 180 / Math.PI;
  if (H < 0) H += 360;
  return { l: L, c: C, h: C < .0005 ? hue : H };
}
function oklchToRgb(L: number, C: number, H: number, a: number): Rgba {
  const A = C * Math.cos(H * Math.PI / 180), B = C * Math.sin(H * Math.PI / 180);
  const l = (L + .3963377774 * A + .2158037573 * B) ** 3;
  const m = (L - .1055613458 * A - .0638541728 * B) ** 3;
  const s = (L - .0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: clamp(fromLinear(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s)),
    g: clamp(fromLinear(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s)),
    b: clamp(fromLinear(-.0041960863 * l - .7034186147 * m + 1.707614701 * s)),
    a,
  };
}
const byte = (c: number) => Math.round(clamp(c) * 255);
const hex2 = (c: number) => byte(c).toString(16).padStart(2, "0").toUpperCase();

export function toHex(hsva: Hsva) {
  const { r, g, b, a } = hsvToRgb(hsva);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < .999 ? hex2(a) : ""}`;
}
function format(hsva: Hsva, kind: ColorFormat) {
  const rgb = hsvToRgb(hsva);
  const alpha = hsva.a < .999 ? ` / ${Math.round(hsva.a * 100)}%` : "";
  if (kind === "hex") return toHex(hsva);
  if (kind === "rgb") return `rgb(${byte(rgb.r)} ${byte(rgb.g)} ${byte(rgb.b)}${alpha})`;
  if (kind === "hsl") { const { h, s, l } = rgbToHsl(rgb, hsva.h); return `hsl(${Math.round(h) % 360} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${alpha})`; }
  const { l, c, h } = rgbToOklch(rgb, hsva.h);
  return `oklch(${round(l * 100, 1)}% ${round(c, 3)} ${round(h, 1) % 360}${alpha})`;
}
const readAlpha = (text?: string) => text === undefined ? 1 : text.endsWith("%") ? clamp(parseFloat(text) / 100) : clamp(parseFloat(text));

/** Reads hex, rgb(), hsl(), and oklch() in modern or comma syntax. Returns null for anything else. */
export function parseColor(input: string, hue = 0): Hsva | null {
  const text = input.trim().toLowerCase();
  let match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (match) {
    let digits = match[1];
    if (digits.length <= 4) digits = digits.split("").map(d => d + d).join("");
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
    return rgbToHsv({ r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) : 1 }, hue);
  }
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (match) return rgbToHsv({ r: clamp(+match[1] / 255), g: clamp(+match[2] / 255), b: clamp(+match[3] / 255), a: readAlpha(match[4]) }, hue);
  match = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (match) {
    const h = +match[1] % 360;
    const next = rgbToHsv(hslToRgb(h, clamp(+match[2] / 100), clamp(+match[3] / 100), readAlpha(match[4])), h);
    return { ...next, h };
  }
  match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (match) {
    const L = match[2] ? +match[1] / 100 : +match[1];
    return rgbToHsv(oklchToRgb(clamp(L), +match[3], +match[4], readAlpha(match[5])), hue);
  }
  return null;
}

/** WCAG contrast of a color, composited over the background, against that background. */
function contrast(hsva: Hsva, background: Rgba) {
  const fg = hsvToRgb(hsva);
  const mix = (c: number, bg: number) => c * fg.a + bg * (1 - fg.a);
  const lum = (r: number, g: number, b: number) => .2126 * toLinear(r) + .7152 * toLinear(g) + .0722 * toLinear(b);
  const a = lum(mix(fg.r, background.r), mix(fg.g, background.g), mix(fg.b, background.b)), b = lum(background.r, background.g, background.b);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
const level = (ratio: number) => ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "Fails";

const formats: ColorFormat[] = ["hex", "rgb", "hsl", "oklch"];
const formatNames: Record<ColorFormat, string> = { hex: "Hex", rgb: "RGB", hsl: "HSL", oklch: "OKLCH" };

const subscribe = () => () => {};
function useHydrated() { return useSyncExternalStore(subscribe, () => true, () => false); }
function useEyeDropper() { return useSyncExternalStore(subscribe, () => "EyeDropper" in window, () => false); }
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/** Springs a motion value to a new target, or jumps under reduced motion. Retargeting keeps the current velocity. */
function useFollow(target: number, reduced: boolean, dragging = false) {
  const value = useMotionValue(target);
  useEffect(() => {
    if (reduced) { value.jump(target); return; }
    const controls = animate(value, target, dragging ? dragSpring : thumbSpring);
    return () => controls.stop();
  }, [dragging, reduced, target, value]);
  return value;
}

/** Tracks a pointer drag over an element and reports its position as fractions of the element's box. */
function usePad(onMove: (x: number, y: number) => void, onActive: (active: boolean) => void) {
  const pointer = useRef<number | null>(null);
  const read = (event: ReactPointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onMove(clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height));
  };
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0 || pointer.current !== null) return;
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      onActive(true);
      read(event);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) { if (event.pointerId === pointer.current) read(event); },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) { if (event.pointerId !== pointer.current) return; pointer.current = null; onActive(false); },
    onPointerCancel(event: ReactPointerEvent<HTMLElement>) { if (event.pointerId !== pointer.current) return; pointer.current = null; onActive(false); },
  };
}

/** Arrow keys step by a small amount, Shift by ten, Page keys by ten, Home and End to the ends. */
function stepFor(event: ReactKeyboardEvent, axis: "x" | "y" | "both") {
  const big = event.shiftKey || event.key.startsWith("Page");
  const size = big ? 10 : 1;
  const map: Record<string, [number, number]> = {
    ArrowRight: [size, 0], ArrowLeft: [-size, 0], ArrowUp: axis === "both" ? [0, size] : [size, 0], ArrowDown: axis === "both" ? [0, -size] : [-size, 0],
    PageUp: [10, 0], PageDown: [-10, 0],
  };
  return map[event.key] ?? null;
}

interface SliderProps { label: string; value: number; valueText: string; max: number; unit: number; onChange: (value: number) => void; className: string; style?: CSSProperties; reduced: boolean; fill: string; onActive: (active: boolean) => void; active: boolean }
function Slider({ label, value, valueText, max, unit, onChange, className, style, reduced, fill, onActive, active }: SliderProps) {
  const x = useFollow(value / max, reduced, active);
  const left = useTransform(x, v => `${v * 100}%`);
  const pad = usePad(fx => onChange(fx * max), onActive);
  return <div className={`${styles.slider} ${className}`} style={style} {...pad}>
    <motion.div className={styles.sliderThumb} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-valuetext={valueText}
      style={{ left, "--thumb-fill": fill } as unknown as CSSProperties} data-active={active || undefined}
      onKeyDown={event => {
        if (event.key === "Home" || event.key === "End") { event.preventDefault(); onChange(event.key === "Home" ? 0 : max); return; }
        const step = stepFor(event, "x");
        if (!step) return;
        event.preventDefault();
        onChange(clamp(value + step[0] * unit, 0, max));
      }} />
  </div>;
}

function Chip({ color, className }: { color: string; className?: string }) {
  return <span className={`${styles.chip} ${className ?? ""}`}><span style={{ background: color }} /></span>;
}

let swatchCount = 0;
const newId = () => `swatch-${Date.now().toString(36)}-${swatchCount++}`;

export function ColorPicker({
  value, defaultValue = "#2F6BFF", onValueChange, background = "#FFFFFF", label = "Color", swatches: swatchesProp, defaultSwatches, onSwatchesChange,
  maxSwatches = 7, defaultFormat = "hex", className,
}: ColorPickerProps) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const hydrated = useHydrated();
  const reduced = !!useReducedMotion() && hydrated;
  const canPick = useEyeDropper();

  const [hsva, setHsva] = useState<Hsva>(() => parseColor(value ?? defaultValue) ?? { h: 220, s: .8, v: 1, a: 1 });
  const [synced, setSynced] = useState(value);
  if (value !== undefined && value !== synced) {
    setSynced(value);
    if (value.toUpperCase() !== toHex(hsva)) { const next = parseColor(value, hsva.h); if (next) setHsva(next); }
  }
  const [ownSwatches, setOwnSwatches] = useState<ColorSwatch[]>(defaultSwatches ?? []);
  const swatches = swatchesProp ?? ownSwatches;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [kind, setKind] = useState<ColorFormat>(defaultFormat);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [morph, setMorph] = useState<{ id: number; from: string; to: string; phase: 0 | 1 } | null>(null);
  const [active, setActive] = useState<"area" | "hue" | "alpha" | null>(null);
  const [focusSwatch, setFocusSwatch] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const areaThumb = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const swatchRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragged = useRef(false);
  const fieldX = useMotionValue(0);
  /** Whether the panel is meant to be open right now, read when a closing animation finishes. */
  const openNow = useRef(false);

  const hex = toHex(hsva);
  const rgb = hsvToRgb(hsva);
  const css = `rgb(${byte(rgb.r)} ${byte(rgb.g)} ${byte(rgb.b)} / ${round(hsva.a, 3)})`;
  const opaque = `rgb(${byte(rgb.r)} ${byte(rgb.g)} ${byte(rgb.b)})`;
  const pure = `hsl(${hsva.h} 100% 50%)`;
  const bg = parseColor(background);
  const ratio = contrast(hsva, bg ? hsvToRgb(bg) : { r: 1, g: 1, b: 1, a: 1 });
  const text = format(hsva, kind);

  function commit(next: Hsva) {
    setHsva(next);
    const nextHex = toHex(next);
    if (nextHex !== hex) onValueChange?.(nextHex);
  }
  function setSwatches(next: ColorSwatch[]) { if (!swatchesProp) setOwnSwatches(next); onSwatchesChange?.(next); }

  // The surface: one progress value grows the swatch's box into the panel's box; the content fades in behind the leading edge.
  const progress = useMotionValue(0), fade = useMotionValue(0);
  const size = { W: useMotionValue(300), H: useMotionValue(420), w: useMotionValue(160), h: useMotionValue(44) };
  const clipPath = useTransform(() => {
    const q = clamp(progress.get());
    return `inset(0px ${round((size.W.get() - size.w.get()) * (1 - q), 2)}px ${round((size.H.get() - size.h.get()) * (1 - q), 2)}px 0px round ${round(22 + 4 * q, 2)}px)`;
  });
  const contentOpacity = useTransform(progress, [.35, .9], [0, 1]);
  const contentY = useTransform(progress, [0, 1], [-10, 0]);

  useLayoutEffect(() => {
    if (!shown) return;
    const panel = panelRef.current, trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const measure = () => { size.W.set(panel.offsetWidth); size.H.set(panel.offsetHeight); size.w.set(trigger.offsetWidth); size.h.set(trigger.offsetHeight); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [shown, size.W, size.H, size.w, size.h]);

  useEffect(() => {
    if (!shown) return;
    if (reduced) {
      progress.jump(open ? 1 : progress.get());
      const controls = animate(fade, open ? 1 : 0, { duration: duration.fast, ease: [...ease.standard] });
      controls.then(() => { if (!openNow.current) { progress.jump(0); setShown(false); } });
      return () => controls.stop();
    }
    fade.jump(1);
    const controls = animate(progress, open ? 1 : 0, open ? openSpring : closeSpring);
    if (!open) controls.then(() => { if (!openNow.current) setShown(false); });
    return () => controls.stop();
  }, [fade, open, progress, reduced, shown]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => areaThumb.current?.focus({ preventScroll: true }));
  }, [open]);

  function show() { openNow.current = true; setShown(true); setOpen(true); }
  function hide(returnFocus = true) {
    openNow.current = false;
    setOpen(false); setDraft(null); setInvalid(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  const dismiss = useEffectEvent((event: Event) => {
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      hide(!!rootRef.current?.contains(document.activeElement));
      return;
    }
    if (!rootRef.current?.contains(event.target as Node)) hide(false);
  });
  useEffect(() => {
    if (!open) return;
    const listener = (event: Event) => dismiss(event);
    document.addEventListener("pointerdown", listener, true);
    document.addEventListener("keydown", listener);
    return () => { document.removeEventListener("pointerdown", listener, true); document.removeEventListener("keydown", listener); };
  }, [open]);

  // The saturation and brightness area.
  const areaX = useFollow(hsva.s, reduced, active === "area"), areaY = useFollow(1 - hsva.v, reduced, active === "area");
  const areaLeft = useTransform(areaX, v => `${v * 100}%`), areaTop = useTransform(areaY, v => `${v * 100}%`);
  const areaPad = usePad((x, y) => commit({ ...hsva, s: x, v: 1 - y }), on => setActive(on ? "area" : null));

  // Format morph: the new text mounts showing the old string, then morphs to the new one, and the live field returns once it settles.
  useEffect(() => {
    if (!morph || morph.phase === 1) return;
    const frame = requestAnimationFrame(() => setMorph(current => current && current.id === morph.id ? { ...current, phase: 1 } : current));
    return () => cancelAnimationFrame(frame);
  }, [morph]);
  useEffect(() => {
    if (!morph || morph.phase === 0) return;
    const timer = window.setTimeout(() => setMorph(current => current?.id === morph.id ? null : current), 620);
    return () => window.clearTimeout(timer);
  }, [morph]);

  function cycleFormat() {
    const next = formats[(formats.indexOf(kind) + 1) % formats.length];
    setKind(next); setDraft(null); setInvalid(false);
    if (!reduced) setMorph({ id: Date.now(), from: text, to: format(hsva, next), phase: 0 });
  }

  function submitDraft() {
    if (draft === null) return true;
    const next = parseColor(draft, hsva.h);
    if (!next) {
      setInvalid(true);
      if (!reduced) animate(fieldX, [0, -5, 4, -2, 0], { duration: .32, ease: [...ease.standard] });
      return false;
    }
    commit(next); setDraft(null); setInvalid(false);
    return true;
  }

  function pickFromScreen() {
    if (!canPick) return;
    const Ctor = (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper;
    new Ctor().open().then(result => { const next = parseColor(result.sRGBHex, hsva.h); if (next) commit({ ...next, a: hsva.a }); }).catch(() => {});
  }

  function saveSwatch() {
    const entry = { id: newId(), color: hex };
    setSwatches([entry, ...swatches].slice(0, maxSwatches));
    setFocusSwatch(entry.id);
  }
  function onSwatchKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const item = swatches[index];
    const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const next = swatches.filter(entry => entry.id !== item.id);
      setSwatches(next);
      const neighbor = next[Math.min(index, next.length - 1)];
      setFocusSwatch(neighbor?.id ?? null);
      requestAnimationFrame(() => neighbor ? swatchRefs.current.get(neighbor.id)?.focus({ preventScroll: true }) : inputRef.current?.focus({ preventScroll: true }));
      return;
    }
    if (!move && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (move && event.altKey) {
      const to = index + move;
      if (to < 0 || to >= swatches.length) return;
      const next = [...swatches];
      next.splice(index, 1); next.splice(to, 0, item);
      setSwatches(next);
      requestAnimationFrame(() => swatchRefs.current.get(item.id)?.focus({ preventScroll: true }));
      return;
    }
    const target = event.key === "Home" ? 0 : event.key === "End" ? swatches.length - 1 : (index + move + swatches.length) % swatches.length;
    setFocusSwatch(swatches[target].id);
    swatchRefs.current.get(swatches[target].id)?.focus({ preventScroll: true });
  }

  const ratioValue = useFollow(ratio, reduced);
  const ratioText = useTransform(ratioValue, v => v.toFixed(2));
  const grade = level(ratio);
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: "0.3em", filter: `blur(${blur.subtle}px)` };
  const swatchTab = swatches.some(entry => entry.id === focusSwatch) ? focusSwatch : swatches[0]?.id;
  const style = { "--picker-color": css, "--picker-opaque": opaque, "--picker-hue": pure, "--picker-bg": background } as CSSProperties;

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} style={style}>
    <button ref={triggerRef} type="button" className={styles.trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${uid}-panel` : undefined}
      onClick={() => open ? hide() : show()}>
      <Chip color={css} />
      <span className={styles.triggerText}><span className={styles.name}>{label}</span><span className={styles.hex}>{hex}</span></span>
    </button>

    {shown && <div className={styles.float} data-open={open || undefined}>
      <motion.div ref={panelRef} id={`${uid}-panel`} role="dialog" aria-label={`${label} color`} className={styles.panel} inert={!open} style={{ clipPath, opacity: fade }}>
        <div className={styles.head}>
          <Chip color={css} />
          <span className={styles.triggerText}><span className={styles.name}>{label}</span><span className={styles.hex}>{hex}</span></span>
          <motion.span className={styles.headActions} style={{ opacity: contentOpacity }}>
            {canPick && <button type="button" className={styles.iconButton} aria-label="Pick a color from the screen" onClick={pickFromScreen}><Pipette size={18} strokeWidth={1.75} aria-hidden="true" /></button>}
            <button type="button" className={styles.iconButton} aria-label="Done" onClick={() => hide()}><Check size={18} strokeWidth={1.75} aria-hidden="true" /></button>
          </motion.span>
        </div>

        <motion.div className={styles.body} style={{ opacity: contentOpacity, y: contentY }}>
          <div className={styles.area} data-active={active === "area" || undefined} {...areaPad}>
            <motion.div ref={areaThumb} className={styles.areaThumb} role="slider" tabIndex={0} aria-roledescription="2D slider"
              aria-label="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsva.s * 100)}
              aria-valuetext={`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`}
              style={{ left: areaLeft, top: areaTop }}
              onKeyDown={event => {
                const step = stepFor(event, "both");
                if (!step) return;
                event.preventDefault();
                commit({ ...hsva, s: clamp(hsva.s + step[0] / 100), v: clamp(hsva.v + step[1] / 100) });
              }} />
          </div>

          <Slider label="Hue" value={hsva.h} valueText={`${Math.round(hsva.h)} degrees`} max={360} unit={1} className={styles.hue} reduced={reduced} fill={pure}
            onChange={h => commit({ ...hsva, h: clamp(h, 0, 359.9) })} active={active === "hue"} onActive={on => setActive(on ? "hue" : null)} />
          <Slider label="Opacity" value={hsva.a * 100} valueText={`${Math.round(hsva.a * 100)}%`} max={100} unit={1} className={styles.alpha} reduced={reduced} fill={css}
            onChange={a => commit({ ...hsva, a: clamp(a / 100) })} active={active === "alpha"} onActive={on => setActive(on ? "alpha" : null)} />

          <motion.div className={styles.field} data-invalid={invalid || undefined} style={{ x: fieldX }}>
            <button type="button" className={styles.format} onClick={cycleFormat} aria-label={`Format: ${formatNames[kind]}. Switch format`}>
              <TextMorph>{formatNames[kind]}</TextMorph>
            </button>
            <span className={styles.inputWrap}>
              <input ref={inputRef} className={styles.input} value={draft ?? text} spellCheck={false} autoComplete="off" aria-label={`${label} in ${formatNames[kind]}`}
                aria-invalid={invalid || undefined} aria-describedby={invalid ? `${uid}-error` : undefined} data-morphing={morph ? "" : undefined}
                onChange={event => { setDraft(event.target.value); setInvalid(false); }}
                onKeyDown={event => {
                  if (event.key === "Enter") { event.preventDefault(); if (submitDraft()) event.currentTarget.select(); }
                  if (event.key === "Escape" && draft !== null) { event.stopPropagation(); event.nativeEvent.stopImmediatePropagation(); setDraft(null); setInvalid(false); }
                }}
                onBlur={() => { if (!submitDraft()) { setDraft(null); setInvalid(false); } }} />
              {morph && <span className={styles.morph} aria-hidden="true"><TextMorph>{morph.phase === 0 ? morph.from : morph.to}</TextMorph></span>}
            </span>
          </motion.div>
          <p id={`${uid}-error`} className={styles.error} aria-live="polite">{invalid ? "Enter a hex, RGB, HSL, or OKLCH color" : ""}</p>

          <div className={styles.contrast}>
            <span className={styles.sample} aria-hidden="true">Aa</span>
            <span className={styles.ratio}><motion.span>{ratioText}</motion.span>:1</span>
            <span className={styles.against}>against background</span>
            <span className={styles.grade} data-grade={grade === "Fails" ? "fail" : grade === "AA large" ? "large" : "pass"}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={grade} initial={hidden} animate={{ opacity: 1, y: "0em", filter: "blur(0px)" }}
                  exit={{ ...hidden, transition: { duration: duration.instant } }} transition={reduced ? { duration: duration.instant } : { duration: duration.standard, ease: [...ease.enter] }}>{grade}</motion.span>
              </AnimatePresence>
            </span>
            <span className={styles.srOnly}>{`Contrast ${ratio.toFixed(2)} to 1, ${grade === "Fails" ? "fails" : `passes ${grade}`}`}</span>
          </div>

          <div className={styles.swatches}>
            <button type="button" className={styles.add} onClick={saveSwatch} aria-label={`Save ${hex}`}><Plus size={16} strokeWidth={1.75} aria-hidden="true" /></button>
            <Reorder.Group as="div" axis="x" values={swatches} onReorder={setSwatches} className={styles.swatchList} role="listbox" aria-label="Saved colors" aria-orientation="horizontal">
              <AnimatePresence initial={false}>
                {swatches.map((entry, index) => <Reorder.Item key={entry.id} value={entry} as="div" className={styles.swatchSlot} dragElastic={.12}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .4 }} animate={{ opacity: 1, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .4, transition: { duration: duration.fast } }}
                  transition={reduced ? instant : { ...spring.snappy, layout: spring.smooth }} whileDrag={reduced ? undefined : { scale: 1.15, zIndex: 2 }}
                  onDragStart={() => { dragged.current = true; }} onDragEnd={() => requestAnimationFrame(() => { dragged.current = false; })}>
                  <button ref={node => { if (node) swatchRefs.current.set(entry.id, node); else swatchRefs.current.delete(entry.id); }}
                    type="button" role="option" aria-selected={entry.color.toUpperCase() === hex} className={styles.swatch} data-current={entry.color.toUpperCase() === hex || undefined}
                    aria-label={`${entry.color}. Alt and arrow keys to move, Delete to remove`} tabIndex={entry.id === swatchTab ? 0 : -1}
                    onFocus={() => setFocusSwatch(entry.id)} onKeyDown={event => onSwatchKey(event, index)}
                    onClick={() => { if (dragged.current) return; const next = parseColor(entry.color, hsva.h); if (next) commit(next); }}>
                    <Chip color={entry.color} className={styles.swatchChip} />
                  </button>
                </Reorder.Item>)}
              </AnimatePresence>
            </Reorder.Group>
          </div>
        </motion.div>
      </motion.div>
    </div>}
  </div>;
}

export default ColorPicker;
