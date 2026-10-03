"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from "react";
import Image, { type StaticImageData } from "next/image";
import { AnimatePresence, motion, useAnimate, useReducedMotion, type Transition, type Variants } from "motion/react";
import { ArrowRight, Bell, Check, ChevronDown } from "lucide-react";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { motionTokens } from "@/lib/motion-tokens";
import { photo } from "@/lib/media";
import styles from "./changelog-feed.module.css";

export type ChangelogKind = "new" | "improved" | "fixed";
type Kind = ChangelogKind;
export type ChangelogMedia =
  | { type: "photo"; src: StaticImageData | string; alt: string; caption: string; /** Pixel size, needed when `src` is a URL rather than an imported image. */ width?: number; height?: number }
  | { type: "code"; file: string; code: string };
type Media = ChangelogMedia;
export type ChangelogEntry = { id: string; month: string; date: string; iso: string; version: string; kind: Kind; title: string; summary: string; details: string[]; media?: Media };
export type ChangelogMonth = { key: string; label: string; short: string };
type Entry = ChangelogEntry;
type Month = ChangelogMonth;

const kinds: { id: Kind; label: string }[] = [
  { id: "new", label: "New" },
  { id: "improved", label: "Improved" },
  { id: "fixed", label: "Fixed" },
];

/** Sample photos load by URL from public/media, so the block installs without binary imports. */
const ceramics = photo("terracotta-waves"), journal = photo("alpine-lake"), bottle = photo("wine-bar"), interior = photo("living-room"), seaAtDusk = photo("sea-at-dusk");

const exampleMonths: Month[] = [
  { key: "2026-09", label: "September 2026", short: "Sep" },
  { key: "2026-08", label: "August 2026", short: "Aug" },
  { key: "2026-07", label: "July 2026", short: "Jul" },
  { key: "2026-06", label: "June 2026", short: "Jun" },
];

const webhookSnippet = `import { verifyWebhook } from "@halden/node";

const event = verifyWebhook(body, headers, secret);

if (event.type === "order.paid") {
  await fulfil(event.data.order); // ord_7Hq2Lx
}`;

const dnsSnippet = `Type    Name       Value
CNAME   shop       edge.halden.example
TXT     _halden    verify=hd_4f81c2`;

const exampleEntries: Entry[] = [
  { id: "masonry", month: "2026-09", date: "Sep 18", iso: "2026-09-18", version: "4.12.0", kind: "new", title: "Masonry gallery layout", summary: "Mix portrait and landscape work without cropping a single frame.", details: ["Choose two to five columns for each breakpoint.", "Drag an image and the columns rebalance while you move it.", "Captions fall back to the image alt text."], media: { type: "photo", src: ceramics.src, width: ceramics.width, height: ceramics.height, alt: "Wavy terracotta walls rising toward a blue sky", caption: "Gallery by Oda Lindqvist Ceramics, Bergen" } },
  { id: "resumable", month: "2026-09", date: "Sep 18", iso: "2026-09-18", version: "4.12.0", kind: "improved", title: "Uploads resume after a dropped connection", summary: "Large uploads continue from the last finished chunk instead of starting over.", details: ["Files upload in 8 MB chunks, each retried up to five times.", "The upload queue survives a page reload."] },
  { id: "currency", month: "2026-09", date: "Sep 9", iso: "2026-09-09", version: "4.11.2", kind: "fixed", title: "Discount codes stay applied after a currency switch", summary: "Switching from EUR to CHF at checkout no longer clears an applied code.", details: ["Affected 0.4% of checkouts since 4.11.0.", "Totals are now recalculated on the server after every switch."] },
  { id: "webhooks", month: "2026-09", date: "Sep 2", iso: "2026-09-02", version: "4.11.0", kind: "new", title: "Order webhooks", summary: "Receive a signed request when an order is paid, refunded, or shipped.", details: ["Every request carries a timestamped signature.", "Failed deliveries retry with backoff for 72 hours."], media: { type: "code", file: "webhooks.ts", code: webhookSnippet } },
  { id: "covers", month: "2026-08", date: "Aug 26", iso: "2026-08-26", version: "4.10.0", kind: "new", title: "Journal posts with full-bleed covers", summary: "Open a story with one photograph that runs edge to edge on every screen.", details: ["Set a focal point so the crop holds on narrow phones.", "Covers load a blurred preview first, then the full image."], media: { type: "photo", src: journal.src, width: journal.width, height: journal.height, alt: "A calm alpine lake reflecting a rocky peak at golden hour", caption: "Journal cover from Studio Varga, Budapest" } },
  { id: "avif", month: "2026-08", date: "Aug 26", iso: "2026-08-26", version: "4.10.0", kind: "improved", title: "Product pages load 38% faster on mobile", summary: "Images now ship as AVIF with responsive sizes for each device.", details: ["Median largest paint dropped from 2.9 s to 1.8 s.", "Older browsers still receive WebP or JPEG."] },
  { id: "inventory", month: "2026-08", date: "Aug 14", iso: "2026-08-14", version: "4.9.3", kind: "fixed", title: "Stock no longer goes negative during a sale", summary: "Concurrent checkouts now reserve inventory in a single step.", details: ["Two buyers can no longer purchase the last item at the same moment.", "Oversold orders from August 9 to 13 were refunded automatically."] },
  { id: "shortcuts", month: "2026-08", date: "Aug 5", iso: "2026-08-05", version: "4.9.0", kind: "improved", title: "Keyboard shortcuts in the editor", summary: "Move, duplicate, and publish blocks without reaching for the mouse.", details: ["Press ⌘K to open the command menu from anywhere.", "Press ⌘D to duplicate the selected block.", "Press ⇧⌘P to publish the current page."] },
  { id: "variants", month: "2026-07", date: "Jul 22", iso: "2026-07-22", version: "4.8.0", kind: "new", title: "Variants with their own photos", summary: "Each colour or size can show its own gallery on the product page.", details: ["The page switches photos when a buyer picks a variant.", "Variants without photos fall back to the product gallery."], media: { type: "photo", src: bottle.src, width: bottle.width, height: bottle.height, alt: "A carafe of red wine on a bar table in evening light", caption: "Carafe, 500 ml from Ferment Lab, Lyon" } },
  { id: "timezone", month: "2026-07", date: "Jul 10", iso: "2026-07-10", version: "4.7.1", kind: "fixed", title: "Scheduled posts respect the studio time zone", summary: "A post scheduled for 09:00 in Zurich no longer goes live at 09:00 UTC.", details: ["Existing schedules were corrected on July 10.", "The scheduler now shows the time zone next to every slot."] },
  { id: "domains", month: "2026-07", date: "Jul 3", iso: "2026-07-03", version: "4.7.0", kind: "improved", title: "Custom domains verify in under a minute", summary: "Add two DNS records and Halden checks them every few seconds.", details: ["Certificates are issued as soon as the records resolve.", "Verification used to take up to an hour."], media: { type: "code", file: "DNS records", code: dnsSnippet } },
  { id: "rooms", month: "2026-06", date: "Jun 24", iso: "2026-06-24", version: "4.6.0", kind: "new", title: "Shoppable room photos", summary: "Tag products directly on an interior photo and link each tag to checkout.", details: ["Tags follow the photo when it is cropped or resized.", "Up to twelve products per photo."], media: { type: "photo", src: interior.src, width: interior.width, height: interior.height, alt: "A bright living room with timber beams, arched windows, and cream sofas", caption: "Room by Maison Aubert, Montréal" } },
  { id: "csv", month: "2026-06", date: "Jun 12", iso: "2026-06-12", version: "4.5.2", kind: "fixed", title: "CSV exports keep accented names", summary: "Names like Zoë and Håkon now open correctly in every spreadsheet app.", details: ["Exports are written as UTF-8 with a byte order mark.", "Re-export any file created since 4.5.0."] },
  { id: "search", month: "2026-06", date: "Jun 3", iso: "2026-06-03", version: "4.5.0", kind: "improved", title: "Media search understands subject and colour", summary: "Type what is in the picture and the library finds it.", details: ["Search works across 40,000 images in under 200 ms.", "Results group near-duplicates so each shot appears once."], media: { type: "photo", src: seaAtDusk.src, width: seaAtDusk.width, height: seaAtDusk.height, alt: "A calm sea at dusk with a low island on the horizon", caption: "Result for “sea at dusk” in the media library" } },
];


const blurSoft = `blur(${motionTokens.blur.soft}px)`;
const blurSubtle = `blur(${motionTokens.blur.subtle}px)`;
const none = "blur(0px)";
const instant: Transition = { duration: 0 };
const exitSpring: Transition = { type: "spring", visualDuration: 0.28, bounce: 0 };

/** Values rise when they grow and fall when they shrink; the outgoing value leaves the opposite way. */
const roll: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${direction * 55}%`, filter: blurSubtle }),
  center: { opacity: 1, y: "0%", filter: none },
  exit: (direction: number) => ({ opacity: 0, y: `${direction * -55}%`, filter: blurSubtle }),
};
const rise: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: direction * 14, filter: blurSoft }),
  center: { opacity: 1, y: 0, filter: none },
  exit: (direction: number) => ({ opacity: 0, y: direction * -14, filter: blurSoft, transition: { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.standard] } }),
};

function RollingNumber({ value, reduce }: { value: number; reduce: boolean }) {
  const [state, setState] = useState({ value, direction: 1 });
  if (state.value !== value) setState({ value, direction: value > state.value ? 1 : -1 });
  return <span className={styles.roll}>
    <AnimatePresence mode="popLayout" initial={false} custom={state.direction}>
      <motion.span key={value} custom={state.direction} variants={roll} initial="enter" animate="center" exit="exit" transition={reduce ? instant : motionTokens.spring.snappy}>{value}</motion.span>
    </AnimatePresence>
  </span>;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
type SubscribeState = "idle" | "editing" | "done";

/** One pill that becomes a field, then a confirmation. The shell morphs its width; the content swaps a beat later inside it. */
function SubscribeControl({ reduce }: { reduce: boolean }) {
  const inputId = useId();
  const [state, setState] = useState<SubscribeState>("idle");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idleRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef(false);
  const [shakeScope, animate] = useAnimate<HTMLDivElement>();

  useEffect(() => {
    const element = innerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.offsetWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    const target = state === "editing" ? inputRef.current : state === "done" ? undoRef.current : idleRef.current;
    target?.focus({ preventScroll: true });
  }, [state]);

  function go(next: SubscribeState, focus = true) { focusNext.current = focus; setState(next); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailPattern.test(email.trim())) {
      setError(true);
      if (!reduce && shakeScope.current) animate(shakeScope.current, { x: [0, -6, 5, -3, 2, 0] }, { duration: motionTokens.duration.considered, ease: [...motionTokens.ease.standard] });
      inputRef.current?.focus();
      return;
    }
    setError(false);
    go("done");
  }
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) { if (event.key === "Escape") { setError(false); go("idle"); } }
  function onBlur(event: FocusEvent<HTMLFormElement>) { if (!event.currentTarget.contains(event.relatedTarget) && !email.trim()) { setError(false); go("idle", false); } }
  function undo() { setEmail(""); go("idle"); }

  const swap: Transition = reduce ? { duration: motionTokens.duration.instant } : { opacity: { duration: motionTokens.duration.fast, delay: 0.05 }, filter: { duration: motionTokens.duration.fast, delay: 0.05 }, scale: { ...motionTokens.spring.morph, delay: 0.03 } };
  const leave = { opacity: 0, scale: 0.96, filter: blurSubtle, transition: { duration: motionTokens.duration.instant } };
  const note = error ? "Enter a valid email address" : state === "done" ? "Subscribed." : "";

  return <div className={styles.subscribeWrap}>
    <div ref={shakeScope}>
      <motion.div className={styles.subscribe} data-state={state} data-error={error || undefined} initial={false} animate={{ width: width ?? "auto" }} transition={reduce ? instant : motionTokens.spring.morph}>
        <div ref={innerRef} className={styles.subscribeInner}>
          <AnimatePresence mode="popLayout" initial={false}>
            {state === "idle" && <motion.button key="idle" ref={idleRef} type="button" className={styles.subscribeIdle} onClick={() => go("editing")} initial={{ opacity: 0, scale: 0.96, filter: blurSubtle }} animate={{ opacity: 1, scale: 1, filter: none }} exit={leave} transition={swap}>
              <Bell size={14} aria-hidden="true" />Subscribe
            </motion.button>}
            {state === "editing" && <motion.form key="form" className={styles.subscribeForm} noValidate onSubmit={submit} onKeyDown={onKeyDown} onBlur={onBlur} initial={{ opacity: 0, scale: 0.96, filter: blurSubtle }} animate={{ opacity: 1, scale: 1, filter: none }} exit={leave} transition={swap}>
              <label className={styles.srOnly} htmlFor={inputId}>Email address</label>
              <input ref={inputRef} id={inputId} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} aria-invalid={error || undefined} onChange={(event) => { setEmail(event.target.value); if (error) setError(false); }} />
              <button type="submit" className={styles.subscribeSubmit} aria-label="Subscribe to release notes"><ArrowRight size={14} /></button>
            </motion.form>}
            {state === "done" && <motion.div key="done" className={styles.subscribeDone} initial={{ opacity: 0, scale: 0.96, filter: blurSubtle }} animate={{ opacity: 1, scale: 1, filter: none }} exit={leave} transition={swap}>
              <svg className={styles.drawnCheck} width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <motion.path d="M4 12.5l5 5L20 6.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={reduce ? instant : { duration: 0.42, ease: [...motionTokens.ease.standard], delay: 0.12 }} />
              </svg>
              <span>Subscribed</span>
              <button ref={undoRef} type="button" className={styles.subscribeUndo} onClick={undo} aria-label={`Undo subscription for ${email.trim()}`}>Undo</button>
            </motion.div>}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
    <p className={styles.subscribeNote} data-error={error || undefined} role="status" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        {note && <motion.span key={note} initial={{ opacity: 0, y: -4, filter: blurSubtle }} animate={{ opacity: 1, y: 0, filter: none }} exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }} transition={reduce ? instant : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{note}</motion.span>}
      </AnimatePresence>
    </p>
  </div>;
}

function EntryMedia({ media }: { media: Media }) {
  if (media.type === "photo") {
    return <figure className={styles.photo}>
      <div className={styles.photoFrame}>{typeof media.src === "string"
        ? <Image src={media.src} alt={media.alt} width={media.width ?? 1600} height={media.height ?? 1067} sizes="(max-width: 700px) 100vw, 560px" />
        : <Image src={media.src} alt={media.alt} placeholder="blur" sizes="(max-width: 700px) 100vw, 560px" />}</div>
      <figcaption>{media.caption}</figcaption>
    </figure>;
  }
  return <div className={styles.code}>
    <div className={styles.codeHead}><span>{media.file}</span><CopyButton value={media.code} label={`Copy ${media.file}`} iconOnly variant="plain" /></div>
    <pre><code>{media.code}</code></pre>
  </div>;
}

function EntryRow({ entry, open, onToggle, reduce }: { entry: Entry; open: boolean; onToggle: () => void; reduce: boolean }) {
  const panelId = useId();
  const kind = kinds.find((item) => item.id === entry.kind)!;
  const layout: Transition = reduce ? instant : motionTokens.spring.smooth;
  return <motion.li
    layout="position"
    className={styles.entry}
    data-open={open || undefined}
    initial={reduce ? { opacity: 0 } : { opacity: 0, filter: blurSubtle }}
    animate={{ opacity: 1, filter: none }}
    exit={reduce ? { opacity: 0, transition: { duration: motionTokens.duration.instant } } : { opacity: 0, scale: 0.98, filter: blurSubtle, transition: { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.standard] } }}
    transition={reduce ? { duration: 0, opacity: { duration: motionTokens.duration.instant } } : { opacity: { duration: motionTokens.duration.standard }, filter: { duration: motionTokens.duration.standard }, layout }}
  >
    <button type="button" className={styles.row} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
      <span className={styles.meta}>
        <time dateTime={entry.iso}>{entry.date}</time>
        <span className={styles.version}>v{entry.version}</span>
      </span>
      <span className={styles.body}>
        <span className={styles.kind} data-kind={entry.kind}><i aria-hidden="true" />{kind.label}</span>
        <span className={styles.title}>{entry.title}</span>
        <span className={styles.summary}>{entry.summary}</span>
      </span>
      <motion.span className={styles.chevron} aria-hidden="true" initial={false} animate={{ rotate: open ? 180 : 0 }} transition={reduce ? instant : motionTokens.spring.snappy}><ChevronDown size={16} /></motion.span>
    </button>
    <AnimatePresence initial={false}>
      {open && <motion.div key="panel" id={panelId} className={styles.panel} initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0, transition: reduce ? instant : exitSpring }} transition={reduce ? instant : motionTokens.spring.smooth}>
        <motion.div
          className={styles.panelInner}
          initial={{ opacity: 0, y: 8, filter: blurSoft }}
          animate={{ opacity: 1, y: 0, filter: none }}
          exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }}
          transition={reduce ? { duration: 0, opacity: { duration: motionTokens.duration.instant } } : { y: { ...motionTokens.spring.smooth, delay: 0.06 }, opacity: { duration: motionTokens.duration.standard, delay: 0.06 }, filter: { duration: motionTokens.duration.standard, delay: 0.06 } }}
        >
          <ul className={styles.details}>{entry.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          {entry.media && <EntryMedia media={entry.media} />}
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  </motion.li>;
}

export interface ChangelogFeedProps {
  /** Release notes, newest first. Each entry belongs to one of `months` by key. */
  entries?: ChangelogEntry[];
  /** Months shown in the month bar, newest first. */
  months?: ChangelogMonth[];
  title?: string;
  /** One line under the title, such as the latest release. */
  subtitle?: string;
  /** Closing line at the end of the list. */
  endNote?: string;
  /** Entry ids open on first render. Defaults to the newest entry. */
  defaultOpen?: string[];
  className?: string;
}

export function ChangelogFeed({
  entries = exampleEntries,
  months = exampleMonths,
  title = "Changelog",
  subtitle = "Halden 4.12 shipped on September 18, 2026",
  endNote = "That is everything since Halden 4.5 in June.",
  defaultOpen,
  className,
}: ChangelogFeedProps = {}) {
  const uid = useId();
  const totalCount = entries.length;
  const kindCounts = useMemo(() => kinds.reduce<Record<Kind, number>>((counts, kind) => ({ ...counts, [kind.id]: entries.filter((entry) => entry.kind === kind.id).length }), { new: 0, improved: 0, fixed: 0 }), [entries]);
  const monthOrder = useCallback((key: string) => months.findIndex((month) => month.key === key), [months]);
  const reduce = useReducedMotion() ?? false;
  const [filters, setFilters] = useState<Kind[]>([]);
  const [open, setOpen] = useState<string[]>(() => defaultOpen ?? (entries[0] ? [entries[0].id] : []));
  const [active, setActive] = useState({ key: months[0].key, direction: 1 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const frame = useRef(0);

  const visible = useMemo(() => entries.filter((entry) => filters.length === 0 || filters.includes(entry.kind)), [entries, filters]);
  const groups = useMemo(() => months.map((month) => ({ ...month, items: visible.filter((entry) => entry.month === month.key) })).filter((group) => group.items.length > 0), [months, visible]);
  const current = groups.find((group) => group.key === active.key) ?? groups[0];

  const sync = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || groups.length === 0) return;
    const line = scroller.getBoundingClientRect().top + 28;
    let key = groups[0].key;
    for (const group of groups) {
      const element = groupRefs.current.get(group.key);
      if (element && element.getBoundingClientRect().top <= line) key = group.key;
    }
    if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) key = groups[groups.length - 1].key;
    setActive((previous) => previous.key === key ? previous : { key, direction: monthOrder(key) > monthOrder(previous.key) ? 1 : -1 });
  }, [groups, monthOrder]);

  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; sync(); });
  }, [sync]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => onScroll());
    observer.observe(list);
    return () => observer.disconnect();
  }, [onScroll]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function toggleFilter(kind: Kind) { setFilters((previous) => previous.includes(kind) ? previous.filter((item) => item !== kind) : [...previous, kind]); }
  function toggleEntry(id: string) { setOpen((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]); }
  function jumpTo(key: string) {
    const scroller = scrollRef.current;
    const element = groupRefs.current.get(key);
    if (!scroller || !element) return;
    const top = scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: Math.max(0, top - 1), behavior: reduce ? "auto" : "smooth" });
  }

  const shownLabel = filters.length === 0 ? `${totalCount} updates` : `${visible.length} of ${totalCount} updates`;
  const layout: Transition = reduce ? instant : motionTokens.spring.smooth;

  return <section className={[styles.feed, className].filter(Boolean).join(" ")} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2 id={`${uid}-title`}>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <SubscribeControl reduce={reduce} />
    </header>

    <div className={styles.toolbar}>
      <div className={styles.chips} role="group" aria-label="Filter by type">
        {kinds.map((kind) => {
          const on = filters.includes(kind.id);
          return <button key={kind.id} type="button" className={styles.chip} data-kind={kind.id} aria-pressed={on} onClick={() => toggleFilter(kind.id)}>
            <motion.span className={styles.chipMark} aria-hidden="true" initial={false} animate={{ width: on ? 16 : 7, height: on ? 16 : 7 }} transition={reduce ? instant : motionTokens.spring.morph}>
              <motion.span className={styles.chipTick} initial={false} animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.4 }} transition={reduce ? instant : { ...motionTokens.spring.snappy, delay: on ? 0.05 : 0 }}><Check size={11} strokeWidth={2.6} /></motion.span>
            </motion.span>
            <span>{kind.label}</span>
            <span className={styles.chipCount}>{kindCounts[kind.id]}</span>
          </button>;
        })}
        <AnimatePresence initial={false}>
          {filters.length > 0 && <motion.button key="clear" type="button" className={styles.clear} onClick={() => setFilters([])} initial={{ opacity: 0, x: -6, filter: blurSubtle }} animate={{ opacity: 1, x: 0, filter: none }} exit={{ opacity: 0, x: -4, filter: blurSubtle, transition: { duration: motionTokens.duration.instant } }} transition={reduce ? instant : motionTokens.spring.snappy}>Show all</motion.button>}
        </AnimatePresence>
      </div>
      <p className={styles.shown} aria-hidden="true">
        <motion.span className={styles.shownCount} layout="position" transition={layout}><RollingNumber value={visible.length} reduce={reduce} /></motion.span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={filters.length === 0 ? "all" : "some"} initial={{ opacity: 0, filter: blurSubtle }} animate={{ opacity: 1, filter: none }} exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }} transition={reduce ? instant : { duration: motionTokens.duration.standard }}>{filters.length === 0 ? "updates" : `of ${totalCount} updates`}</motion.span>
        </AnimatePresence>
      </p>
      <p className={styles.srOnly} role="status" aria-live="polite">{`Showing ${shownLabel}`}</p>
    </div>

    <div className={styles.monthBar}>
      <div className={styles.monthLabel} aria-hidden="true">
        <span className={styles.monthText}>
          <AnimatePresence mode="popLayout" initial={false} custom={active.direction}>
            <motion.span key={current?.key ?? "none"} custom={active.direction} variants={rise} initial="enter" animate="center" exit="exit" transition={reduce ? instant : motionTokens.spring.morph}>{current ? <>{current.label.split(" ")[0]}<span className={styles.monthYear}> {current.label.split(" ")[1]}</span></> : "No updates"}</motion.span>
          </AnimatePresence>
        </span>
        <motion.span className={styles.monthCount} layout="position" transition={layout}><RollingNumber value={current?.items.length ?? 0} reduce={reduce} />{current?.items.length === 1 ? "update" : "updates"}</motion.span>
      </div>
      <nav className={styles.monthNav} aria-label="Jump to month">
        {groups.map((group) => {
          const selected = group.key === current?.key;
          return <button key={group.key} type="button" aria-label={`Jump to ${group.label}`} aria-current={selected ? "true" : undefined} onClick={() => jumpTo(group.key)}>
            {selected && <motion.span layoutId={`${uid}-month`} className={styles.monthPill} transition={reduce ? instant : motionTokens.spring.morph} />}
            <span className={styles.monthShort}>{group.short}</span>
          </button>;
        })}
      </nav>
    </div>

    <motion.div layoutScroll ref={scrollRef} className={styles.scroller} onScroll={onScroll} tabIndex={0} aria-label="Release notes">
      <div ref={listRef} className={styles.list}>
        <AnimatePresence mode="popLayout" initial={false}>
          {groups.map((group, index) => <motion.section
            key={group.key}
            layout="position"
            className={styles.group}
            aria-labelledby={`${uid}-${group.key}`}
            ref={(element: HTMLElement | null) => { if (element) groupRefs.current.set(group.key, element); else groupRefs.current.delete(group.key); }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: motionTokens.duration.exit } }}
            transition={{ layout, opacity: { duration: reduce ? motionTokens.duration.instant : motionTokens.duration.standard } }}
          >
            <h3 id={`${uid}-${group.key}`} className={index === 0 ? styles.srOnly : styles.groupTitle}>{group.label}</h3>
            <ul className={styles.entries}>
              <AnimatePresence mode="popLayout" initial={false}>
                {group.items.map((entry) => <EntryRow key={entry.id} entry={entry} open={open.includes(entry.id)} onToggle={() => toggleEntry(entry.id)} reduce={reduce} />)}
              </AnimatePresence>
            </ul>
          </motion.section>)}
        </AnimatePresence>
        <motion.p layout="position" transition={{ layout }} className={styles.endCap}>{endNote}</motion.p>
      </div>
    </motion.div>
  </section>;
}

export default ChangelogFeed;
