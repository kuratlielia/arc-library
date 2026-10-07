"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Check, Minus } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import { comparisonColumns, comparisonSections } from "./comparison-table-data";
import type { ComparisonColumn, ComparisonSection, ComparisonValue } from "./comparison-table-data";
import styles from "./comparison-table.module.css";

export type { ComparisonColumn, ComparisonRow, ComparisonSection, ComparisonValue } from "./comparison-table-data";

export interface ComparisonTableProps {
  title?: string;
  description?: string;
  columns?: ComparisonColumn[];
  sections?: ComparisonSection[];
  /** Hide rows where every visible column has the same value (controlled). */
  differencesOnly?: boolean;
  defaultDifferencesOnly?: boolean;
  onDifferencesOnlyChange?: (value: boolean) => void;
  /** Competitor shown beside yours in the stacked phone layout (controlled). */
  compareWith?: string;
  onCompareWithChange?: (id: string) => void;
  /** Call to action in your column. */
  cta?: { label: string; href?: string; onClick?: () => void; doneLabel?: string };
  /** Offset for the sticky header, such as the height of a fixed site header. Defaults to 0. */
  stickyTop?: number;
  /** Caps the table height and scrolls it inside the block, with the header sticking to its top. */
  maxHeight?: number | string;
  /** Width below which the table stacks into a two column comparison. Defaults to 640. */
  stackBelow?: number;
  className?: string;
}

const snappy = motionTokens.spring.snappy;
const smooth = motionTokens.spring.smooth;
const morph = motionTokens.spring.morph;

function useControllable<T>(value: T | undefined, initial: T, onChange?: (next: T) => void) {
  const [inner, setInner] = useState(initial);
  const current = value !== undefined ? value : inner;
  const set = (next: T) => { if (value === undefined) setInner(next); onChange?.(next); };
  return [current, set] as const;
}

function normalize(value: ComparisonValue | undefined) {
  if (value === undefined) return { value: false as const, note: undefined };
  if (typeof value === "object") return value;
  return { value, note: undefined };
}
const keyOf = (value: ComparisonValue | undefined) => { const item = normalize(value); return `${item.value}`; };

function Mark({ value, own, index, reduced }: { value: ComparisonValue | undefined; own: boolean; index: number; reduced: boolean }) {
  const { value: v, note } = normalize(value);
  if (typeof v === "string" && v !== "partial") return <span className={styles.text}>{v}</span>;
  if (v === true) return <span className={styles.markWrap}>
    <svg className={styles.check} data-own={own || undefined} width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" />
      <motion.path d="M6.6 11.3l3 3 5.9-6.4" initial={reduced ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true, amount: 1 }} transition={{ duration: motionTokens.duration.considered, ease: [...motionTokens.ease.enter], delay: own ? .06 + Math.min(index, 12) * .035 : 0 }} />
    </svg>
    <span className={styles.srOnly}>Included</span>
  </span>;
  if (v === "partial") return <span className={styles.markWrap}>
    <svg className={styles.partial} width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9.25" /><path d="M11 1.75a9.25 9.25 0 0 1 0 18.5z" /></svg>
    <span className={styles.srOnly}>Partial</span>
    {note && <span className={styles.note}>{note}</span>}
  </span>;
  return <span className={styles.markWrap}><Minus className={styles.cross} size={18} strokeWidth={1.75} aria-hidden="true" /><span className={styles.srOnly}>Not included</span></span>;
}

export function ComparisonTable({
  title = "How Relay compares",
  description = "Everything a growing team needs, without the enterprise price or the spreadsheet sprawl.",
  columns = comparisonColumns,
  sections = comparisonSections,
  differencesOnly: differencesProp,
  defaultDifferencesOnly = false,
  onDifferencesOnlyChange,
  compareWith: compareProp,
  onCompareWithChange,
  cta,
  stickyTop = 0,
  maxHeight,
  stackBelow = 640,
  className,
}: ComparisonTableProps) {
  const reduced = Boolean(useReducedMotion());
  const uid = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [differencesOnly, setDifferencesOnly] = useControllable(differencesProp, defaultDifferencesOnly, onDifferencesOnlyChange);
  const own = columns.find(column => column.highlight) ?? columns[0]!;
  const others = columns.filter(column => column !== own);
  const [compareWith, setCompareWith] = useControllable(compareProp, others[0]?.id ?? own.id, onCompareWithChange);
  const [ctaDone, setCtaDone] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setNarrow(entry.contentRect.width < stackBelow); });
    observer.observe(node);
    return () => observer.disconnect();
  }, [stackBelow]);

  const visible = narrow ? columns.filter(column => column === own || column.id === compareWith) : columns;
  const differs = (values: Record<string, ComparisonValue>) => new Set(visible.map(column => keyOf(values[column.id]))).size > 1;
  const gridStyle = { "--columns": visible.length, "--sticky-top": `${stickyTop}px` } as CSSProperties;
  let rowIndex = 0;

  const header = <div role="row" className={styles.headRow}>
    <div role="columnheader" className={styles.headFeature}><span className={styles.srOnly}>Feature</span></div>
    {visible.map(column => <div key={column === own ? "own" : narrow ? "other" : column.id} role="columnheader" className={styles.headCell} data-own={column === own || undefined}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={column.id} className={styles.headText} initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={smooth}>
          <span className={styles.headName}>{column.name}</span>
          {column.caption && <span className={styles.headCaption}>{column.caption}</span>}
        </motion.span>
      </AnimatePresence>
    </div>)}
  </div>;

  return <section ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} aria-labelledby={`${uid}-title`} data-narrow={narrow || undefined}>
    <div className={styles.inner}>
      <header className={styles.header}>
        <div className={styles.intro}>
          <h2 id={`${uid}-title`} className={styles.title}>{title}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        <label className={styles.toggle}>
          <span>Only differences</span>
          <input type="checkbox" role="switch" checked={differencesOnly} onChange={event => setDifferencesOnly(event.target.checked)} />
          <span className={styles.switch} aria-hidden="true"><span className={styles.thumb} /></span>
        </label>
      </header>

      {narrow && others.length > 1 && <div className={styles.picker} role="group" aria-label={`Compare ${own.name} with`}>
        <LayoutGroup id={`${uid}-picker`}>
          {others.map(column => <button key={column.id} type="button" className={styles.pick} aria-pressed={column.id === compareWith} onClick={() => setCompareWith(column.id)}>
            {column.id === compareWith && <motion.span layoutId="pick" className={styles.pickHighlight} transition={reduced ? { duration: 0 } : morph} />}
            <span>{column.name}</span>
          </button>)}
        </LayoutGroup>
      </div>}

      <div className={styles.scroller} style={maxHeight !== undefined ? { maxHeight, overflowY: "auto" } : undefined} tabIndex={maxHeight !== undefined ? 0 : undefined} aria-label={maxHeight !== undefined ? title : undefined} role={maxHeight !== undefined ? "region" : undefined}>
        <div role="table" aria-labelledby={`${uid}-title`} className={styles.table} style={gridStyle}>
          <div role="rowgroup" className={styles.head}>{header}</div>
          {sections.map(section => {
            const rows = differencesOnly ? section.rows.filter(row => differs(row.values)) : section.rows;
            return <div role="rowgroup" key={section.id} className={styles.section}>
              <AnimatePresence initial={false}>
                {rows.length > 0 && <motion.div key="title" role="row" className={styles.sectionRow} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : smooth}>
                  <div role="rowheader" className={styles.sectionTitle}>{section.title}</div>
                  {visible.map(column => <div key={column.id} role="cell" className={styles.band} data-own={column === own || undefined} />)}
                </motion.div>}
                {rows.map(row => {
                  const index = rowIndex++;
                  return <motion.div key={row.id} role="row" className={styles.row} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : smooth}>
                    <div role="rowheader" className={styles.feature}>
                      <span>{row.feature}</span>
                      {row.hint && <span className={styles.hint}>{row.hint}</span>}
                    </div>
                    {visible.map(column => <div key={column === own ? "own" : narrow ? "other" : column.id} role="cell" className={styles.cell} data-own={column === own || undefined}>
                      <AnimatePresence mode="popLayout" initial={false}>
                        <motion.span key={`${column.id}`} className={styles.cellInner} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .8 }} transition={snappy}>
                          <Mark value={row.values[column.id]} own={column === own} index={index} reduced={reduced} />
                        </motion.span>
                      </AnimatePresence>
                    </div>)}
                  </motion.div>;
                })}
              </AnimatePresence>
            </div>;
          })}
          <div role="rowgroup">
            <div role="row" className={styles.footRow}>
              <div role="cell" className={styles.legend}>
                <span><svg className={styles.check} width="16" height="16" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" /><path d="M6.6 11.3l3 3 5.9-6.4" /></svg>Included</span>
                <span><svg className={styles.partial} width="16" height="16" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9.25" /><path d="M11 1.75a9.25 9.25 0 0 1 0 18.5z" /></svg>Partial</span>
                <span><Minus className={styles.cross} size={14} strokeWidth={1.75} aria-hidden="true" />Not included</span>
              </div>
              {visible.map(column => <div key={column.id} role="cell" className={styles.footCell} data-own={column === own || undefined}>
                {column === own && cta && (cta.href && !cta.onClick
                  ? <a className={styles.cta} href={cta.href}>{cta.label}</a>
                  : <motion.button type="button" layout={!reduced} className={styles.cta} style={{ borderRadius: 9999 }} data-done={ctaDone || undefined} whileTap={reduced ? undefined : { scale: .97 }} transition={morph} onClick={() => { cta.onClick?.(); if (cta.doneLabel) setCtaDone(true); }}>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span key={ctaDone ? "done" : "idle"} layout={reduced ? false : "position"} className={styles.ctaLabel} initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(2px)" }} transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.standard] }}>
                        {ctaDone ? <><Check size={14} strokeWidth={2} aria-hidden="true" />{cta.doneLabel}</> : cta.label}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>)}
              </div>)}
            </div>
          </div>
        </div>
      </div>
      <p className={styles.srOnly} aria-live="polite">{differencesOnly ? "Showing only rows that differ" : "Showing all rows"}</p>
    </div>
  </section>;
}

/** Preview: the comparison inside a capped height so the sticky header shows. */
export function ComparisonTableBlock() {
  return <ComparisonTable maxHeight="min(760px, 82vh)" cta={{ label: "Start free trial", doneLabel: "Trial started" }} />;
}

export default ComparisonTableBlock;
