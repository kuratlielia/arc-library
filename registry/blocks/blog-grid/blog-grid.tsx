"use client";
/* eslint-disable @next/next/no-img-element -- plain images keep the block portable outside Next.js. */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { AnimatePresence, LayoutGroup, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import { blogCategories, blogPosts } from "./blog-grid-data";
import type { BlogPost } from "./blog-grid-data";
import styles from "./blog-grid.module.css";

export type { BlogAuthor, BlogPost } from "./blog-grid-data";

export interface BlogGridProps {
  title?: string;
  description?: string;
  posts?: BlogPost[];
  /** Category filter labels, in order. "All" is added in front. */
  categories?: string[];
  /** Active category, or "All" (controlled). */
  category?: string;
  defaultCategory?: string;
  onCategoryChange?: (category: string) => void;
  /** One based page (controlled). */
  page?: number;
  defaultPage?: number;
  onPageChange?: (page: number) => void;
  /** Cards per page below the featured post. Defaults to 6. */
  pageSize?: number;
  /** Shows the newest post of the current filter as a large card on page one. Defaults to true. */
  showFeatured?: boolean;
  /** Link for each post. When set, cards render as links and the in-place reader is off. */
  getHref?: (post: BlogPost) => string;
  /** Called when a post opens, from a link or the in-place reader. */
  onPostOpen?: (post: BlogPost) => void;
  className?: string;
}

const smooth = motionTokens.spring.smooth;
const morph = motionTokens.spring.morph;
const standard = [...motionTokens.ease.standard] as [number, number, number, number];
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`));

function useControllable<T>(value: T | undefined, initial: T, onChange?: (next: T) => void) {
  const [inner, setInner] = useState(initial);
  const current = value !== undefined ? value : inner;
  const set = (next: T) => { if (value === undefined) setInner(next); onChange?.(next); };
  return [current, set] as const;
}

/** Springs its height when the page or filter changes, so the pagination below glides instead of jumping. Other resizes (a late font, a narrower window) apply at once. */
function AutoHeight({ changeKey, reduced, className, children }: { changeKey: string; reduced: boolean; className?: string; children: ReactNode }) {
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | "auto">("auto");
  const lastKey = useRef(changeKey), armedUntil = useRef(0);
  useLayoutEffect(() => {
    if (lastKey.current === changeKey) return;
    lastKey.current = changeKey;
    armedUntil.current = performance.now() + 900;
  }, [changeKey]);
  useEffect(() => {
    const clip = clipRef.current, content = contentRef.current;
    if (!clip || !content || typeof ResizeObserver === "undefined") return;
    let controls: ReturnType<typeof animate> | undefined;
    const observer = new ResizeObserver(() => {
      const next = content.offsetHeight;
      controls?.stop();
      if (!next || reduced || height.get() === "auto" || performance.now() > armedUntil.current) { height.jump(next || "auto"); delete clip.dataset.clip; return; }
      clip.dataset.clip = "";
      controls = animate(height, next, { ...smooth, onComplete: () => { delete clip.dataset.clip; } });
    });
    observer.observe(content);
    return () => { observer.disconnect(); controls?.stop(); };
  }, [height, reduced]);
  return <motion.div ref={clipRef} className={styles.clip} style={{ height }}>
    <div ref={contentRef} className={className}>{children}</div>
  </motion.div>;
}

function Meta({ post }: { post: BlogPost }) {
  return <p className={styles.meta}><span>{post.category}</span><span aria-hidden="true">·</span><time dateTime={post.date}>{formatDate(post.date)}</time></p>;
}

function Byline({ post }: { post: BlogPost }) {
  return <div className={styles.byline}>
    {post.author.avatar ? <img className={styles.avatar} src={post.author.avatar} alt="" width={24} height={24} loading="lazy" /> : <span className={styles.avatar} aria-hidden="true" />}
    <span className={styles.authorName}>{post.author.name}</span>
    <span className={styles.readTime}>{post.readTime} min read</span>
  </div>;
}

export function BlogGrid({
  title = "Journal",
  description = "Product news, design notes and engineering deep dives from the team.",
  posts = blogPosts,
  categories = blogCategories,
  category: categoryProp,
  defaultCategory = "All",
  onCategoryChange,
  page: pageProp,
  defaultPage = 1,
  onPageChange,
  pageSize = 6,
  showFeatured = true,
  getHref,
  onPostOpen,
  className,
}: BlogGridProps) {
  const reduced = useReducedMotion();
  const uid = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [category, setCategoryState] = useControllable(categoryProp, defaultCategory, onCategoryChange);
  const [page, setPageState] = useControllable(pageProp, defaultPage, onPageChange);
  const [direction, setDirection] = useState(0);
  const [reading, setReading] = useState<BlogPost | null>(null);
  /** The post the reader just closed. Its image morphs back into its card while the rest of the index fades in around it. */
  const [returning, setReturning] = useState<string | null>(null);
  const lastOpened = useRef<string | null>(null);

  const sorted = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const filtered = category === "All" ? sorted : sorted.filter(post => post.category === category);
  const featured = showFeatured && filtered.length > 1 ? (filtered.find(post => post.featured) ?? filtered[0]) : null;
  const rest = featured ? filtered.filter(post => post !== featured) : filtered;
  const pageCount = Math.max(1, Math.ceil(rest.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pagePosts = rest.slice((safePage - 1) * pageSize, safePage * pageSize);

  function scrollToTop() {
    const node = rootRef.current;
    if (node && node.getBoundingClientRect().top < 0) node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }
  function setCategory(next: string) {
    if (next === category) return;
    setDirection(0);
    setReturning(null);
    setCategoryState(next);
    setPageState(1);
  }
  function setPage(next: number) {
    if (next === safePage || next < 1 || next > pageCount) return;
    setDirection(next > safePage ? 1 : -1);
    setReturning(null);
    setPageState(next);
    scrollToTop();
  }
  function open(post: BlogPost, event: MouseEvent) {
    onPostOpen?.(post);
    if (getHref) return;
    event.preventDefault();
    lastOpened.current = post.id;
    setReading(post);
    scrollToTop();
  }
  function close() {
    setReturning(lastOpened.current);
    setReading(null);
    requestAnimationFrame(() => {
      const card = rootRef.current?.querySelector<HTMLElement>(`[data-post="${lastOpened.current}"]`);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    });
  }

  const renderCard = (post: BlogPost, isFeatured = false) => {
    const href = getHref?.(post);
    const inner = <>
      {post.image && <motion.div layoutId={reduced ? undefined : `${uid}-image-${post.id}`} transition={morph} className={styles.imageFrame}>
        <img className={styles.image} src={post.image.src} alt={post.image.alt} loading={isFeatured ? "eager" : "lazy"} />
      </motion.div>}
      <div className={styles.cardBody}>
        <Meta post={post} />
        <h3 className={isFeatured ? styles.featuredTitle : styles.cardTitle}>{post.title}</h3>
        <p className={styles.excerpt}>{post.excerpt}</p>
        <Byline post={post} />
      </div>
    </>;
    const className = isFeatured ? styles.featured : styles.card;
    const fades = returning !== null && (reduced || post.id !== returning);
    return <motion.a key={post.id} className={className} href={href ?? `#${post.id}`} data-post={post.id} onClick={event => open(post, event)} {...enterFade(fades)}>{inner}</motion.a>;
  };

  /** Fades a piece of the index or reader in on its own, so the shared image is never dimmed by a fading parent mid morph. */
  const enterFade = (on: boolean) => ({ initial: on ? { opacity: 0 } : false as const, animate: { opacity: 1 }, transition: { duration: motionTokens.duration.standard, ease: standard } });
  const back = returning !== null;
  const tabs = ["All", ...categories];
  const pageKey = `${category}-${safePage}`;

  return <section ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} aria-label={title}>
    <LayoutGroup id={uid}>
      <div className={styles.inner}>
        <AnimatePresence mode="popLayout" initial={false}>
          {reading ? <motion.article key="reader" className={styles.reader} exit={{ opacity: 0, transition: { duration: motionTokens.duration.exit, ease: standard } }} aria-labelledby={`${uid}-reader-title`}>
            <motion.button type="button" className={styles.back} onClick={close} autoFocus {...enterFade(true)}><ArrowLeft size={16} aria-hidden="true" />All posts</motion.button>
            <motion.header className={styles.readerHead} {...enterFade(true)}>
              <Meta post={reading} />
              <h2 id={`${uid}-reader-title`} className={styles.readerTitle}>{reading.title}</h2>
              <Byline post={reading} />
            </motion.header>
            {reading.image && <motion.div layoutId={reduced ? undefined : `${uid}-image-${reading.id}`} transition={morph} className={styles.readerImage} {...(reduced ? enterFade(true) : {})}>
              <img className={styles.image} src={reading.image.src} alt={reading.image.alt} />
            </motion.div>}
            <motion.div className={styles.readerBody} initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...smooth, delay: reduced ? 0 : .12 }}>
              <p className={styles.lead}>{reading.excerpt}</p>
              {(reading.body ?? []).map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            </motion.div>
          </motion.article> : <motion.div key="index" className={styles.index} exit={{ opacity: 0, transition: { duration: motionTokens.duration.exit, ease: standard } }}>
            <motion.header className={styles.header} {...enterFade(back)}>
              <h2 className={styles.title}>{title}</h2>
              {description && <p className={styles.description}>{description}</p>}
            </motion.header>

            <motion.div className={styles.filters} role="group" aria-label="Filter by category" {...enterFade(back)}>
              {tabs.map(tab => <button key={tab} type="button" className={styles.filter} aria-pressed={tab === category} onClick={() => setCategory(tab)}>
                {tab === category && <motion.span layoutId={`${uid}-filter`} className={styles.filterHighlight} transition={reduced ? { duration: 0 } : morph} />}
                <span>{tab}</span>
              </button>)}
            </motion.div>

            <AutoHeight changeKey={`${pageKey}-${pageCount}`} reduced={Boolean(reduced)} className={styles.stack}>
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={pageKey}
                className={styles.page}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: direction * 24, y: direction ? 0 : 10 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: direction * -24, transition: { duration: motionTokens.duration.exit, ease: standard } }}
                transition={{ ...smooth, opacity: { duration: motionTokens.duration.standard } }}
              >
                {featured && safePage === 1 && renderCard(featured, true)}
                {pagePosts.length > 0 && <div className={styles.grid}>{pagePosts.map(post => renderCard(post))}</div>}
                {filtered.length === 0 && <p className={styles.empty}>No posts in {category} yet.</p>}
              </motion.div>
            </AnimatePresence>

            <AnimatePresence initial={back}>
            {pageCount > 1 && <motion.nav key="pagination" className={styles.pagination} aria-label="Pagination" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: motionTokens.duration.exit, ease: standard } }} transition={{ duration: motionTokens.duration.standard, ease: standard }}>
              <button type="button" className={styles.pageStep} onClick={() => setPage(safePage - 1)} disabled={safePage === 1} aria-label="Previous page"><ChevronLeft size={16} aria-hidden="true" /><span>Previous</span></button>
              <div className={styles.pageNumbers}>
                {Array.from({ length: pageCount }, (_, index) => index + 1).map(number => <button key={number} type="button" className={styles.pageNumber} aria-current={number === safePage ? "page" : undefined} aria-label={`Page ${number}`} onClick={() => setPage(number)}>
                  {number === safePage && <motion.span layoutId={`${uid}-page`} className={styles.pageHighlight} transition={reduced ? { duration: 0 } : morph} />}
                  <span>{number}</span>
                </button>)}
              </div>
              <button type="button" className={styles.pageStep} onClick={() => setPage(safePage + 1)} disabled={safePage === pageCount} aria-label="Next page"><span>Next</span><ChevronRight size={16} aria-hidden="true" /></button>
            </motion.nav>}
            </AnimatePresence>
            </AutoHeight>
          </motion.div>}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  </section>;
}

/** Preview: the blog index with the in-place reader. */
export function BlogGridBlock() {
  return <BlogGrid />;
}

export default BlogGridBlock;
