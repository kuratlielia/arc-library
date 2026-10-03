"use client";

import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { RotateCcw, Search, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./shortcut-recorder.module.css";

/* ================================================================================================
 * Shortcut model. A shortcut is a string such as "mod+shift+k". `mod` is ⌘ on Apple platforms and
 * Ctrl elsewhere, so one binding reads right everywhere. Keys come from the physical key where it
 * matters, so ⌥K records as "alt+k" instead of "˚".
 * ============================================================================================== */

export type Platform = "mac" | "other";
export interface ShortcutToken { /** What the key cap shows. */ label: string; /** Physical key id, matched against held keys. */ id: string; spoken: string }

const MODIFIER_ORDER = ["mod", "ctrl", "alt", "shift", "meta"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];
const isModifier = (part: string): part is Modifier => (MODIFIER_ORDER as readonly string[]).includes(part);

const CODE_KEYS: Record<string, string> = {
  Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`",
  Space: "space", Enter: "enter", NumpadEnter: "enter", Escape: "escape", Backspace: "backspace", Delete: "delete", Tab: "tab",
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown",
};
const MODIFIER_KEYS: Record<string, string> = { Meta: "meta", OS: "meta", Control: "ctrl", Alt: "alt", AltGraph: "alt", Shift: "shift" };

/** The physical key id for an event: "k", "1", "enter", "meta", "shift"… `null` for keys that never make a shortcut, such as Caps Lock. */
export function keyId(event: Pick<KeyboardEvent, "key" | "code">): string | null {
  const { code, key } = event;
  if (MODIFIER_KEYS[key]) return MODIFIER_KEYS[key];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  if (/^F\d{1,2}$/.test(key)) return key.toLowerCase();
  if (key === "CapsLock" || key === "Fn" || key === "Dead" || key === "Unidentified" || key === "Process") return null;
  return key.length === 1 ? key.toLowerCase() : null;
}

function splitShortcut(shortcut: string) {
  const parts = shortcut.toLowerCase().split("+").map(part => part.trim()).filter(Boolean);
  const key = parts.filter(part => !isModifier(part)).pop() ?? "";
  return { mods: new Set(parts.filter(isModifier)), key };
}

/** One spelling per combination: on a Mac, Command is `mod`; elsewhere, Ctrl is. Modifiers come in a fixed order. */
export function normalizeShortcut(shortcut: string, platform: Platform) {
  const { mods, key } = splitShortcut(shortcut);
  if (platform === "mac" && mods.delete("meta")) mods.add("mod");
  if (platform === "other" && mods.delete("ctrl")) mods.add("mod");
  return [...MODIFIER_ORDER.filter(mod => mods.has(mod)), key].filter(Boolean).join("+");
}

/** Reads a keydown into a shortcut string, or `null` while only modifiers are down. */
export function shortcutFromEvent(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, platform: Platform) {
  const key = keyId(event);
  if (!key || ["meta", "ctrl", "alt", "shift"].includes(key)) return null;
  const mods: string[] = [];
  if (platform === "mac" ? event.metaKey : event.ctrlKey) mods.push("mod");
  if (platform === "mac" ? event.ctrlKey : false) mods.push("ctrl");
  if (event.altKey) mods.push("alt");
  if (event.shiftKey) mods.push("shift");
  if (platform === "other" && event.metaKey) mods.push("meta");
  return normalizeShortcut([...mods, key].join("+"), platform);
}

/** True when a keydown is this shortcut. Use it to run the action a recorded shortcut is bound to. */
export function matchesShortcut(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, shortcut: string, platform: Platform) {
  const pressed = shortcutFromEvent(event, platform);
  return !!pressed && pressed === normalizeShortcut(shortcut, platform);
}

const MAC_KEYS: Record<string, [string, string]> = { enter: ["↩", "Return"], backspace: ["⌫", "Delete"], delete: ["⌦", "Forward delete"], tab: ["⇥", "Tab"], escape: ["esc", "Escape"] };
const SHARED_KEYS: Record<string, [string, string]> = {
  space: ["Space", "Space"], enter: ["Enter", "Enter"], escape: ["Esc", "Escape"], backspace: ["Backspace", "Backspace"], delete: ["Del", "Delete"], tab: ["Tab", "Tab"],
  up: ["↑", "Up arrow"], down: ["↓", "Down arrow"], left: ["←", "Left arrow"], right: ["→", "Right arrow"], home: ["Home", "Home"], end: ["End", "End"], pageup: ["PgUp", "Page up"], pagedown: ["PgDn", "Page down"],
  ",": [",", "Comma"], ".": [".", "Period"], "/": ["/", "Slash"], ";": [";", "Semicolon"], "'": ["'", "Quote"], "[": ["[", "Left bracket"], "]": ["]", "Right bracket"], "\\": ["\\", "Backslash"], "-": ["-", "Minus"], "=": ["=", "Equals"], "`": ["`", "Backtick"],
};

/** Key caps for a shortcut in platform order: ⌃ ⌥ ⇧ ⌘ on a Mac, Ctrl Alt Shift Win elsewhere. */
export function shortcutTokens(shortcut: string, platform: Platform): ShortcutToken[] {
  const { mods, key } = splitShortcut(normalizeShortcut(shortcut, platform));
  const tokens: ShortcutToken[] = [];
  if (platform === "mac") {
    if (mods.has("ctrl")) tokens.push({ label: "⌃", id: "ctrl", spoken: "Control" });
    if (mods.has("alt")) tokens.push({ label: "⌥", id: "alt", spoken: "Option" });
    if (mods.has("shift")) tokens.push({ label: "⇧", id: "shift", spoken: "Shift" });
    if (mods.has("mod") || mods.has("meta")) tokens.push({ label: "⌘", id: "meta", spoken: "Command" });
  } else {
    if (mods.has("mod") || mods.has("ctrl")) tokens.push({ label: "Ctrl", id: "ctrl", spoken: "Control" });
    if (mods.has("alt")) tokens.push({ label: "Alt", id: "alt", spoken: "Alt" });
    if (mods.has("shift")) tokens.push({ label: "Shift", id: "shift", spoken: "Shift" });
    if (mods.has("meta")) tokens.push({ label: "Win", id: "meta", spoken: "Windows" });
  }
  if (key) {
    const named = (platform === "mac" ? MAC_KEYS[key] : undefined) ?? SHARED_KEYS[key];
    tokens.push(named ? { label: named[0], id: key, spoken: named[1] } : { label: key.toUpperCase(), id: key, spoken: key.toUpperCase() });
  }
  return tokens;
}

/** "⌘⇧K" on a Mac, "Ctrl+Shift+K" elsewhere, plus a spoken form for assistive technology. */
export function formatShortcut(shortcut: string, platform: Platform) {
  const tokens = shortcutTokens(shortcut, platform);
  return { text: tokens.map(token => token.label).join(platform === "mac" ? "" : "+"), spoken: tokens.map(token => token.spoken).join(" ") };
}

const subscribe = () => () => {};
/** Reduced motion that only applies after hydration, so server and client render the same styles. */
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}
const detectPlatform = (): Platform => {
  if (typeof navigator === "undefined") return "mac";
  const hint = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(hint) ? "mac" : "other";
};
/** The viewer's platform. Server renders assume a Mac and settle on the first client render. */
export function usePlatform(override?: Platform): Platform {
  const detected = useSyncExternalStore(subscribe, detectPlatform, () => "mac" as Platform);
  return override ?? detected;
}

/** Keys held down right now, by physical id. Clears on window blur, and after Command lifts (macOS drops the other keyups). */
export function usePressedKeys(enabled = true) {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!enabled) return;
    const update = (change: (next: Set<string>) => void) => setHeld(current => { const next = new Set(current); change(next); return next.size === current.size && [...next].every(key => current.has(key)) ? current : next; });
    const down = (event: KeyboardEvent) => { const id = keyId(event); if (id) update(next => next.add(id)); };
    const up = (event: KeyboardEvent) => {
      const id = keyId(event);
      update(next => {
        if (id) next.delete(id);
        if (id === "meta") [...next].forEach(key => { if (!["ctrl", "alt", "shift"].includes(key)) next.delete(key); });
        if (!event.metaKey) next.delete("meta"); if (!event.ctrlKey) next.delete("ctrl"); if (!event.altKey) next.delete("alt"); if (!event.shiftKey) next.delete("shift");
      });
    };
    const clear = () => setHeld(current => current.size ? new Set() : current);
    // Capture phase, so keys still register while a focused recorder keeps the chord from bubbling.
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear); };
  }, [enabled]);
  return enabled ? held : EMPTY;
}
const EMPTY: ReadonlySet<string> = new Set();

/* ================================================================================================
 * Kbd and ShortcutKeys
 * ============================================================================================== */

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Draws the key pushed down and lit, such as while it is held. */
  pressed?: boolean;
  size?: "sm" | "md";
}

/** A key cap. Use it inline in copy, in menus, or through `ShortcutKeys` for a whole combination. */
export const Kbd = forwardRef<HTMLElement, KbdProps>(function Kbd({ children, pressed = false, size = "md", className, ...props }, ref) {
  return <kbd ref={ref} {...props} className={[styles.kbd, className].filter(Boolean).join(" ")} data-size={size} data-pressed={pressed || undefined}>{children}</kbd>;
});
Kbd.displayName = "Kbd";

export interface ShortcutKeysProps {
  shortcut: string;
  platform?: Platform;
  /** Held key ids from `usePressedKeys`; matching caps light up. */
  pressed?: ReadonlySet<string>;
  size?: "sm" | "md";
  className?: string;
}

/** A shortcut as key caps, with a spoken label for assistive technology. */
export function ShortcutKeys({ shortcut, platform: platformProp, pressed, size = "md", className }: ShortcutKeysProps) {
  const platform = usePlatform(platformProp);
  const tokens = shortcutTokens(shortcut, platform);
  return <span className={[styles.keys, className].filter(Boolean).join(" ")} role="img" aria-label={tokens.map(token => token.spoken).join(" ")}>
    {tokens.map((token, index) => <Kbd key={`${index}-${token.id}`} size={size} pressed={pressed?.has(token.id)} aria-hidden="true">{token.label}</Kbd>)}
  </span>;
}

/* ================================================================================================
 * ShortcutRecorder
 * ============================================================================================== */

export interface ShortcutBinding { shortcut: string; label: string }

export interface ShortcutRecorderProps {
  label: string;
  hideLabel?: boolean;
  value?: string | null;
  defaultValue?: string | null;
  /** `replaced` is the binding the new shortcut was taken from after "Use anyway", so the caller can unbind it. */
  onValueChange?: (value: string | null, details: { replaced?: ShortcutBinding }) => void;
  /** What the reset button restores. Defaults to `defaultValue`. */
  resetValue?: string | null;
  /** Shortcuts already in use. Recording one of them asks before taking it. */
  bindings?: ShortcutBinding[];
  /** Also warn about combinations the browser or system keeps, such as ⌘W and ⌘C. On by default. */
  warnReserved?: boolean;
  /** Require ⌘, Ctrl, or ⌥ (function keys are always allowed). On by default. */
  requireModifier?: boolean;
  platform?: Platform;
  placeholder?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const RESERVED: ShortcutBinding[] = [
  { shortcut: "mod+w", label: "Close tab" }, { shortcut: "mod+t", label: "New tab" }, { shortcut: "mod+n", label: "New window" }, { shortcut: "mod+q", label: "Quit" },
  { shortcut: "mod+l", label: "Address bar" }, { shortcut: "mod+r", label: "Reload" }, { shortcut: "mod+shift+t", label: "Reopen tab" },
  { shortcut: "mod+c", label: "Copy" }, { shortcut: "mod+v", label: "Paste" }, { shortcut: "mod+x", label: "Cut" }, { shortcut: "mod+z", label: "Undo" }, { shortcut: "mod+a", label: "Select all" },
];

type Pending = { shortcut: string; conflict: ShortcutBinding; reserved: boolean };

const chip: Variants = {
  enter: { opacity: 0, scale: .72, y: 4, filter: `blur(${motionTokens.blur.subtle}px)` },
  rest: (index: number) => ({ opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transition: { ...motionTokens.spring.snappy, delay: index * motionTokens.stagger.item, opacity: { duration: .14, delay: index * motionTokens.stagger.item }, filter: { duration: .16, delay: index * motionTokens.stagger.item } } }),
  exit: { opacity: 0, scale: .8, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: .1 } },
};
const chipFade: Variants = { enter: { opacity: 0 }, rest: { opacity: 1, scale: 1, y: 0, filter: "none", transition: { duration: .1 } }, exit: { opacity: 0, transition: { duration: .06 } } };

/**
 * A field that records a keyboard shortcut. Press it, then press the combination: held modifiers light up as caps while you
 * build the chord, the finished shortcut settles into place, and a combination that is already taken asks before it is used.
 * Escape cancels, Backspace clears, and the reset button restores the default. Caps follow the platform: ⌘ on a Mac, Ctrl elsewhere.
 */
export function ShortcutRecorder({
  label, hideLabel = false, value, defaultValue = null, onValueChange, resetValue, bindings = [], warnReserved = true, requireModifier = true,
  platform: platformProp, placeholder = "Record shortcut", description, disabled = false, id, className,
}: ShortcutRecorderProps) {
  const reduced = useReducedFlag();
  const platform = usePlatform(platformProp);
  const uid = useId();
  const buttonId = id ?? `${uid}-button`;
  const labelId = `${uid}-label`, messageId = `${uid}-message`;

  const [inner, setInner] = useState<string | null>(defaultValue);
  const current = value !== undefined ? value : inner;
  const restoreTo = resetValue !== undefined ? resetValue : defaultValue;

  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [settled, setSettled] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  /* The message slot animates to the measured height of its content, so a swap to a message that wraps grows instead of snapping. */
  const [messageHeight, setMessageHeight] = useState<number | null>(null);
  const measureMessage = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(() => setMessageHeight(node.getBoundingClientRect().height));
    observer.observe(node);
    return () => { observer.disconnect(); setMessageHeight(null); };
  }, []);

  const spoken = (shortcut: string | null) => shortcut ? formatShortcut(shortcut, platform).spoken : "none";

  const commit = useCallback((next: string | null, replaced?: ShortcutBinding) => {
    setPending(null);
    setNudge(null);
    if (value === undefined) setInner(next);
    onValueChange?.(next, { replaced });
    setSettled(count => count + 1);
    setAnnouncement(next ? `Shortcut set to ${formatShortcut(next, platform).spoken}` : "Shortcut cleared");
  }, [onValueChange, platform, value]);

  const start = () => {
    if (disabled) return;
    setPending(null); setNudge(null); setLive([]);
    setRecording(true);
    setAnnouncement("Recording. Press the new shortcut, or Escape to cancel.");
  };
  const stop = () => { setRecording(false); setLive([]); };

  const conflictFor = (shortcut: string): Pending | null => {
    const normal = normalizeShortcut(shortcut, platform);
    if (current && normalizeShortcut(current, platform) === normal) return null;
    const taken = bindings.find(binding => normalizeShortcut(binding.shortcut, platform) === normal);
    if (taken) return { shortcut, conflict: taken, reserved: false };
    const reserved = warnReserved ? RESERVED.find(binding => normalizeShortcut(binding.shortcut, platform) === normal) : undefined;
    return reserved ? { shortcut, conflict: reserved, reserved: true } : null;
  };

  const liveMods = (event: ReactKeyboardEvent) => {
    const mods: string[] = [];
    if (event.ctrlKey && platform === "mac") mods.push("ctrl");
    if (event.altKey) mods.push("alt");
    if (event.shiftKey) mods.push("shift");
    if (platform === "mac" ? event.metaKey : event.ctrlKey) mods.push("mod");
    if (platform === "other" && event.metaKey) mods.push("meta");
    return mods;
  };

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!recording) {
      if ((event.key === "Backspace" || event.key === "Delete") && current) { event.preventDefault(); commit(null); }
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) { stop(); return; }
    // The chord belongs to the recorder: keep it from the page's own shortcuts, such as a ⌘K command menu.
    event.preventDefault();
    event.stopPropagation();
    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (bare && event.key === "Escape") { stop(); setAnnouncement("Recording canceled"); return; }
    if (bare && (event.key === "Backspace" || event.key === "Delete")) { stop(); commit(null); return; }
    const shortcut = shortcutFromEvent(event.nativeEvent, platform);
    if (!shortcut) { setLive(liveMods(event)); return; }
    const { mods, key } = splitShortcut(shortcut);
    const strong = mods.has("mod") || mods.has("ctrl") || mods.has("alt") || mods.has("meta");
    if (requireModifier && !strong && !/^f\d+$/.test(key)) {
      const hint = platform === "mac" ? "Include ⌘, ⌃, or ⌥" : "Include Ctrl or Alt";
      setNudge(hint); setAnnouncement(hint); setLive(liveMods(event));
      return;
    }
    stop();
    const conflict = conflictFor(shortcut);
    if (conflict) {
      setPending(conflict);
      setAnnouncement(`${formatShortcut(shortcut, platform).spoken} is ${conflict.reserved ? "reserved for" : "used by"} ${conflict.conflict.label}. Use anyway, or record another.`);
      return;
    }
    commit(shortcut);
  }
  function onKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>) { if (recording) setLive(liveMods(event)); }

  const shown = pending?.shortcut ?? current;
  const tokens = recording ? shortcutTokens(live.join("+"), platform) : shown ? shortcutTokens(shown, platform) : [];
  const state = recording ? "recording" : pending ? "conflict" : "idle";
  const canReset = !recording && (pending !== null || (current ?? null) !== (restoreTo ?? null));
  const canClear = !recording && !!current && !pending;
  const message = pending
    ? { tone: "warning" as const, key: `c-${pending.shortcut}`, body: <>{pending.reserved ? "Reserved for" : "Already used by"} <strong className={styles.strong}>{pending.conflict.label}</strong></> }
    : nudge ? { tone: "hint" as const, key: `n-${nudge}`, body: <>{nudge}</> }
    : recording ? { tone: "hint" as const, key: "rec", body: <>Esc to cancel, Backspace to clear</> }
    : description ? { tone: "hint" as const, key: "d", body: <>{description}</> } : null;

  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => setSettled(0), 700);
    return () => window.clearTimeout(timer);
  }, [settled]);

  return <div className={[styles.field, className].filter(Boolean).join(" ")} data-disabled={disabled || undefined}>
    <span id={labelId} className={hideLabel ? styles.srOnly : styles.label}>{label}</span>
    <div className={styles.control} data-state={state}>
      <button ref={buttonRef} id={buttonId} type="button" className={styles.recorder} disabled={disabled} aria-labelledby={`${labelId} ${buttonId}`} aria-describedby={message ? messageId : undefined}
        aria-pressed={recording}
        onClick={event => { if (recording) { if (event.detail !== 0) { stop(); setAnnouncement("Recording canceled"); } return; } start(); }}
        onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => { if (recording) { stop(); setNudge(null); } }}>
        <span className={styles.srOnly}>{recording ? "Recording" : shown ? spoken(shown) : placeholder}</span>
        <span className={styles.row} aria-hidden="true">
          {recording && <span className={styles.dot} data-reduced={reduced || undefined} />}
          <AnimatePresence initial={false} mode="popLayout">
            {tokens.map((token, index) => <motion.span key={`${token.id}`} layout={reduced ? false : "position"} custom={recording ? 0 : index} variants={reduced ? chipFade : chip} initial="enter" animate="rest" exit="exit"
              transition={reduced ? { duration: 0 } : { layout: motionTokens.spring.snappy }} className={styles.chipSlot}>
              <Kbd pressed={recording || (settled > 0 && !pending)} data-tone={pending ? "warning" : undefined}>{token.label}</Kbd>
            </motion.span>)}
            {tokens.length === 0 && <motion.span key={recording ? "prompt" : "placeholder"} className={styles.placeholder} data-recording={recording || undefined}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4, filter: `blur(${motionTokens.blur.subtle}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, transition: { duration: .08 } }} transition={reduced ? { duration: .1 } : { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] }}>
              {recording ? "Press keys" : placeholder}
            </motion.span>}
          </AnimatePresence>
        </span>
      </button>

      <span className={styles.actions}>
        <AnimatePresence initial={false}>
          {canReset && <motion.button key="reset" type="button" className={styles.action} aria-label={`Reset to ${restoreTo ? formatShortcut(restoreTo, platform).spoken : "none"}`}
            onClick={() => { commit(restoreTo ?? null); buttonRef.current?.focus(); }}
            initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .6, transition: { duration: .1 } }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}>
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
          </motion.button>}
          {canClear && <motion.button key="clear" type="button" className={styles.action} aria-label="Clear shortcut" onClick={() => { commit(null); buttonRef.current?.focus(); }}
            initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .6, transition: { duration: .1 } }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </motion.button>}
        </AnimatePresence>
      </span>
    </div>

    <AnimatePresence initial={false}>
      {message && <motion.div key="slot" className={styles.messageSlot} initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: messageHeight ?? "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0, transition: reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: .1 } } }}
        transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } }}>
        <div ref={measureMessage}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div key={message.key} id={messageId} className={styles.message} data-tone={message.tone}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, transition: { duration: .08 } }} transition={{ duration: reduced ? .1 : motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>
              <span className={styles.messageText}>{message.body}</span>
              {pending && <span className={styles.messageActions}>
                <button type="button" className={styles.link} onClick={() => { const taken = pending; commit(taken.shortcut, taken.reserved ? undefined : taken.conflict); buttonRef.current?.focus(); }}>Use anyway</button>
                <button type="button" className={styles.link} data-quiet="" onClick={() => { setPending(null); setAnnouncement("Kept the previous shortcut"); buttonRef.current?.focus(); }}>Cancel</button>
              </span>}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>}
    </AnimatePresence>
    <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
  </div>;
}

/* ================================================================================================
 * ShortcutList
 * ============================================================================================== */

export interface ShortcutListItem { label: string; shortcut: string; /** Extra words that match when searching. */ keywords?: string }
export interface ShortcutListGroup { label: string; items: ShortcutListItem[] }

export interface ShortcutListProps {
  groups: ShortcutListGroup[];
  /** Accessible name of the list. */
  label?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Light up caps as keys are held, and fade rows that do not use the held modifiers. On by default. */
  highlightPressed?: boolean;
  platform?: Platform;
  className?: string;
}

/**
 * A searchable, grouped cheatsheet. Holding a modifier lights that cap in every row and fades rows that do not use it, so people
 * can explore by holding keys; a row whose whole combination is down lights up. Search matches names, groups, and key names such as "cmd k".
 */
export function ShortcutList({ groups, label = "Keyboard shortcuts", searchable = true, searchPlaceholder = "Search shortcuts", highlightPressed = true, platform: platformProp, className }: ShortcutListProps) {
  const reduced = useReducedFlag();
  const platform = usePlatform(platformProp);
  const held = usePressedKeys(highlightPressed);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const heldMods = useMemo(() => [...held].filter(key => ["meta", "ctrl", "alt", "shift"].includes(key)), [held]);
  const words = query.trim().toLowerCase().replace(/[⌘]/g, " cmd ").replace(/[⇧]/g, " shift ").replace(/[⌥]/g, " alt ").replace(/[⌃]/g, " ctrl ").split(/[\s+]+/).filter(Boolean);
  const aliases: Record<string, string> = { cmd: "command", command: "command", ctrl: "control", control: "control", opt: "option", option: platform === "mac" ? "option" : "alt", alt: platform === "mac" ? "option" : "alt", win: "windows", esc: "escape", return: platform === "mac" ? "return" : "enter" };

  const filtered = groups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (!words.length) return true;
      const tokens = shortcutTokens(item.shortcut, platform);
      const haystack = `${item.label} ${group.label} ${item.keywords ?? ""} ${tokens.map(token => `${token.spoken} ${token.label}`).join(" ")}`.toLowerCase();
      return words.every(word => haystack.includes(aliases[word] ?? word) || haystack.includes(word));
    }),
  })).filter(group => group.items.length);

  const total = filtered.reduce((sum, group) => sum + group.items.length, 0);
  const rowTransition = reduced ? { duration: 0 } : motionTokens.spring.smooth;

  return <section className={[styles.list, className].filter(Boolean).join(" ")} aria-label={label}>
    {searchable && <div className={styles.searchRow}>
      <Search className={styles.searchIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
      <input ref={searchRef} className={styles.search} type="search" placeholder={searchPlaceholder} value={query} aria-label={searchPlaceholder} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }} autoComplete="off" spellCheck={false} />
      <span className={styles.count} aria-live="polite">{query ? `${total} ${total === 1 ? "match" : "matches"}` : ""}</span>
      <AnimatePresence initial={false}>
        {query && <motion.button key="clear" type="button" className={styles.clear} aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}
          initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .6, transition: { duration: .1 } }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}>
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </motion.button>}
      </AnimatePresence>
    </div>}

    <div className={styles.groups}>
      <AnimatePresence initial={false}>
        {filtered.map(group => <motion.section key={group.label} className={styles.group} aria-label={group.label}
          initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={rowTransition}>
          <h4 className={styles.groupLabel}>{group.label}</h4>
          <ul className={styles.rows}>
            <AnimatePresence initial={false}>
              {group.items.map(item => {
                const tokens = shortcutTokens(item.shortcut, platform);
                const ids = tokens.map(token => token.id);
                const match = held.size > 0 && ids.every(key => held.has(key));
                const dim = heldMods.length > 0 && !match && !heldMods.every(mod => ids.includes(mod));
                return <motion.li key={item.label} className={styles.item} data-match={match || undefined} data-dim={dim || undefined}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={rowTransition}>
                  <span className={styles.itemInner}>
                    <span className={styles.itemLabel}>{item.label}</span>
                    <ShortcutKeys shortcut={item.shortcut} platform={platform} pressed={held} size="sm" />
                  </span>
                </motion.li>;
              })}
            </AnimatePresence>
          </ul>
        </motion.section>)}
      </AnimatePresence>
      {total === 0 && <p className={styles.empty}>No shortcuts match “{query.trim()}”</p>}
    </div>
  </section>;
}

export default ShortcutRecorder;
