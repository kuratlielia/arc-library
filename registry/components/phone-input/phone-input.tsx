"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { Transition, Variants } from "motion/react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./phone-input.module.css";

/* ------------------------------------------------------------------------------------------------
 * Country table. Patterns format the national significant number (no trunk prefix); `#` is a digit.
 * Valid lengths are the digit capacities of the patterns. Examples are realistic mobile numbers and
 * double as the placeholder. Compact on purpose: no metadata download, no dependency.
 * ---------------------------------------------------------------------------------------------- */

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code, such as "US". */
  iso: string;
  name: string;
  /** Country calling code without the plus, such as "44". */
  dial: string;
  /** National formats from shortest to longest. `#` is a digit, anything else is a separator. */
  patterns: string[];
  /** A national number people may type before the number itself, such as "0" in "07911 123456". */
  trunk: string;
  /** A realistic national number, used for the placeholder and the typing guide. */
  example: string;
  /** Area codes that pick this country when several share a calling code, such as Canada inside +1. */
  areaCodes?: string[];
}

const country = (iso: string, name: string, dial: string, patterns: string | string[], example: string, trunk = "0", areaCodes?: string[]): PhoneCountry =>
  ({ iso, name, dial, patterns: Array.isArray(patterns) ? patterns : [patterns], example, trunk, areaCodes });

const CA_AREA_CODES = "204 226 236 249 250 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905".split(" ");

export const PHONE_COUNTRIES: PhoneCountry[] = [
  country("US", "United States", "1", "(###) ###-####", "2015550123", "1"),
  country("CA", "Canada", "1", "(###) ###-####", "5065550123", "1", CA_AREA_CODES),
  country("MX", "Mexico", "52", "## #### ####", "2221234567", ""),
  country("BR", "Brazil", "55", ["(##) ####-####", "(##) #####-####"], "11961234567"),
  country("AR", "Argentina", "54", "## ####-####", "1123456789"),
  country("CO", "Colombia", "57", "### ### ####", "3211234567", ""),
  country("CL", "Chile", "56", "# #### ####", "221234567", ""),
  country("PE", "Peru", "51", "### ### ###", "912345678"),
  country("GB", "United Kingdom", "44", "#### ######", "7400123456"),
  country("IE", "Ireland", "353", "## ### ####", "850123456"),
  country("FR", "France", "33", "# ## ## ## ##", "612345678"),
  country("DE", "Germany", "49", ["### #######", "### ########"], "15123456789"),
  country("ES", "Spain", "34", "### ## ## ##", "612345678", ""),
  country("IT", "Italy", "39", ["### ### ###", "### ### ####"], "3123456789", ""),
  country("PT", "Portugal", "351", "### ### ###", "912345678", ""),
  country("NL", "Netherlands", "31", "# ########", "612345678"),
  country("BE", "Belgium", "32", "### ## ## ##", "470123456"),
  country("CH", "Switzerland", "41", "## ### ## ##", "781234567"),
  country("AT", "Austria", "43", ["### #######", "### ########"], "6641234567"),
  country("SE", "Sweden", "46", "## ### ## ##", "701234567"),
  country("NO", "Norway", "47", "### ## ###", "40612345", ""),
  country("DK", "Denmark", "45", "## ## ## ##", "32123456", ""),
  country("FI", "Finland", "358", ["## ### ####", "## ### #####"], "412345678"),
  country("PL", "Poland", "48", "### ### ###", "512345678", ""),
  country("CZ", "Czechia", "420", "### ### ###", "601123456", ""),
  country("GR", "Greece", "30", "### ### ####", "6912345678", ""),
  country("UA", "Ukraine", "380", "## ### ## ##", "501234567"),
  country("TR", "Turkey", "90", "### ### ## ##", "5012345678"),
  country("IL", "Israel", "972", "##-###-####", "502345678"),
  country("AE", "United Arab Emirates", "971", "## ### ####", "501234567"),
  country("SA", "Saudi Arabia", "966", "## ### ####", "512345678"),
  country("EG", "Egypt", "20", "### ### ####", "1001234567"),
  country("NG", "Nigeria", "234", "### ### ####", "8021234567"),
  country("KE", "Kenya", "254", "### ######", "712123456"),
  country("ZA", "South Africa", "27", "## ### ####", "711234567"),
  country("IN", "India", "91", "#####-#####", "8123456789"),
  country("PK", "Pakistan", "92", "### #######", "3012345678"),
  country("CN", "China", "86", "### #### ####", "13123456789"),
  country("JP", "Japan", "81", "##-####-####", "9012345678"),
  country("KR", "South Korea", "82", ["##-###-####", "##-####-####"], "1020000000"),
  country("TW", "Taiwan", "886", "### ### ###", "912345678"),
  country("HK", "Hong Kong", "852", "#### ####", "51234567", ""),
  country("SG", "Singapore", "65", "#### ####", "81234567", ""),
  country("PH", "Philippines", "63", "### ### ####", "9051234567"),
  country("ID", "Indonesia", "62", ["###-###-####", "###-####-####", "###-####-#####"], "81234567890"),
  country("TH", "Thailand", "66", "## ### ####", "812345678"),
  country("VN", "Vietnam", "84", "## ### ## ##", "912345678"),
  country("AU", "Australia", "61", "### ### ###", "412345678"),
  country("NZ", "New Zealand", "64", ["# ### ####", "## ### ####", "## #### ####"], "211234567"),
];

const BY_ISO = new Map(PHONE_COUNTRIES.map(entry => [entry.iso, entry]));
const capacity = (pattern: string) => pattern.split("#").length - 1;
const lengthsOf = (entry: PhoneCountry) => entry.patterns.map(capacity);
/** A typed trunk prefix earns its own room; without one the longest valid length is the cap. */
const capDigits = (entry: PhoneCountry, digits: string) => digits.slice(0, splitTrunk(entry, digits)[0].length + Math.max(...lengthsOf(entry)));
const onlyDigits = (text: string) => text.replace(/\D/g, "");

/** Regional indicator letters. Platforms without flag glyphs show the two letters, which still read. */
export const flagOf = (iso: string) => String.fromCodePoint(...[...iso.toUpperCase()].map(char => 0x1f1e6 + char.charCodeAt(0) - 65));

function splitTrunk(entry: PhoneCountry, digits: string): [string, string] {
  return entry.trunk && digits.startsWith(entry.trunk) ? [entry.trunk, digits.slice(entry.trunk.length)] : ["", digits];
}

/** Separators only print while digits follow, so a half typed number never ends in a dangling ") " or "-". */
function applyPattern(digits: string, pattern: string) {
  let out = "", index = 0;
  for (const char of pattern) {
    if (index >= digits.length) break;
    out += char === "#" ? digits[index++] : char;
  }
  return out + digits.slice(index);
}

function patternFor(entry: PhoneCountry, length: number) {
  return entry.patterns.find(pattern => capacity(pattern) >= length) ?? entry.patterns[entry.patterns.length - 1]!;
}

/** Formats national digits as typed, keeping a typed trunk prefix: "07911123456" in the UK reads "07911 123456". */
export function formatNational(entry: PhoneCountry, digits: string) {
  const [trunk, rest] = splitTrunk(entry, digits);
  const pattern = patternFor(entry, rest.length);
  const body = applyPattern(rest, pattern);
  if (!trunk) return body;
  if (!rest) return trunk;
  return trunk + (/^#/.test(pattern) ? "" : " ") + body;
}

export type PhoneStatus = "empty" | "incomplete" | "valid" | "too-long";

function statusOf(entry: PhoneCountry, digits: string): PhoneStatus {
  const length = splitTrunk(entry, digits)[1].length;
  const lengths = lengthsOf(entry);
  if (!length) return "empty";
  if (lengths.includes(length)) return "valid";
  return length > Math.max(...lengths) ? "too-long" : "incomplete";
}

const toE164 = (entry: PhoneCountry, digits: string) => { const rest = splitTrunk(entry, digits)[1]; return rest ? `+${entry.dial}${rest}` : ""; };

/** Reads "+44 (0)7911 123456", "0044 7911…", or "+14165550123" into a country and national digits. Longest calling code wins. */
export function parsePhoneNumber(input: string, pool: PhoneCountry[] = PHONE_COUNTRIES): { country: PhoneCountry; national: string } | null {
  const trimmed = input.trim();
  let digits = onlyDigits(trimmed);
  if (!trimmed.startsWith("+")) { if (!trimmed.startsWith("00")) return null; digits = digits.slice(2); }
  for (const size of [3, 2, 1]) {
    const dial = digits.slice(0, size);
    const matches = pool.filter(entry => entry.dial === dial);
    if (!matches.length) continue;
    let rest = digits.slice(size);
    const entry = matches.find(item => item.areaCodes?.some(code => rest.startsWith(code))) ?? matches.find(item => !item.areaCodes) ?? matches[0]!;
    // "+44 (0)7911…" carries a trunk zero it should not; drop it when the rest is still a full number without it.
    if (entry.trunk && rest.startsWith(entry.trunk) && rest.length - entry.trunk.length >= Math.min(...lengthsOf(entry))) rest = rest.slice(entry.trunk.length);
    return { country: entry, national: capDigits(entry, rest) };
  }
  return null;
}

/** Formats an E.164 number for display, such as "+44 7400 123456". Returns the input when it cannot be read. */
export function formatPhoneNumber(e164: string) {
  const parsed = parsePhoneNumber(e164);
  return parsed ? `+${parsed.country.dial} ${formatNational(parsed.country, parsed.national)}` : e164;
}

/* ------------------------------------------------------------------------------------------------ */

export interface PhoneInputDetails {
  country: PhoneCountry;
  /** The number as shown in the field, without the calling code. */
  formatted: string;
  status: PhoneStatus;
  valid: boolean;
}

export interface PhoneInputProps {
  label: string;
  hideLabel?: boolean;
  /** The number in E.164, such as "+14155550132". An empty string clears the field. */
  value?: string;
  defaultValue?: string;
  /** Fires on every edit with the E.164 number (empty when there are no digits) and its parsed details. */
  onValueChange?: (value: string, details: PhoneInputDetails) => void;
  /** ISO code of the selected country. */
  country?: string;
  /** ISO code used until someone picks a country or enters an international number. */
  defaultCountry?: string;
  onCountryChange?: (iso: string) => void;
  /** Limit the picker to these ISO codes. */
  countries?: string[];
  /** Pinned at the top of the picker under "Suggested". */
  preferredCountries?: string[];
  description?: string;
  /** Replaces the built-in validation message. */
  error?: string;
  /** Show a message after blur when the number is incomplete. On by default. */
  validate?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** Adds a hidden input carrying the E.164 value for native form submission. */
  name?: string;
  id?: string;
  className?: string;
  onBlur?: (event: ReactFocusEvent<HTMLInputElement>) => void;
}

type Bezier = [number, number, number, number];
const enterEase = [...motionTokens.ease.enter] as Bezier;
const standardEase = [...motionTokens.ease.standard] as Bezier;
const { blur } = motionTokens;
/** Duration springs restated as stiffness and damping, so a retarget mid flight keeps the velocity it already has. */
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = (2 * Math.PI) / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const GROW = physical(.4, .12), SHRINK = physical(.32, 0), GLIDE = physical(.28, .08), WIDTH = physical(.42, .16);
const PANEL_MAX = 340, CLOSED_RADIUS = 17, OPEN_RADIUS = 22, PAGE = 8;

const subscribe = () => () => {};
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

/** The flag and calling code roll in the direction of the list: a country further down rises from below. */
const layerVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, y: `${dir * .6}em`, filter: `blur(${blur.soft}px)` }),
  rest: { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } },
  exit: (dir: number) => ({ opacity: 0, y: `${dir * -.5}em`, filter: `blur(${blur.subtle}px)`, transition: { duration: .12, ease: standardEase } }),
};
const layerFade: Variants = { enter: { opacity: 0 }, rest: { opacity: 1, y: 0, filter: "none" }, exit: { opacity: 0, transition: { duration: .08 } } };

function matchesQuery(entry: PhoneCountry, needle: string) {
  if (!needle) return true;
  const digits = onlyDigits(needle);
  if (digits && /^[+\d\s()-]+$/.test(needle)) return entry.dial.startsWith(digits) || digits.startsWith(entry.dial);
  if (needle.replace("+", "") === "") return true;
  return entry.name.toLowerCase().includes(needle) || entry.iso.toLowerCase() === needle;
}

/** Position in the formatted text just after the nth digit. */
function caretAfterDigits(text: string, count: number) {
  if (count <= 0) { const first = text.search(/\d/); return first < 0 ? text.length : Math.min(first, text.length); }
  let seen = 0;
  for (let index = 0; index < text.length; index++) if (/\d/.test(text[index]!) && ++seen === count) return index + 1;
  return text.length;
}

function MessageRow({ id, text, tone }: { id: string; text: string; tone: "hint" | "error" }) {
  const reduced = useReducedFlag();
  return <motion.span className={styles.messageSlot} initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
    exit={{ height: 0, opacity: 0, transition: reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.instant } } }}
    transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } }}>
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={text} id={id} className={tone === "error" ? styles.error : styles.hint} role={tone === "error" ? "alert" : undefined}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em", filter: `blur(${blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, transition: { duration: .1 } }} transition={{ duration: reduced ? .12 : motionTokens.duration.standard, ease: enterEase }}>{text}</motion.span>
    </AnimatePresence>
  </motion.span>;
}

type Row = { key: string; entry: PhoneCountry };
type Section = { key: string; label?: string; rows: Row[] };

/**
 * A phone number field with a country picker. The country button grows into a searchable list, the number formats as it is
 * typed with a faint guide showing the rest of the expected shape, pasted or autofilled international numbers pick their own
 * country, and the value comes out in E.164. Typing "+" in the number jumps into the picker with a calling code search.
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput({
  label, hideLabel = false, value, defaultValue, onValueChange, country: countryProp, defaultCountry = "US", onCountryChange, countries,
  preferredCountries = ["US", "CA", "GB"], description, error, validate = true, disabled = false, required, name, id, className, onBlur,
}, forwardedRef) {
  const reduced = useReducedFlag();
  const uid = useId();
  const inputId = id ?? `${uid}-number`;
  const listId = `${uid}-list`;
  const hintId = `${inputId}-hint`, errorId = `${inputId}-error`;
  const optionId = (key: string) => `${uid}-opt-${key}`;

  const pool = useMemo(() => countries?.length ? PHONE_COUNTRIES.filter(entry => countries.includes(entry.iso)) : PHONE_COUNTRIES, [countries]);
  const fallback = BY_ISO.get(defaultCountry) ?? PHONE_COUNTRIES[0]!;

  const [state, setState] = useState(() => {
    const parsed = parsePhoneNumber(value ?? defaultValue ?? "", pool);
    return parsed ? { iso: parsed.country.iso, digits: parsed.national } : { iso: fallback.iso, digits: "" };
  });
  const iso = countryProp ?? state.iso;
  const current = BY_ISO.get(iso) ?? fallback;
  const digits = state.digits;
  const e164 = toE164(current, digits);

  // A controlled value that differs from what the field last produced is read back in.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    if (value !== undefined && value !== e164) {
      const parsed = parsePhoneNumber(value, pool);
      setState(parsed ? { iso: parsed.country.iso, digits: parsed.national } : { iso, digits: "" });
    }
  }

  const formatted = formatNational(current, digits);
  const status = statusOf(current, digits);
  const [touched, setTouched] = useState(false);
  const lengths = lengthsOf(current);
  const lengthCopy = lengths.length === 1 ? `${lengths[0]}` : `${lengths.slice(0, -1).join(", ")} or ${lengths[lengths.length - 1]}`;
  const builtIn = validate && touched && (status === "incomplete" || status === "too-long") ? `Numbers in ${current.name} have ${lengthCopy} digits` : undefined;
  const message = error ?? builtIn;

  /* The guide: the rest of the example number, in the shape this country expects, drawn faintly after what was typed. */
  const guide = useMemo(() => {
    const [trunk, rest] = splitTrunk(current, digits);
    if (rest.length >= current.example.length) return "";
    const full = formatNational(current, trunk + rest + current.example.slice(rest.length));
    return full.startsWith(formatted) ? full.slice(formatted.length) : "";
  }, [current, digits, formatted]);

  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);
  const pendingCaret = useRef<number | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const emit = useCallback((entry: PhoneCountry, nextDigits: string) => {
    const nextStatus = statusOf(entry, nextDigits);
    onValueChange?.(toE164(entry, nextDigits), { country: entry, formatted: formatNational(entry, nextDigits), status: nextStatus, valid: nextStatus === "valid" });
  }, [onValueChange]);

  const setNumber = (nextDigits: string, caretDigits: number | null, entry = current) => {
    const capped = capDigits(entry, nextDigits);
    pendingCaret.current = caretDigits === null ? null : Math.min(caretDigits, capped.length);
    if (entry.iso !== current.iso) onCountryChange?.(entry.iso);
    // Nothing changed (a refused digit): React restores the old text after this handler, so the caret is placed on the next render.
    if (capped === digits && entry.iso === current.iso) { rerender(); return; }
    setState({ iso: entry.iso, digits: capped });
    emit(entry, capped);
  };

  function placeCaret() {
    const input = inputRef.current, count = pendingCaret.current;
    pendingCaret.current = null;
    if (!input || count === null || document.activeElement !== input) return;
    const position = caretAfterDigits(input.value, count);
    input.setSelectionRange(position, position);
  }
  useLayoutEffect(placeCaret);

  const [announcement, setAnnouncement] = useState("");

  /* ---------------------------------------------- Number entry ---------------------------------------------- */

  function onNumberChange(input: HTMLInputElement) {
    const raw = input.value;
    // Autofill and dropped text arrive as a change: an international number chooses its own country.
    if (raw.includes("+") || (/^\s*00/.test(raw) && onlyDigits(raw).length > 6)) {
      const parsed = parsePhoneNumber(raw.slice(Math.max(0, raw.indexOf("+"))), pool);
      if (parsed && parsed.national) {
        if (parsed.country.iso !== current.iso) setAnnouncement(`Country set to ${parsed.country.name}`);
        setNumber(parsed.national, parsed.national.length, parsed.country);
        return;
      }
    }
    const caret = input.selectionStart ?? raw.length;
    setNumber(onlyDigits(raw), onlyDigits(raw.slice(0, caret)).length);
  }

  function onNumberKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (event.key === "+" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); openList("+"); return; }
    const start = input.selectionStart ?? 0, end = input.selectionEnd ?? 0;
    if (start !== end || event.metaKey || event.ctrlKey || event.altKey) return;
    // Deleting a separator deletes the digit beside it instead of doing nothing.
    if (event.key === "Backspace" && start > 0 && !/\d/.test(input.value[start - 1]!)) {
      event.preventDefault();
      const index = onlyDigits(input.value.slice(0, start)).length;
      if (index > 0) setNumber(digits.slice(0, index - 1) + digits.slice(index), index - 1);
    }
    if (event.key === "Delete" && start < input.value.length && !/\d/.test(input.value[start]!)) {
      event.preventDefault();
      const index = onlyDigits(input.value.slice(0, start)).length;
      setNumber(digits.slice(0, index) + digits.slice(index + 1), index);
    }
  }

  function onPaste(event: ReactClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    event.preventDefault();
    const input = event.currentTarget;
    const parsed = /^\s*(\+|00)/.test(text) ? parsePhoneNumber(text, pool) : null;
    if (parsed) {
      if (parsed.country.iso !== current.iso) setAnnouncement(`Country set to ${parsed.country.name}`);
      setNumber(parsed.national, parsed.national.length, parsed.country);
      return;
    }
    let pasted = onlyDigits(text);
    // "1 415 555 0132" pasted into a US field: the leading calling code is dropped when the number would not fit otherwise.
    if (pasted.startsWith(current.dial) && pasted.length > capDigits(current, pasted).length) pasted = pasted.slice(current.dial.length);
    // A whole number replaces what was there; a fragment goes in at the caret.
    if (pasted.length >= Math.min(...lengthsOf(current))) { setNumber(pasted, pasted.length); return; }
    const a = onlyDigits(input.value.slice(0, input.selectionStart ?? 0)).length;
    const b = onlyDigits(input.value.slice(0, input.selectionEnd ?? 0)).length;
    setNumber(digits.slice(0, a) + pasted + digits.slice(b), a + pasted.length);
  }

  /* ---------------------------------------------- Country picker ---------------------------------------------- */

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [roll, setRoll] = useState(1);
  const needle = query.trim().toLowerCase();

  const sections = useMemo<Section[]>(() => {
    const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name));
    if (needle && needle !== "+") {
      const hits = sorted.filter(entry => matchesQuery(entry, needle));
      const digitsOnly = onlyDigits(needle);
      if (digitsOnly) hits.sort((a, b) => Number(b.dial === digitsOnly) - Number(a.dial === digitsOnly) || a.dial.length - b.dial.length);
      return [{ key: "results", rows: hits.map(entry => ({ key: `r-${entry.iso}`, entry })) }];
    }
    const preferred = preferredCountries.map(code => pool.find(entry => entry.iso === code)).filter((entry): entry is PhoneCountry => !!entry);
    const all = { key: "all", label: preferred.length ? "All countries" : undefined, rows: sorted.map(entry => ({ key: `a-${entry.iso}`, entry })) };
    return preferred.length ? [{ key: "preferred", label: "Suggested", rows: preferred.map(entry => ({ key: `p-${entry.iso}`, entry })) }, all] : [all];
  }, [needle, pool, preferredCountries]);
  const rows = useMemo(() => sections.flatMap(section => section.rows), [sections]);
  const activeKey = active !== null && rows.some(row => row.key === active) ? active : rows[0]?.key ?? null;
  const orderOf = useMemo(() => new Map([...pool].sort((a, b) => a.name.localeCompare(b.name)).map((entry, index) => [entry.iso, index])), [pool]);

  const rootRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const listFaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  /* One surface whose width, height, and corners spring between the country button and the open list. */
  const anchorW = useMotionValue<number | string>("auto");
  const shapeW = useMotionValue<number | string>("100%"), shapeH = useMotionValue<number | string>("100%"), radius = useMotionValue(CLOSED_RADIUS);
  const sizes = useRef({ trigger: 0, lid: 0, panel: 0, list: 0 });
  const live = useRef({ open: false, reduced: false, measured: false });
  useLayoutEffect(() => { live.current.reduced = reduced; }, [reduced]);

  const place = useCallback((animated: boolean) => {
    const { trigger, lid, panel, list } = sizes.current;
    if (!trigger || !lid) return;
    const isOpen = live.current.open;
    const next = isOpen ? { w: Math.max(trigger, panel), h: lid + 2 + list, r: OPEN_RADIUS } : { w: trigger, h: lid, r: CLOSED_RADIUS };
    if (!animated || live.current.reduced || !live.current.measured) {
      anchorW.jump(trigger); shapeW.jump(next.w); shapeH.jump(next.h); radius.jump(next.r);
      live.current.measured = true;
      return;
    }
    const growing = isOpen;
    animate(anchorW, trigger, WIDTH);
    animate(shapeW, next.w, growing ? GROW : SHRINK);
    animate(shapeH, next.h, growing ? GROW : SHRINK);
    animate(radius, next.r, growing ? GROW : SHRINK);
  }, [anchorW, radius, shapeH, shapeW]);

  const read = useCallback(() => {
    const measure = measureRef.current, control = controlRef.current, face = listFaceRef.current, root = rootRef.current;
    if (!measure || !control || !face || !root) return false;
    const panel = Math.min(PANEL_MAX, control.offsetWidth);
    root.style.setProperty("--pi-panel-w", `${panel}px`);
    const previous = sizes.current;
    const next = { trigger: measure.offsetWidth, lid: control.clientHeight, panel, list: face.offsetHeight };
    sizes.current = next;
    return next.trigger !== previous.trigger || next.lid !== previous.lid || next.panel !== previous.panel || (live.current.open && next.list !== previous.list);
  }, []);

  useLayoutEffect(() => {
    const measure = measureRef.current, control = controlRef.current, face = listFaceRef.current;
    if (read()) place(live.current.measured);
    if (!measure || !control || !face || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { if (read()) place(live.current.measured); });
    observer.observe(measure); observer.observe(control); observer.observe(face);
    return () => observer.disconnect();
  }, [place, read]);

  const pendingFocus = useRef<"trigger" | "search" | "number" | null>(null);
  useLayoutEffect(() => {
    if (live.current.open !== open) { live.current.open = open; read(); place(true); }
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "search") searchRef.current?.focus({ preventScroll: true });
    if (target === "trigger") triggerRef.current?.focus({ preventScroll: true });
    if (target === "number") { const input = inputRef.current; input?.focus({ preventScroll: true }); input?.setSelectionRange(input.value.length, input.value.length); }
  }, [open, place, read]);

  /* The highlight glides between rows on its own spring. */
  const hy = useMotionValue(0), hh = useMotionValue(0), ho = useMotionValue(0);
  const scrollIntent = useRef(false);
  useLayoutEffect(() => {
    const node = open && activeKey ? rowRefs.current.get(activeKey) : undefined;
    if (!node) { animate(ho, 0, { duration: reduced || !open ? 0 : .12, ease: standardEase }); return; }
    const top = node.offsetTop, height = node.offsetHeight;
    if (ho.get() < .05 || reduced) { hy.jump(top); hh.jump(height); } else { animate(hy, top, GLIDE); animate(hh, height, GLIDE); }
    animate(ho, 1, { duration: reduced ? 0 : .12, ease: enterEase });
    const scroller = scrollRef.current;
    if (scroller && scrollIntent.current) {
      scrollIntent.current = false;
      const pad = 6;
      if (top < scroller.scrollTop + pad) scroller.scrollTop = top - pad;
      else if (top + height > scroller.scrollTop + scroller.clientHeight - pad) scroller.scrollTop = top + height - scroller.clientHeight + pad;
    }
  }, [activeKey, hh, ho, hy, open, reduced, sections]);

  function openList(seed = "") {
    if (disabled || open) return;
    setQuery(seed);
    const selectedRow = seed ? null : sections.flatMap(section => section.rows).find(row => row.entry.iso === current.iso && !row.key.startsWith("p-")) ?? null;
    setActive(selectedRow?.key ?? null);
    scrollIntent.current = true;
    pendingFocus.current = "search";
    setAnnouncement("");
    setOpen(true);
  }
  const close = useCallback((focus: "trigger" | "number" | null) => {
    pendingFocus.current = focus;
    setOpen(false);
  }, [setOpen]);

  function pick(entry: PhoneCountry | undefined) {
    if (!entry) return;
    if (entry.iso !== current.iso) {
      setRoll(Math.sign((orderOf.get(entry.iso) ?? 0) - (orderOf.get(current.iso) ?? 0)) || 1);
      const nextDigits = capDigits(entry, digits);
      if (countryProp === undefined) setState({ iso: entry.iso, digits: nextDigits });
      else setState(last => ({ ...last, digits: nextDigits }));
      onCountryChange?.(entry.iso);
      emit(entry, nextDigits);
      setAnnouncement(`${entry.name}, +${entry.dial}`);
    }
    close("number");
  }

  function move(key: string | null | undefined) {
    if (!key) return;
    scrollIntent.current = true;
    setActive(key);
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const at = rows.findIndex(row => row.key === activeKey);
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(rows[Math.min(rows.length - 1, at + 1)]?.key); return;
      case "ArrowUp": event.preventDefault(); move(rows[Math.max(0, at - 1)]?.key); return;
      case "PageDown": event.preventDefault(); move(rows[Math.min(rows.length - 1, at + PAGE)]?.key); return;
      case "PageUp": event.preventDefault(); move(rows[Math.max(0, at - PAGE)]?.key); return;
      case "Home": if (query) return; event.preventDefault(); move(rows[0]?.key); return;
      case "End": if (query) return; event.preventDefault(); move(rows[rows.length - 1]?.key); return;
      case "Enter": event.preventDefault(); pick(rows[at]?.entry); return;
      case "Escape": event.preventDefault(); event.stopPropagation(); close("trigger"); return;
      case "Tab": close(null); return;
    }
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openList(); return; }
    if (event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); openList(event.key); }
  }

  function onQuery(next: string) {
    setQuery(next);
    setActive(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const text = next.trim().toLowerCase();
    const count = text && text !== "+" ? pool.filter(entry => matchesQuery(entry, text)).length : pool.length;
    setAnnouncement(text ? count ? `${count} ${count === 1 ? "country" : "countries"}` : "No matches" : "");
  }

  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(null); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [close, open]);

  const onRootBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !event.currentTarget.contains(next)) close(null);
  };

  const showCheck = status === "valid";
  const invalid = !!message;
  const describedBy = [description ? hintId : null, message ? errorId : null].filter(Boolean).join(" ") || undefined;
  const rootStyle = { "--pi-closed-r": `${CLOSED_RADIUS}px` } as CSSProperties;

  const face = (entry: PhoneCountry) => <>
    <span className={styles.flag} aria-hidden="true">{flagOf(entry.iso)}</span>
    <span className={styles.dial}>+{entry.dial}</span>
  </>;

  return <div ref={rootRef} className={[styles.field, className].filter(Boolean).join(" ")} style={rootStyle} data-open={open || undefined} data-disabled={disabled || undefined} onBlur={onRootBlur}>
    <label htmlFor={inputId} className={hideLabel ? styles.srOnly : styles.label}>{label}</label>

    <div ref={controlRef} className={styles.control} data-invalid={invalid || undefined}>
      <motion.div className={styles.anchor} style={{ width: anchorW }}>
        {/* Sizes the closed button: same padding and content, so the width spring has a target before anything moves. */}
        <span ref={measureRef} className={`${styles.trigger} ${styles.measure}`} aria-hidden="true">{face(current)}</span>

        <motion.div className={styles.shape} style={{ width: shapeW, height: shapeH, borderRadius: radius }}>
          <div className={styles.lid}>
            <button ref={triggerRef} type="button" className={styles.trigger} disabled={disabled} inert={open || undefined} tabIndex={open ? -1 : 0}
              aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={`Country, ${current.name} +${current.dial}`}
              onClick={() => (open ? close("trigger") : openList())} onKeyDown={onTriggerKeyDown}>
              <span className={styles.slot} data-hidden={open || undefined}>
                <AnimatePresence initial={false} custom={roll}>
                  <motion.span key={current.iso} className={styles.layer} custom={roll} variants={reduced ? layerFade : layerVariants} initial="enter" animate="rest" exit="exit"
                    transition={reduced ? { duration: .12 } : { y: GLIDE, opacity: { duration: .2, ease: enterEase }, filter: { duration: .22, ease: enterEase } }}>
                    {face(current)}
                  </motion.span>
                </AnimatePresence>
              </span>
            </button>

            <motion.div className={styles.searchRow} inert={!open || undefined} initial={false}
              animate={open ? { opacity: 1, filter: "blur(0px)" } : { opacity: 0, filter: reduced ? "blur(0px)" : `blur(${blur.subtle}px)` }}
              transition={open ? { duration: .18, ease: enterEase, delay: reduced ? 0 : .05 } : { duration: .1, ease: standardEase }}>
              <Search className={styles.searchIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
              <input ref={searchRef} className={styles.search} type="text" role="combobox" aria-label="Search countries or calling codes" aria-expanded={open} aria-controls={listId}
                aria-autocomplete="list" aria-activedescendant={open && activeKey ? optionId(activeKey) : undefined} placeholder="Country or code" value={query}
                autoComplete="off" spellCheck={false} onChange={event => onQuery(event.target.value)} onKeyDown={onSearchKeyDown} />
              <AnimatePresence initial={false}>
                {query && <motion.button key="clear" type="button" className={styles.clear} aria-label="Clear search" onPointerDown={event => event.preventDefault()}
                  onClick={() => { onQuery(""); searchRef.current?.focus(); }}
                  initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .6, transition: { duration: .1 } }} transition={reduced ? { duration: 0 } : GLIDE}>
                  <X size={14} strokeWidth={1.75} aria-hidden="true" />
                </motion.button>}
              </AnimatePresence>
              <button type="button" className={styles.closeHit} aria-label="Close country list" onClick={() => close("trigger")} />
            </motion.div>

            <motion.span className={styles.chevron} aria-hidden="true" initial={false} animate={{ rotate: open ? 180 : 0 }} transition={reduced ? { duration: 0 } : GLIDE}>
              <ChevronDown size={16} strokeWidth={1.75} />
            </motion.span>
          </div>

          <motion.div ref={listFaceRef} className={styles.listFace} inert={!open || undefined} aria-hidden={!open || undefined} initial={false}
            animate={open ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: reduced ? 0 : -6, filter: reduced ? "blur(0px)" : `blur(${blur.subtle}px)` }}
            transition={open ? { y: GROW, opacity: { duration: .2, ease: enterEase, delay: reduced ? 0 : .04 }, filter: { duration: .22, ease: enterEase, delay: .04 } } : { duration: .1, ease: standardEase }}>
            <div ref={scrollRef} className={styles.scroll}>
              <div id={listId} className={styles.options} role="listbox" aria-label="Countries">
                <motion.span className={styles.highlight} style={{ y: hy, height: hh, opacity: ho }} aria-hidden="true" />
                {sections.map(section => {
                  const body = section.rows.map(row => {
                    const selected = row.entry.iso === current.iso;
                    return <div key={row.key} id={optionId(row.key)} role="option" aria-selected={selected} className={styles.option} data-active={row.key === activeKey || undefined}
                      ref={node => { if (node) rowRefs.current.set(row.key, node); else rowRefs.current.delete(row.key); }}
                      onPointerMove={event => { if (event.pointerType === "mouse" && row.key !== activeKey) setActive(row.key); }}
                      onPointerDown={event => event.preventDefault()} onClick={() => pick(row.entry)}>
                      <span className={styles.flag} aria-hidden="true">{flagOf(row.entry.iso)}</span>
                      <span className={styles.name}>{row.entry.name}</span>
                      <span className={styles.meta}>+{row.entry.dial}</span>
                      <span className={styles.check} data-on={selected || undefined} aria-hidden="true"><Check size={16} strokeWidth={1.75} /></span>
                    </div>;
                  });
                  return section.label
                    ? <div key={section.key} role="group" aria-labelledby={`${uid}-${section.key}`} className={styles.group}>
                      <div id={`${uid}-${section.key}`} className={styles.groupLabel} role="presentation">{section.label}</div>{body}
                    </div>
                    : <div key={section.key} role="presentation" className={styles.group}>{body}</div>;
                })}
                {rows.length === 0 && <p className={styles.empty}>No countries match “{query.trim()}”</p>}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>

      <div className={styles.numberWrap}>
        <span className={styles.guide} aria-hidden="true"><span className={styles.guideTyped}>{formatted}</span>{guide}</span>
        <input ref={inputRef} id={inputId} className={styles.number} type="tel" inputMode="tel" autoComplete="tel" value={formatted} disabled={disabled} required={required}
          aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-label={hideLabel ? label : undefined}
          onChange={event => onNumberChange(event.currentTarget)} onKeyDown={onNumberKeyDown} onPaste={onPaste}
          onBlur={event => { setTouched(digits.length > 0); onBlur?.(event); }} />
        <AnimatePresence initial={false}>
          {showCheck && <motion.span key="ok" className={styles.valid} aria-hidden="true"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .6, filter: `blur(${blur.subtle}px)` }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: reduced ? 1 : .8, transition: { duration: .1 } }} transition={reduced ? { duration: .12 } : motionTokens.spring.snappy}>
            <Check size={16} strokeWidth={2} />
          </motion.span>}
        </AnimatePresence>
      </div>
    </div>

    <AnimatePresence initial={false}>{description && !message && <MessageRow key="hint" id={hintId} text={description} tone="hint" />}</AnimatePresence>
    <AnimatePresence initial={false}>{message && <MessageRow key="error" id={errorId} text={message} tone="error" />}</AnimatePresence>
    {name && <input type="hidden" name={name} value={e164} />}
    <span className={styles.srOnly} role="status" aria-live="polite">{announcement || (showCheck ? `Valid ${current.name} number` : "")}</span>
  </div>;
});

PhoneInput.displayName = "PhoneInput";

export default PhoneInput;
