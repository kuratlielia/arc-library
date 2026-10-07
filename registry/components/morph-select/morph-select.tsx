"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { Transition, Variants } from "motion/react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./morph-select.module.css";

export interface MorphSelectOption {
  value: string;
  label: string;
  /** A 20px mark shown before the label, in the list and in the trigger. An avatar or a plain icon. */
  icon?: ReactNode;
  /** Short trailing detail such as an offset or a count. Rendered with tabular numerals. */
  meta?: string;
  /** Extra words that match this option when searching. */
  keywords?: string;
  disabled?: boolean;
}

/** A labelled run of options. */
export interface MorphSelectGroup {
  label: string;
  options: MorphSelectOption[];
}

export type MorphSelectItem = MorphSelectOption | MorphSelectGroup;

/**
 * A select whose trigger is the list. Opening grows the trigger itself into the options surface, a highlight glides between options,
 * and the chosen option's label lifts out of the list and settles into the trigger while the trigger springs to its new width.
 * Supports groups, type-ahead, search for long lists, and the full listbox keyboard model.
 * Use it for compact property pickers and form fields with up to a few hundred options. Prefer a combobox when people mostly type free text.
 */
export interface MorphSelectProps {
  /** Visible label, also the accessible name of the trigger and the list. */
  label: string;
  /** Keeps the label for assistive technology only. */
  hideLabel?: boolean;
  items: MorphSelectItem[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string, option: MorphSelectOption) => void;
  placeholder?: string;
  /** Shows a search field in place of the trigger when open. "auto" turns it on above eight options. */
  searchable?: boolean | "auto";
  searchPlaceholder?: string;
  /** Width of the open surface in px. It never gets narrower than the trigger. Defaults to 272. */
  panelWidth?: number;
  /** Tallest the option list gets before it scrolls, in px. Defaults to 296. */
  maxListHeight?: number;
  /** Which edge of the trigger stays put while the surface grows. */
  align?: "start" | "end";
  /** Adds a hidden input for native form submission. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

type Section = { key: string; label?: string; options: MorphSelectOption[] };
type Change = { key: number; value: string | null; dir: number; fly: { x: number; y: number } | null };

const { blur } = motionTokens;
type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;
/** Duration springs restated as stiffness and damping, so a retarget mid flight keeps the velocity it already has. */
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const GROW = physical(.4, .12), SHRINK = physical(.34, 0), GLIDE = physical(.28, .08), WIDTH = physical(.42, .16);
/** Width that narrows never overshoots: dipping even half a pixel under the closed width ellipsizes the label and nudges the chevron. */
const NARROW = physical(.42, 0);
/** The lifted label travels a touch faster than the surface folds, so the closing edge never catches it. */
const FLY = physical(.3, .06);
const OPEN_RADIUS = 22;
const TYPEAHEAD_RESET = 600, PAGE = 8;

const subscribe = () => () => {};
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

const isGroup = (item: MorphSelectItem): item is MorphSelectGroup => "options" in item;

/** Loose options between groups gather into unlabelled sections, so the list keeps the order it was given. */
function normalize(items: MorphSelectItem[]): Section[] {
  const out: Section[] = [];
  items.forEach((item, index) => {
    if (isGroup(item)) { out.push({ key: `group-${index}`, label: item.label, options: item.options }); return; }
    const last = out[out.length - 1];
    if (last && !last.label) last.options.push(item);
    else out.push({ key: `loose-${index}`, options: [item] });
  });
  return out;
}

function matches(option: MorphSelectOption, needle: string) {
  return `${option.label} ${option.meta ?? ""} ${option.keywords ?? ""}`.toLowerCase().includes(needle);
}

/** Lid values roll with the list: a later option rises from below, an earlier one drops from above. */
const valueVariants: Variants = {
  enter: (change: Change) => change.fly ? { opacity: 1, x: change.fly.x, y: change.fly.y, filter: "blur(0px)" } : { opacity: 0, x: 0, y: `${change.dir * .5}em`, filter: `blur(${blur.soft}px)` },
  rest: { opacity: 1, x: 0, y: 0, filter: "blur(0px)" },
  exit: (change: Change) => ({ opacity: 0, x: 0, y: change.fly ? "-0.3em" : `${change.dir * -.45}em`, filter: `blur(${blur.subtle}px)`, transition: { duration: .12, ease: standard } }),
};
const valueFade: Variants = { enter: { opacity: 0 }, rest: { opacity: 1, x: 0, y: 0, filter: "blur(0px)" }, exit: { opacity: 0, transition: { duration: .1 } } };

/** The closed trigger's width, rounded up. offsetWidth rounds to the nearest pixel, and half a pixel short is enough to ellipsize the label. */
const triggerWidth = (node: HTMLElement) => {
  const exact = node.getBoundingClientRect().width, rounded = node.offsetWidth;
  // Under a scaled ancestor the rect is scaled too, so fall back to the layout width with a pixel of slack.
  return Math.abs(exact - rounded) <= .5 ? Math.ceil(exact - .01) : rounded + 1;
};

export function MorphSelect({ label, hideLabel = false, items, value, defaultValue = null, onValueChange, placeholder = "Select", searchable = "auto", searchPlaceholder,
  panelWidth = 272, maxListHeight = 296, align = "start", name, disabled = false, className }: MorphSelectProps) {
  const reduced = useReducedFlag();
  const uid = useId();
  const labelId = `${uid}-label`, listId = `${uid}-list`, optionId = (index: number) => `${uid}-option-${index}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const listFaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const optionRefs = useRef(new Map<string, HTMLElement>());

  const sections = useMemo(() => normalize(items), [items]);
  const all = useMemo(() => sections.flatMap(section => section.options), [sections]);
  const indexOf = useMemo(() => new Map(all.map((option, index) => [option.value, index])), [all]);
  const canSearch = searchable === "auto" ? all.length > 8 : searchable;

  const [inner, setInner] = useState<string | null>(defaultValue);
  const selected = value !== undefined ? value : inner;
  const selectedOption = selected === null ? undefined : all.find(option => option.value === selected);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [change, setChange] = useState<Change>({ key: 0, value: null, dir: 1, fly: null });

  const needle = query.trim().toLowerCase();
  const visibleSections = useMemo(() => needle
    ? sections.map(section => ({ ...section, options: section.options.filter(option => matches(option, needle)) })).filter(section => section.options.length)
    : sections, [needle, sections]);
  const enabled = useMemo(() => visibleSections.flatMap(section => section.options).filter(option => !option.disabled), [visibleSections]);
  const current = active !== null && enabled.some(option => option.value === active) ? active : enabled[0]?.value ?? null;
  const resultCount = visibleSections.reduce((sum, section) => sum + section.options.length, 0);

  /* The shape: one surface whose width, height, and corners spring between the trigger and the open list. */
  const anchorW = useMotionValue<number | string>("auto");
  const shapeW = useMotionValue<number | string>("100%"), shapeH = useMotionValue<number | string>("100%"), radius = useMotionValue(22);
  const sizes = useRef({ trigger: 0, lid: 0, listW: 0, listH: 0 });
  const live = useRef({ open: false, reduced: false, measured: false });
  useLayoutEffect(() => { live.current.reduced = reduced; }, [reduced]);

  const place = useCallback((animated: boolean) => {
    const { trigger, lid, listW, listH } = sizes.current;
    if (!trigger || !lid) return;
    const isOpen = live.current.open;
    const next = isOpen ? { w: Math.max(trigger, listW), h: lid + listH, r: OPEN_RADIUS } : { w: trigger, h: lid, r: lid / 2 };
    if (!animated || live.current.reduced || !live.current.measured) {
      anchorW.jump(trigger); shapeW.jump(next.w); shapeH.jump(next.h); radius.jump(next.r);
      live.current.measured = true;
      return;
    }
    const lastW = typeof shapeW.get() === "number" ? shapeW.get() as number : next.w;
    const lastH = typeof shapeH.get() === "number" ? shapeH.get() as number : next.h;
    const lastAnchor = typeof anchorW.get() === "number" ? anchorW.get() as number : trigger;
    const transition = next.w * next.h >= lastW * lastH ? GROW : SHRINK;
    animate(anchorW, trigger, trigger < lastAnchor ? NARROW : WIDTH);
    animate(shapeW, next.w, isOpen ? transition : next.w < lastW ? NARROW : WIDTH);
    animate(shapeH, next.h, transition);
    animate(radius, next.r, transition);
  }, [anchorW, radius, shapeH, shapeW]);

  useLayoutEffect(() => {
    const measure = measureRef.current, face = listFaceRef.current, root = rootRef.current;
    if (!measure || !face || !root) return;
    const read = () => {
      const previous = sizes.current;
      // The open list is never narrower than the trigger; the width goes to CSS directly so a new label never waits on a render.
      root.style.setProperty("--ms-trigger-w", `${triggerWidth(measure)}px`);
      const next = { trigger: triggerWidth(measure), lid: measure.offsetHeight, listW: face.offsetWidth, listH: face.offsetHeight };
      const changed = next.trigger !== previous.trigger || next.lid !== previous.lid || (live.current.open && (next.listW !== previous.listW || next.listH !== previous.listH));
      sizes.current = next;
      if (changed) place(live.current.measured);
    };
    read();
    root.dataset.ready = "";
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(measure);
    observer.observe(face);
    return () => observer.disconnect();
  }, [place]);

  useLayoutEffect(() => {
    if (live.current.open === open) return;
    live.current.open = open;
    // A pick changes the label and closes in the same commit, so both faces are read fresh before the shape moves.
    const face = listFaceRef.current, measure = measureRef.current;
    if (face && measure) {
      rootRef.current?.style.setProperty("--ms-trigger-w", `${triggerWidth(measure)}px`);
      sizes.current = { trigger: triggerWidth(measure), lid: measure.offsetHeight, listW: face.offsetWidth, listH: face.offsetHeight };
    }
    place(true);
  }, [open, place]);

  /* The highlight glides between options on its own spring and fades when nothing is active. */
  const hy = useMotionValue(0), hh = useMotionValue(0), ho = useMotionValue(0);
  const scrollIntent = useRef(false);
  useLayoutEffect(() => {
    const node = open && current !== null ? optionRefs.current.get(current) : undefined;
    if (!node) { animate(ho, 0, { duration: reduced || !open ? 0 : .12, ease: standard }); return; }
    const top = node.offsetTop, height = node.offsetHeight;
    if (ho.get() < .05 || reduced) { hy.jump(top); hh.jump(height); }
    else { animate(hy, top, GLIDE); animate(hh, height, GLIDE); }
    animate(ho, 1, { duration: reduced ? 0 : .12, ease: enter });
    const scroller = scrollRef.current;
    if (scroller && scrollIntent.current) {
      scrollIntent.current = false;
      const pad = 6;
      if (top < scroller.scrollTop + pad) scroller.scrollTop = top - pad;
      else if (top + height > scroller.scrollTop + scroller.clientHeight - pad) scroller.scrollTop = top + height - scroller.clientHeight + pad;
    }
  }, [current, hh, ho, hy, open, reduced, visibleSections]);

  /* Focus lands in the lid: the search field when there is one, otherwise the trigger that keeps the active option. */
  const pendingFocus = useRef<"trigger" | "input" | null>(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "input") inputRef.current?.focus({ preventScroll: true });
    if (target === "trigger") triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

  const typeahead = useRef({ buffer: "", at: 0 });
  /** Space opens and picks on keydown; the click a button fires on the matching keyup must not undo it. */
  const suppressClick = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  const openList = (focus?: string | null, seed = "") => {
    if (disabled || open) return;
    setQuery(seed);
    setActive(focus !== undefined ? focus : selected);
    scrollIntent.current = true;
    pendingFocus.current = canSearch ? "input" : "trigger";
    setAnnouncement("");
    setOpen(true);
  };

  const close = useCallback((restoreFocus: boolean) => {
    typeahead.current.buffer = "";
    if (restoreFocus) pendingFocus.current = "trigger";
    setOpen(false);
  }, []);

  const commit = (option: MorphSelectOption | undefined, source?: HTMLElement | null) => {
    if (!option || option.disabled) return;
    if (option.value !== selected) {
      let fly: Change["fly"] = null;
      const slot = slotRef.current;
      const part = source?.querySelector<HTMLElement>("[data-part='value']");
      if (!reduced && part && slot) {
        const from = part.getBoundingClientRect(), to = slot.getBoundingClientRect();
        fly = { x: from.left - to.left, y: from.top + from.height / 2 - (to.top + to.height / 2) };
      }
      const from = selected === null ? -1 : indexOf.get(selected) ?? -1, to = indexOf.get(option.value) ?? 0;
      setChange(last => ({ key: last.key + 1, value: option.value, dir: from < 0 ? 1 : Math.sign(to - from) || 1, fly }));
      if (value === undefined) setInner(option.value);
      onValueChange?.(option.value, option);
    }
    close(true);
  };

  const typeTo = (char: string) => {
    const now = performance.now(), state = typeahead.current;
    state.buffer = now - state.at > TYPEAHEAD_RESET ? char : state.buffer + char;
    state.at = now;
    const buffer = state.buffer.toLowerCase();
    const repeated = buffer.split("").every(letter => letter === buffer[0]);
    const search = repeated ? buffer[0]! : buffer;
    const pool = all.filter(option => !option.disabled);
    const from = open ? current : selected;
    const at = pool.findIndex(option => option.value === from);
    const offset = repeated || buffer.length === 1 ? 1 : 0;
    const ordered = [...pool.slice(at + offset), ...pool.slice(0, at + offset)];
    return ordered.find(option => option.label.toLowerCase().startsWith(search));
  };

  const move = (to: string | null | undefined) => {
    if (to === undefined || to === null) return;
    scrollIntent.current = true;
    setActive(to);
  };

  const onKey = (event: ReactKeyboardEvent<HTMLElement>, fromInput: boolean) => {
    const { key } = event;
    if (key === " " && !fromInput) suppressClick.current = true;
    const printable = key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
    const typing = performance.now() - typeahead.current.at < TYPEAHEAD_RESET && typeahead.current.buffer.length > 0;

    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || (key === " " && !typing)) { event.preventDefault(); openList(); return; }
      if (key === "Home" || key === "End") { event.preventDefault(); const pool = all.filter(option => !option.disabled); openList((key === "Home" ? pool[0] : pool[pool.length - 1])?.value ?? null); return; }
      if (printable) {
        event.preventDefault();
        if (canSearch) openList(undefined, key);
        else { const hit = typeTo(key); openList(hit?.value ?? selected); }
      }
      return;
    }

    const at = enabled.findIndex(option => option.value === current);
    const caretKeys = fromInput && query.length > 0;
    switch (key) {
      case "ArrowDown": event.preventDefault(); move(enabled[Math.min(enabled.length - 1, at + 1)]?.value); return;
      case "ArrowUp":
        event.preventDefault();
        if (event.altKey) { commit(enabled[at], optionRefs.current.get(current ?? "")); return; }
        move(enabled[Math.max(0, at - 1)]?.value); return;
      case "PageDown": event.preventDefault(); move(enabled[Math.min(enabled.length - 1, at + PAGE)]?.value); return;
      case "PageUp": event.preventDefault(); move(enabled[Math.max(0, at - PAGE)]?.value); return;
      case "Home": if (caretKeys) return; event.preventDefault(); move(enabled[0]?.value); return;
      case "End": if (caretKeys) return; event.preventDefault(); move(enabled[enabled.length - 1]?.value); return;
      case "Enter": event.preventDefault(); commit(enabled[at], optionRefs.current.get(current ?? "")); return;
      case "Escape": event.preventDefault(); event.stopPropagation(); close(true); return;
      case "Tab": close(false); return;
    }
    if (fromInput) return;
    if (key === " " && !typing) { event.preventDefault(); commit(enabled[at], optionRefs.current.get(current ?? "")); return; }
    if (printable) { event.preventDefault(); move(typeTo(key)?.value); }
  };

  // A press outside or focus leaving the control folds the list back into the trigger.
  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [close, open]);
  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !event.currentTarget.contains(next)) close(false);
  };

  const onQuery = (next: string) => {
    setQuery(next);
    setActive(null);
    scrollIntent.current = true;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const text = next.trim().toLowerCase();
    const count = text ? all.filter(option => matches(option, text)).length : all.length;
    setAnnouncement(text ? count ? `${count} ${count === 1 ? "option" : "options"}` : "No matches" : "");
  };

  const renderValue = (option: MorphSelectOption | undefined) => option
    ? <>{option.icon && <span className={styles.icon} aria-hidden="true">{option.icon}</span>}<span className={styles.valueText}>{option.label}</span></>
    : <span className={styles.placeholder}>{placeholder}</span>;

  const showSearch = open && canSearch;
  const layerKey = selected ?? "__empty";
  const changeForLayer: Change = change.value === selected ? change : { ...change, fly: null };
  const rootStyle = { "--ms-panel-w": `${panelWidth}px`, "--ms-list-max": `${maxListHeight}px` } as CSSProperties;

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} style={rootStyle} data-open={open || undefined} data-align={align} data-disabled={disabled || undefined} onBlur={onBlur}>
    <span id={labelId} className={hideLabel ? styles.srOnly : styles.label}>{label}</span>

    <motion.div className={styles.anchor} style={{ width: anchorW }}>
      {/* Sizes the closed trigger. It holds the chosen label with the trigger's own padding, so the width spring has a target before anything moves. */}
      <span ref={measureRef} className={`${styles.trigger} ${styles.measure}`} aria-hidden="true">{renderValue(selectedOption)}</span>

      <motion.div className={styles.shape} style={{ width: shapeW, height: shapeH, borderRadius: radius }}>
        <div className={styles.lid}>
          <button ref={triggerRef} type="button" className={styles.trigger} role="combobox" aria-labelledby={labelId} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
            aria-activedescendant={open && !canSearch && current !== null ? optionId(indexOf.get(current) ?? 0) : undefined}
            disabled={disabled} inert={showSearch || undefined} tabIndex={showSearch ? -1 : 0}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } if (open) close(true); else openList(); }}
            onKeyDown={event => onKey(event, false)} onKeyUp={event => { if (event.key === " ") window.setTimeout(() => { suppressClick.current = false; }); }}>
            <span ref={slotRef} className={styles.slot} data-hidden={showSearch || undefined}>
              <AnimatePresence initial={false} custom={changeForLayer}>
                <motion.span key={layerKey} className={styles.layer} custom={changeForLayer} variants={reduced ? valueFade : valueVariants} initial="enter" animate="rest" exit="exit"
                  transition={reduced ? { duration: .12 } : changeForLayer.fly ? { x: FLY, y: FLY, opacity: { duration: 0 } } : { y: GLIDE, opacity: { duration: .2, ease: enter }, filter: { duration: .22, ease: enter } }}>
                  {renderValue(selectedOption)}
                </motion.span>
              </AnimatePresence>
            </span>
          </button>

          {canSearch && <motion.div className={styles.searchRow} inert={!showSearch || undefined} initial={false}
            animate={showSearch ? { opacity: 1, filter: "blur(0px)" } : { opacity: 0, filter: reduced ? "blur(0px)" : `blur(${blur.subtle}px)` }}
            transition={showSearch ? { duration: .18, ease: enter, delay: reduced ? 0 : .04 } : { duration: .1, ease: standard }}>
            <Search className={styles.searchIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
            <input ref={inputRef} className={styles.input} type="text" role="combobox" aria-label={`Search ${label.toLowerCase()}`} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={open && current !== null ? optionId(indexOf.get(current) ?? 0) : undefined}
              placeholder={searchPlaceholder ?? selectedOption?.label ?? "Search"} value={query} autoComplete="off" spellCheck={false}
              onChange={event => onQuery(event.target.value)} onKeyDown={event => onKey(event, true)} />
            <AnimatePresence initial={false}>
              {query && <motion.button key="clear" type="button" className={styles.clear} aria-label="Clear search" onPointerDown={event => event.preventDefault()}
                onClick={() => { onQuery(""); inputRef.current?.focus(); }}
                initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .6, transition: { duration: .1 } }} transition={reduced ? { duration: 0 } : GLIDE}>
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </motion.button>}
            </AnimatePresence>
            <button type="button" className={styles.closeHit} aria-label={`Close ${label.toLowerCase()}`} onClick={() => close(true)} />
          </motion.div>}

          <motion.span className={styles.chevron} aria-hidden="true" initial={false} animate={{ rotate: open ? 180 : 0 }} transition={reduced ? { duration: 0 } : GLIDE}>
            <ChevronDown size={16} strokeWidth={1.75} />
          </motion.span>
        </div>

        <motion.div ref={listFaceRef} className={styles.listFace}
          inert={!open || undefined} aria-hidden={!open || undefined} initial={false}
          animate={open ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: reduced ? 0 : -6, filter: reduced ? "blur(0px)" : `blur(${blur.subtle}px)` }}
          transition={open ? { y: GROW, opacity: { duration: .2, ease: enter, delay: reduced ? 0 : .04 }, filter: { duration: .22, ease: enter, delay: .04 } } : { duration: .1, ease: standard }}>
          <div ref={scrollRef} className={styles.scroll}>
            <div id={listId} className={styles.options} role="listbox" aria-labelledby={labelId}>
              <motion.span className={styles.highlight} style={{ y: hy, height: hh, opacity: ho }} aria-hidden="true" />
              {visibleSections.map(section => {
                const rows = section.options.map(option => {
                  const index = indexOf.get(option.value) ?? 0;
                  const isSelected = option.value === selected, isActive = option.value === current;
                  return <div key={option.value} id={optionId(index)} role="option" aria-selected={isSelected} aria-disabled={option.disabled || undefined}
                    className={styles.option} data-active={isActive || undefined}
                    ref={node => { if (node) optionRefs.current.set(option.value, node); else optionRefs.current.delete(option.value); }}
                    onPointerMove={event => { if (event.pointerType === "mouse" && !option.disabled && option.value !== current) setActive(option.value); }}
                    onPointerDown={event => event.preventDefault()}
                    onClick={event => commit(option, event.currentTarget)}>
                    <span className={styles.optionValue} data-part="value">{option.icon && <span className={styles.icon} aria-hidden="true">{option.icon}</span>}<span className={styles.valueText}>{option.label}</span></span>
                    {option.meta && <span className={styles.meta}>{option.meta}</span>}
                    <span className={styles.check} data-on={isSelected || undefined} aria-hidden="true"><Check size={16} strokeWidth={1.75} /></span>
                  </div>;
                });
                return section.label
                  ? <div key={section.key} role="group" aria-labelledby={`${uid}-${section.key}`} className={styles.group}>
                    <div id={`${uid}-${section.key}`} className={styles.groupLabel} role="presentation">{section.label}</div>
                    {rows}
                  </div>
                  : <div key={section.key} role="presentation" className={styles.group}>{rows}</div>;
              })}
              {resultCount === 0 && <p className={styles.empty}>No matches for “{query.trim()}”</p>}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>

    {name && <input type="hidden" name={name} value={selected ?? ""} />}
    <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
  </div>;
}

export default MorphSelect;
