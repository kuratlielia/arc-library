"use client";

import { forwardRef, useCallback, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, UIEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { Hash } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./mention-input.module.css";

export type MentionKind = "person" | "channel";

export interface MentionPerson {
  id: string;
  name: string;
  /** One short line under the name, such as a job title. */
  role?: string;
  /** Portrait URL. Initials show when it is missing. */
  avatar?: string;
}

export interface MentionChannel {
  id: string;
  name: string;
  description?: string;
  members?: number;
}

/** A mention inside `text`. `start` and `end` are character offsets; the text between them is `@label` or `#label`. */
export interface Mention {
  kind: MentionKind;
  id: string;
  label: string;
  start: number;
  end: number;
}

export interface MentionValue {
  text: string;
  mentions: Mention[];
}

export interface MentionInputHandle {
  focus: () => void;
  /** Inserts text at the caret, as if typed. */
  insert: (text: string) => void;
  /** Types a trigger at the caret so the suggestions open, adding a space first when needed. */
  openSuggestions: (kind: MentionKind) => void;
  clear: () => void;
  textarea: HTMLTextAreaElement | null;
}

export interface MentionInputProps {
  value?: MentionValue;
  defaultValue?: MentionValue;
  onChange?: (value: MentionValue) => void;
  /** People offered after `@`. Leave it out to turn person mentions off. */
  people?: MentionPerson[];
  /** Channels offered after `#`. Leave it out to turn channel mentions off. */
  channels?: MentionChannel[];
  /** Called when a suggestion becomes a mention. */
  onMentionAdd?: (mention: Mention) => void;
  /** With `submitOnEnter`, Enter submits and Shift+Enter adds a line. */
  onSubmit?: (value: MentionValue) => void;
  submitOnEnter?: boolean;
  placeholder?: string;
  minRows?: number;
  /** The field grows to this many rows, then scrolls. */
  maxRows?: number;
  /** Where suggestions open. `auto` flips above when there is no room below. */
  placement?: "auto" | "top" | "bottom";
  maxSuggestions?: number;
  disabled?: boolean;
  name?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
}

type Suggestion = { kind: "person"; item: MentionPerson } | { kind: "channel"; item: MentionChannel };
type Trigger = { kind: MentionKind; start: number; query: string };

const EMPTY: MentionValue = { text: "", mentions: [] };
const SYMBOL: Record<MentionKind, string> = { person: "@", channel: "#" };
const POPOVER_WIDTH = 272;
const { spring, duration, ease } = motionTokens;
const enter = [...ease.enter] as [number, number, number, number];
const standard = [...ease.standard] as [number, number, number, number];
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const GLIDE = physical(.3, .1), GROW = physical(spring.smooth.visualDuration, 0);
/** First placements. A jump made in the commit that mounts its element never reaches the DOM; an instant animation lands on the first frame. */
const INSTANT: Transition = { duration: 0 };

export const mentionText = (kind: MentionKind, label: string) => `${SYMBOL[kind]}${label}`;

/** Turns a value into storage friendly text, `<@id>` for people and `<#id>` for channels by default. */
export function serializeMentions(value: MentionValue, format: (mention: Mention) => string = mention => `<${SYMBOL[mention.kind]}${mention.id}>`) {
  let out = "", at = 0;
  for (const mention of [...value.mentions].sort((a, b) => a.start - b.start)) {
    out += value.text.slice(at, mention.start) + format(mention);
    at = mention.end;
  }
  return out + value.text.slice(at);
}

/** Moves mentions along with an edit and drops any the edit touched. `hint` is the caret before the edit, which settles repeated characters. */
function reconcile(previous: MentionValue, text: string, hint: number): Mention[] {
  const a = previous.text;
  let prefix = 0;
  const maxPrefix = Math.min(a.length, text.length, Math.max(0, hint));
  while (prefix < maxPrefix && a[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < text.length - prefix && a[a.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  const oldEnd = a.length - suffix, delta = text.length - a.length;
  return previous.mentions.flatMap(mention => {
    if (mention.end <= prefix) return [mention];
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    return [];
  }).filter(mention => text.slice(mention.start, mention.end) === mentionText(mention.kind, mention.label));
}

function findTrigger(text: string, caret: number, mentions: Mention[], kinds: Record<MentionKind, boolean>): Trigger | null {
  for (let index = caret - 1; index >= 0 && index >= caret - 48; index--) {
    const char = text[index];
    if (char === "\n") return null;
    if (char !== "@" && char !== "#") continue;
    const kind: MentionKind = char === "@" ? "person" : "channel";
    if (!kinds[kind]) return null;
    if (index > 0 && !/[\s([{"']/.test(text[index - 1])) return null;
    if (mentions.some(mention => index >= mention.start && index < mention.end)) return null;
    const query = text.slice(index + 1, caret);
    const shape = kind === "person" ? /^[^\s@#]*( [^\s@#]*)?$/ : /^[^\s@#]*$/;
    return shape.test(query) ? { kind, start: index, query } : null;
  }
  return null;
}

function rank(label: string, extra: string, query: string) {
  const name = label.toLowerCase();
  if (!query) return 1;
  if (name.startsWith(query)) return 4;
  if (name.split(/[\s\-_.]+/).some(word => word.startsWith(query))) return 3;
  if (name.includes(query)) return 2;
  return extra.toLowerCase().includes(query) ? 1 : 0;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
}

/** The matched part of a label reads in full contrast; the rest stays quiet. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className={styles.match}>{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

/**
 * A textarea with `@` people and `#` channel mentions. Mentions are atomic: the caret steps over them and one Backspace removes the whole token.
 * The value carries plain text plus a structured `mentions` array with offsets, ready to store or notify.
 */
export const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(function MentionInput({
  value: valueProp, defaultValue, onChange, people, channels, onMentionAdd, onSubmit, submitOnEnter = false,
  placeholder, minRows = 1, maxRows = 8, placement = "auto", maxSuggestions = 6, disabled, name, id,
  "aria-label": ariaLabel, "aria-describedby": describedBy, className,
}, ref) {
  const reduced = !!useReducedMotion();
  const uid = useId();
  const listId = `${uid}-list`;
  const [inner, setInner] = useState<MentionValue>(defaultValue ?? EMPTY);
  const value = valueProp ?? inner;
  const live = useRef(value);
  useLayoutEffect(() => { live.current = value; });

  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const lastCaret = useRef(0);
  const pending = useRef<Mention | null>(null);

  const [caret, setCaret] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  const commit = useCallback((next: MentionValue) => {
    if (valueProp === undefined) setInner(next);
    onChange?.(next);
  }, [onChange, valueProp]);

  const kinds = useMemo(() => ({ person: !!people?.length, channel: !!channels?.length }), [channels, people]);
  const trigger = useMemo(() => caret === null ? null : findTrigger(value.text, caret, value.mentions, kinds), [caret, kinds, value.mentions, value.text]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger) return [];
    const query = trigger.query.toLowerCase().trim();
    const scored: { entry: Suggestion; score: number }[] = trigger.kind === "person"
      ? (people ?? []).map(item => ({ entry: { kind: "person" as const, item }, score: rank(item.name, item.role ?? "", query) }))
      : (channels ?? []).map(item => ({ entry: { kind: "channel" as const, item }, score: rank(item.name, item.description ?? "", query) }));
    return scored.filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, maxSuggestions).map(entry => entry.entry);
  }, [channels, maxSuggestions, people, trigger]);

  // A sentence that simply continues after an unmatched name closes the list instead of showing an empty state.
  const open = focused && !disabled && !!trigger && trigger.start !== dismissed && (suggestions.length > 0 || !trigger.query.includes(" "));
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));
  const queryKey = trigger ? `${trigger.start}:${trigger.query}` : "";
  const [lastQueryKey, setLastQueryKey] = useState(queryKey);
  if (lastQueryKey !== queryKey) { setLastQueryKey(queryKey); setActive(0); }
  if (dismissed !== null && trigger?.start !== dismissed) setDismissed(null);

  /* Selection: the caret never rests inside a token. Arrow keys hop over it; a click lands on the nearest edge. */
  const onSelect = () => {
    const area = areaRef.current;
    if (!area) return;
    let start = area.selectionStart, end = area.selectionEnd;
    const collapsed = start === end;
    for (const mention of live.current.mentions) {
      if (collapsed && start > mention.start && start < mention.end) {
        const stepped = Math.abs(start - lastCaret.current) === 1;
        const forward = start > lastCaret.current;
        start = end = stepped ? (forward ? mention.end : mention.start) : (start - mention.start < mention.end - start ? mention.start : mention.end);
      } else if (!collapsed) {
        if (start > mention.start && start < mention.end) start = mention.start;
        if (end > mention.start && end < mention.end) end = mention.end;
      }
    }
    if (start !== area.selectionStart || end !== area.selectionEnd) area.setSelectionRange(start, end, area.selectionDirection);
    lastCaret.current = area.selectionStart;
    setCaret(collapsed ? start : null);
  };

  const onInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    const mentions = reconcile(live.current, text, lastCaret.current);
    const added = pending.current;
    pending.current = null;
    if (added && text.slice(added.start, added.end) === mentionText(added.kind, added.label)) {
      mentions.push(added);
      mentions.sort((a, b) => a.start - b.start);
    }
    const next = { text, mentions };
    live.current = next;
    commit(next);
    if (added) onMentionAdd?.(added);
    lastCaret.current = event.target.selectionStart;
    setCaret(event.target.selectionStart === event.target.selectionEnd ? event.target.selectionStart : null);
  };

  /** Types through the browser so the change joins the native undo stack; falls back to a direct edit. */
  const typeText = useCallback((text: string, from?: number, to?: number) => {
    const area = areaRef.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    if (from !== undefined) area.setSelectionRange(from, to ?? from);
    lastCaret.current = area.selectionStart;
    const typed = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (typed) return;
    const start = area.selectionStart, end = area.selectionEnd, current = live.current;
    const nextText = current.text.slice(0, start) + text + current.text.slice(end);
    const mentions = reconcile(current, nextText, start);
    const added = pending.current;
    pending.current = null;
    if (added) mentions.push(added);
    mentions.sort((a, b) => a.start - b.start);
    const next = { text: nextText, mentions };
    live.current = next;
    commit(next);
    if (added) onMentionAdd?.(added);
    requestAnimationFrame(() => { area.setSelectionRange(start + text.length, start + text.length); setCaret(start + text.length); });
  }, [commit, onMentionAdd]);

  const choose = (suggestion: Suggestion | undefined) => {
    if (!suggestion || !trigger || caret === null) return;
    const label = suggestion.item.name;
    const token = mentionText(suggestion.kind, label);
    pending.current = { kind: suggestion.kind, id: suggestion.item.id, label, start: trigger.start, end: trigger.start + token.length };
    const after = value.text[caret];
    typeText(after === undefined || !/\s/.test(after) ? `${token} ` : token, trigger.start, caret);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const area = event.currentTarget;
    lastCaret.current = area.selectionStart;
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (suggestions.length) setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && suggestions.length && !event.shiftKey) {
        event.preventDefault();
        choose(suggestions[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(trigger?.start ?? null);
        return;
      }
    }
    const start = area.selectionStart, end = area.selectionEnd;
    if (start === end && !event.metaKey && (event.key === "Backspace" || event.key === "Delete")) {
      // Select the whole token and let the native delete run, so one keystroke removes it and undo restores it.
      const hit = live.current.mentions.find(mention => event.key === "Backspace" ? start > mention.start && start <= mention.end : start >= mention.start && start < mention.end);
      if (hit) area.setSelectionRange(hit.start, hit.end);
      return;
    }
    if (event.key === "Enter" && submitOnEnter && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (live.current.text.trim()) onSubmit?.(live.current);
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => areaRef.current?.focus(),
    insert: text => typeText(text),
    openSuggestions: kind => {
      const area = areaRef.current;
      if (!area) return;
      const at = document.activeElement === area ? area.selectionStart : live.current.text.length;
      const before = live.current.text[at - 1];
      setDismissed(null);
      typeText(`${before && !/\s/.test(before) ? " " : ""}${SYMBOL[kind]}`, at, document.activeElement === area ? area.selectionEnd : at);
    },
    clear: () => {
      commit(EMPTY);
      live.current = EMPTY;
      setCaret(0);
    },
    get textarea() { return areaRef.current; },
  }), [commit, typeText]);

  /* Autosize: the backdrop mirrors the text, so its height is the content height. The field springs to it within the row limits. */
  const height = useMotionValue<number | "auto">("auto");
  const [limits, setLimits] = useState({ min: 0, max: Infinity });
  const measured = useRef(false);
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const style = getComputedStyle(backdrop);
    const line = parseFloat(style.lineHeight) || 24;
    const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const next = { min: line * minRows + pad, max: line * Math.max(minRows, maxRows) + pad };
    setLimits(current => current.min === next.min && current.max === next.max ? current : next);
  }, [maxRows, minRows]);
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop || !limits.min) return;
    const fit = () => {
      const target = Math.min(limits.max, Math.max(limits.min, backdrop.offsetHeight));
      const current = height.get();
      if (!measured.current || reduced || typeof current !== "number") { animate(height, target, INSTANT); measured.current = true; return; }
      if (Math.abs(current - target) > .5) animate(height, target, GROW);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(backdrop);
    return () => observer.disconnect();
  }, [height, limits, reduced]);

  /* The popover hangs from the trigger character, measured from a marker in the mirrored text. */
  const [anchor, setAnchor] = useState<{ x: number; y: number; line: number; above: boolean } | null>(null);
  const measureAnchor = useCallback(() => {
    const marker = backdropRef.current?.querySelector<HTMLElement>("[data-anchor]");
    const root = rootRef.current, field = fieldRef.current, area = areaRef.current;
    if (!marker || !root || !field || !area) { setAnchor(null); return; }
    const line = parseFloat(getComputedStyle(marker.parentElement ?? marker).lineHeight) || 24;
    const x = Math.max(0, Math.min(field.offsetLeft + marker.offsetLeft - 10, root.offsetWidth - POPOVER_WIDTH));
    const top = field.offsetTop + marker.offsetTop - area.scrollTop;
    const box = root.getBoundingClientRect();
    const roomBelow = window.innerHeight - (box.top + top + line);
    const above = placement === "top" || (placement === "auto" && roomBelow < 300 && box.top + top > roomBelow);
    const y = above ? top - 6 : top + line + 6;
    setAnchor(current => current && current.x === x && current.y === y && current.above === above && current.line === line ? current : { x, y, line, above });
  }, [placement]);
  useLayoutEffect(() => { if (open) measureAnchor(); }, [measureAnchor, open, trigger?.start, value.text]);
  // The popover mounts one commit after `open`, once the anchor is measured; the effects below wait for it.
  const shown = open && !!anchor;

  const onScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const backdrop = backdropRef.current;
    if (backdrop) backdrop.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
    measureAnchor();
  };

  /* The list's highlight glides between rows; the panel springs its height as matches come and go. */
  const listRef = useRef<HTMLUListElement>(null);
  const hy = useMotionValue(0), hh = useMotionValue(0);
  const placed = useRef(false);
  const panelHeight = useMotionValue<number | "auto">("auto");
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!row) return;
    if (reduced || !placed.current) { animate(hy, row.offsetTop, INSTANT); animate(hh, row.offsetHeight, INSTANT); placed.current = true; return; }
    animate(hy, row.offsetTop, GLIDE);
    animate(hh, row.offsetHeight, GLIDE);
  }, [activeIndex, hh, hy, reduced, shown, suggestions]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelSized = useRef(false);
  useLayoutEffect(() => {
    // The leaving list keeps its highlight while it fades; the next open places it fresh.
    if (!shown) { panelSized.current = false; placed.current = false; return; }
    const body = bodyRef.current;
    if (!body) return;
    const fit = () => {
      const target = body.offsetHeight;
      if (!panelSized.current || reduced) { animate(panelHeight, target, INSTANT); panelSized.current = true; return; }
      animate(panelHeight, target, GROW);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(body);
    return () => observer.disconnect();
  }, [panelHeight, reduced, shown, trigger?.start]);

  /* Mirror: the same text as the textarea, with tokens drawn in place and a marker at the open trigger. */
  const mirror = useMemo(() => {
    const parts: ReactNode[] = [];
    const markAt = open && trigger ? trigger.start : -1;
    let at = 0;
    const pushText = (from: number, to: number) => {
      if (markAt >= from && markAt < to) {
        parts.push(value.text.slice(from, markAt), <span key="anchor" data-anchor="" />, value.text.slice(markAt, to));
      } else parts.push(value.text.slice(from, to));
    };
    for (const mention of value.mentions) {
      pushText(at, mention.start);
      parts.push(<span key={`${mention.start}-${mention.id}`} className={styles.token} data-kind={mention.kind}>{value.text.slice(mention.start, mention.end)}</span>);
      at = mention.end;
    }
    pushText(at, value.text.length);
    return parts;
  }, [open, trigger, value.mentions, value.text]);

  const optionId = (index: number) => `${uid}-option-${index}`;
  const popIn = reduced ? { opacity: 0 } : { opacity: 0, scale: .96, y: anchor?.above ? 4 : -4 };
  const countLabel = open ? (suggestions.length ? `${suggestions.length} ${trigger?.kind === "person" ? (suggestions.length === 1 ? "person" : "people") : (suggestions.length === 1 ? "channel" : "channels")}` : "No matches") : "";

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} data-disabled={disabled || undefined}>
    <motion.div ref={fieldRef} className={styles.field} style={{ height }} data-focused={focused || undefined}>
      <div ref={backdropRef} className={styles.backdrop} aria-hidden="true">{mirror}{"\u200b"}</div>
      <textarea
        ref={areaRef}
        id={id}
        name={name}
        className={styles.textarea}
        value={value.text}
        placeholder={placeholder}
        disabled={disabled}
        rows={minRows}
        spellCheck
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && suggestions.length ? optionId(activeIndex) : undefined}
        onChange={onInput}
        onSelect={onSelect}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setCaret(null); }}
      />
    </motion.div>
    <span className={styles.srOnly} aria-live="polite">{countLabel}</span>
    <AnimatePresence>
      {open && anchor && <motion.div
        key={trigger?.start}
        className={styles.popover}
        data-above={anchor.above || undefined}
        style={{ left: anchor.x, top: anchor.y, height: panelHeight, transformOrigin: anchor.above ? "14px 100%" : "14px 0" }}
        initial={popIn}
        animate={{ opacity: 1, scale: 1, y: 0, transition: reduced ? { duration: duration.fast } : { ...spring.snappy, opacity: { duration: duration.fast, ease: enter } } }}
        exit={{ ...popIn, transition: { duration: duration.exit * .7, ease: standard } }}
        onMouseDown={event => event.preventDefault()}
      >
        <div ref={bodyRef} className={styles.popoverBody}>
          {suggestions.length ? <ul ref={listRef} id={listId} role="listbox" aria-label={trigger?.kind === "person" ? "People" : "Channels"} className={styles.list}>
            <motion.li aria-hidden="true" className={styles.highlight} style={{ y: hy, height: hh }} />
            {suggestions.map((suggestion, index) => <li
              key={`${suggestion.kind}-${suggestion.item.id}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              data-index={index}
              className={styles.option}
              onPointerMove={() => { if (index !== activeIndex) setActive(index); }}
              onClick={() => choose(suggestion)}
            >
              {suggestion.kind === "person"
                ? <span className={styles.avatar} aria-hidden="true">{suggestion.item.avatar
                  // eslint-disable-next-line @next/next/no-img-element -- registry components stay framework agnostic
                  ? <img src={suggestion.item.avatar} alt="" width={28} height={28} loading="lazy" />
                  : initials(suggestion.item.name)}</span>
                : <span className={styles.glyph} aria-hidden="true"><Hash size={16} strokeWidth={1.75} /></span>}
              <span className={styles.optionText}>
                <span className={styles.optionLabel}><Highlight text={suggestion.item.name} query={trigger?.query.trim() ?? ""} /></span>
                {suggestion.kind === "person"
                  ? suggestion.item.role && <span className={styles.optionMeta}>{suggestion.item.role}</span>
                  : suggestion.item.description && <span className={styles.optionMeta}>{suggestion.item.description}</span>}
              </span>
              {suggestion.kind === "channel" && suggestion.item.members !== undefined && <span className={styles.count}>{suggestion.item.members}</span>}
            </li>)}
          </ul> : <p className={styles.empty}>No {trigger?.kind === "person" ? "people" : "channels"} match “{trigger?.query}”</p>}
        </div>
      </motion.div>}
    </AnimatePresence>
  </div>;
});

export default MentionInput;
