"use client";

import { forwardRef, useId, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { ArrowRight, Plus } from "lucide-react";
import { SearchField } from "@/registry/components/search-field/search-field";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./faq-section.module.css";

export type FaqSectionVariant = "accordion" | "columns" | "search";

export interface FaqItem {
  /** Stable id used for open state. Defaults to the question. */
  id?: string;
  question: string;
  /** Plain text answer; it is also what search matches. */
  answer: string;
  /** Groups questions in the columns variant. */
  category?: string;
}

export interface FaqSectionProps {
  /** `accordion` is one centered list, `columns` groups questions beside a category rail, `search` filters as you type. */
  variant?: FaqSectionVariant;
  title?: string;
  description?: string;
  items?: FaqItem[];
  /** Allow several answers open at once. Defaults to false. */
  multiple?: boolean;
  /** Open item ids (controlled). */
  value?: string[];
  /** Initially open item ids when uncontrolled. */
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Active category in the columns variant (controlled). */
  category?: string;
  onCategoryChange?: (category: string) => void;
  /** Search text in the search variant (controlled). */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** A way to reach a person when the answer isn't here. Pass null to hide it. */
  contact?: { label: string; description?: string; href?: string; onClick?: () => void } | null;
  className?: string;
}

type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;
const { duration } = motionTokens;

export const faqExampleItems: FaqItem[] = [
  { question: "What is Arc?", answer: "Arc is a library of React components and blocks built on Motion and Radix. You copy the source into your project, so every line is yours to change.", category: "General" },
  { question: "Does it work with my design system?", answer: "Yes. Components read semantic tokens such as surface, border, and accent, so mapping them to your palette takes one stylesheet.", category: "General" },
  { question: "Is reduced motion supported?", answer: "Every animation has a reduced motion branch. It keeps the final state, focus, and feedback while removing travel and looping.", category: "General" },
  { question: "Which frameworks are supported?", answer: "Arc targets React 19 and Next.js 16. The components are client components and also run in Vite and React Router apps.", category: "Technical" },
  { question: "How do I install a component?", answer: "Run the shadcn CLI with the component name, or copy the files by hand. Each page lists the packages it needs.", category: "Technical" },
  { question: "How do updates work?", answer: "New components and fixes ship in small releases. Run the CLI again to pull the latest version of anything you installed.", category: "Technical" },
  { question: "Can I use Arc in client projects?", answer: "Yes. Free components are MIT licensed, and a Pro license covers commercial work for you or your team.", category: "Licensing" },
  { question: "What happens when my plan ends?", answer: "You keep every component you installed. Renewing only matters for new releases and updates.", category: "Licensing" },
];

const keyOf = (item: FaqItem) => item.id ?? item.question;
const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Wraps each match of `query` in a mark, keeping the original casing. */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = normalize(query.trim());
  if (!needle) return <>{text}</>;
  const haystack = normalize(text);
  const parts: ReactNode[] = [];
  let from = 0, at = haystack.indexOf(needle);
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at} className={styles.mark}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
    at = haystack.indexOf(needle, from);
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** A short window of the answer around the first match, for closed items that match only in their answer. */
function snippet(answer: string, query: string) {
  const at = normalize(answer).indexOf(normalize(query.trim()));
  if (at < 0) return null;
  const start = Math.max(0, answer.lastIndexOf(" ", Math.max(0, at - 36)) + 1);
  const end = Math.min(answer.length, at + query.length + 60);
  return `${start > 0 ? "…" : ""}${answer.slice(start, end).trim()}${end < answer.length ? "…" : ""}`;
}

const panelVariants: Variants = {
  open: { height: "auto", opacity: 1, transition: { height: motionTokens.spring.smooth, opacity: { duration: duration.fast, ease: enter } } },
  closed: { height: 0, opacity: 0, transition: { height: motionTokens.spring.smooth, opacity: { duration: duration.instant, ease: standard } } },
};
const contentVariants: Variants = {
  open: { y: 0, filter: "blur(0px)", transition: { y: motionTokens.spring.smooth, filter: { duration: duration.fast, ease: enter } } },
  closed: { y: -6, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: duration.instant, ease: standard } },
};
const reducedPanel: Variants = { open: { height: "auto", opacity: 1, transition: { duration: 0 } }, closed: { height: 0, opacity: 0, transition: { duration: 0 } } };

/** Arrow keys, Home, and End move between the questions of one list. */
function onListKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const triggers = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-faq-trigger]"));
  const index = triggers.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? triggers.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + triggers.length) % triggers.length;
  triggers[next].focus();
}

function Question({ item, open, onToggle, query = "", reduced, baseId, layout }: { item: FaqItem; open: boolean; onToggle: () => void; query?: string; reduced: boolean; baseId: string; layout?: boolean }) {
  const key = keyOf(item);
  const safe = `${baseId}-${key.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hint = query && !open && !normalize(item.question).includes(normalize(query.trim())) ? snippet(item.answer, query) : null;
  return <motion.li className={styles.item} data-open={open ? "" : undefined}
    layout={layout && !reduced ? "position" : false}
    initial={layout ? (reduced ? { opacity: 0 } : { opacity: 0, height: 0 }) : false}
    animate={{ opacity: 1, height: "auto" }}
    exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: { height: motionTokens.spring.smooth, opacity: { duration: duration.instant } } }}
    transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: duration.fast }, layout: motionTokens.spring.smooth }}>
    <h3 className={styles.heading}>
      <button type="button" id={`${safe}-q`} className={styles.trigger} data-faq-trigger="" aria-expanded={open} aria-controls={`${safe}-a`} onClick={onToggle}>
        <span className={styles.question}><Highlight text={item.question} query={query} /></span>
        <Plus className={styles.icon} size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </h3>
    <AnimatePresence initial={false}>
      {hint && <motion.p key="hint" className={styles.hint} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: duration.fast } }}>
        <Highlight text={hint} query={query} />
      </motion.p>}
    </AnimatePresence>
    <AnimatePresence initial={false}>
      {open && <motion.div key="answer" id={`${safe}-a`} role="region" aria-labelledby={`${safe}-q`} className={styles.panel} variants={reduced ? reducedPanel : panelVariants} initial="closed" animate="open" exit="closed">
        <motion.p className={styles.answer} variants={reduced ? undefined : contentVariants}><Highlight text={item.answer} query={query} /></motion.p>
      </motion.div>}
    </AnimatePresence>
  </motion.li>;
}

function Contact({ contact }: { contact: NonNullable<FaqSectionProps["contact"]> }) {
  const inner = <><span className={styles.contactText}><span>{contact.label}</span>{contact.description && <span>{contact.description}</span>}</span><ArrowRight className={styles.contactArrow} size={16} strokeWidth={1.75} aria-hidden="true" /></>;
  return contact.href
    ? <a className={styles.contact} href={contact.href} onClick={contact.onClick}>{inner}</a>
    : <button type="button" className={styles.contact} onClick={contact.onClick}>{inner}</button>;
}

/**
 * A frequently asked questions section in three layouts: one centered accordion, a category rail beside its questions,
 * and a searchable list that filters and highlights as you type. Answers open on a height spring with the icon turning
 * to a close mark; arrow keys move between questions.
 */
export const FaqSection = forwardRef<HTMLElement, FaqSectionProps>(function FaqSection({
  variant = "accordion",
  title = "Frequently asked questions",
  description = "Everything you need to know before you install your first component.",
  items = faqExampleItems,
  multiple = false,
  value,
  defaultValue,
  onValueChange,
  category: categoryProp,
  onCategoryChange,
  query: queryProp,
  onQueryChange,
  contact = { label: "Still have a question?", description: "Our team replies within a day." },
  className,
}, ref) {
  const id = useId();
  const reduced = !!useReducedMotion();
  const [innerOpen, setInnerOpen] = useState<string[]>(defaultValue ?? (items[0] ? [keyOf(items[0])] : []));
  const open = value ?? innerOpen;
  const categories = useMemo(() => Array.from(new Set(items.map(item => item.category ?? "General"))), [items]);
  const [innerCategory, setInnerCategory] = useState(categories[0] ?? "General");
  const activeCategory = categoryProp ?? innerCategory;
  const [direction, setDirection] = useState(0);
  const [innerQuery, setInnerQuery] = useState("");
  const query = queryProp ?? innerQuery;

  const setOpen = (next: string[]) => { if (value === undefined) setInnerOpen(next); onValueChange?.(next); };
  const toggle = (key: string) => setOpen(open.includes(key) ? open.filter(entry => entry !== key) : multiple ? [...open, key] : [key]);
  const chooseCategory = (next: string) => {
    if (next === activeCategory) return;
    setDirection(Math.sign(categories.indexOf(next) - categories.indexOf(activeCategory)));
    if (categoryProp === undefined) setInnerCategory(next);
    onCategoryChange?.(next);
  };
  const setQuery = (next: string) => { if (queryProp === undefined) setInnerQuery(next); onQueryChange?.(next); };

  const needle = normalize(query.trim());
  const results = variant === "search" && needle ? items.filter(item => normalize(`${item.question} ${item.answer}`).includes(needle)) : items;
  const heading = <div className={styles.intro}>
    <h2 id={`${id}-title`} className={styles.title}>{title}</h2>
    {description && <p className={styles.description}>{description}</p>}
  </div>;
  const list = (entries: FaqItem[], layout = false) => <ul className={styles.list} onKeyDown={onListKeyDown}>
    <AnimatePresence initial={false}>
      {entries.map(item => <Question key={keyOf(item)} item={item} open={open.includes(keyOf(item))} onToggle={() => toggle(keyOf(item))} query={variant === "search" ? query : ""} reduced={reduced} baseId={id} layout={layout} />)}
    </AnimatePresence>
  </ul>;

  return <section ref={ref} className={[styles.faq, styles[variant], className].filter(Boolean).join(" ")} aria-labelledby={`${id}-title`}>
    {variant === "accordion" && <div className={styles.stack}>
      {heading}
      {list(items)}
      {contact && <Contact contact={contact} />}
    </div>}

    {variant === "columns" && <div className={styles.columnsGrid}>
      <div className={styles.rail}>
        {heading}
        <LayoutGroup id={`${id}-rail`}>
          <div className={styles.categories} role="group" aria-label="Question topics">
            {categories.map(entry => {
              const count = items.filter(item => (item.category ?? "General") === entry).length;
              return <button key={entry} type="button" className={styles.category} aria-pressed={entry === activeCategory} onClick={() => chooseCategory(entry)}>
                {entry === activeCategory && <motion.span layoutId="category" className={styles.categoryHighlight} transition={reduced ? { duration: 0 } : motionTokens.spring.morph} aria-hidden="true" />}
                <span>{entry}</span><span className={styles.count}>{count}</span>
              </button>;
            })}
          </div>
        </LayoutGroup>
        {contact && <Contact contact={contact} />}
      </div>
      <div className={styles.stage}>
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div key={activeCategory} className={styles.stageFace} custom={direction}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: direction * 16, filter: `blur(${motionTokens.blur.subtle}px)` }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: direction * -12, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: duration.instant, ease: standard } }}
            transition={reduced ? { duration: 0 } : { y: motionTokens.spring.smooth, opacity: { duration: duration.fast, ease: enter }, filter: { duration: duration.fast, ease: enter } }}>
            {list(items.filter(item => (item.category ?? "General") === activeCategory))}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>}

    {variant === "search" && <div className={styles.stack}>
      {heading}
      <div className={styles.searchRow}>
        <SearchField label="Search questions" placeholder="Try install, license, or motion" value={query} onValueChange={setQuery} />
        <p className={styles.resultCount} aria-live="polite">{needle ? `${results.length} ${results.length === 1 ? "answer" : "answers"}` : `${items.length} questions`}</p>
      </div>
      {list(results, true)}
      <AnimatePresence initial={false}>
        {needle && results.length === 0 && <motion.div key="empty" className={styles.empty}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: duration.instant } }}
          transition={{ duration: reduced ? 0 : duration.standard, ease: enter }}>
          <p>No answers mention “{query.trim()}”.</p>
          <button type="button" className={styles.clear} onClick={() => setQuery("")}>Clear search</button>
        </motion.div>}
      </AnimatePresence>
      {contact && <Contact contact={contact} />}
    </div>}
  </section>;
});

FaqSection.displayName = "FaqSection";

const variantOptions = [{ value: "accordion", label: "Accordion" }, { value: "columns", label: "Two column" }, { value: "search", label: "Searchable" }];

/** Preview: the FAQ with a switch between its three layouts. */
export function FaqSectionBlock({ variant: initial = "accordion" }: { variant?: FaqSectionVariant }) {
  const [variant, setVariant] = useState<FaqSectionVariant>(initial);
  const [asked, setAsked] = useState(false);
  return <div className={styles.preview}>
    <SegmentedControl label="FAQ layout" options={variantOptions} value={variant} onValueChange={next => setVariant(next as FaqSectionVariant)} />
    <div className={styles.frame}>
      <FaqSection key={variant} variant={variant} contact={{ label: asked ? "Message sent to support" : "Still have a question?", description: asked ? "Hannah will reply within a day." : "Our team replies within a day.", onClick: () => setAsked(true) }} />
    </div>
  </div>;
}

export default FaqSectionBlock;
