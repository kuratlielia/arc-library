"use client";

import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import Image from "next/image";
import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotion } from "motion/react";
import type { Transition, Variants } from "motion/react";
import { ArrowRight, BookOpen, Boxes, ChevronDown, History, LayoutTemplate, Menu, MessagesSquare, Palette, PanelsTopLeft, Route, X } from "lucide-react";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { motionTokens } from "@/lib/motion-tokens";
import { photo } from "@/lib/media";
import styles from "./site-header.module.css";

export type SiteHeaderVariant = "simple" | "centered" | "mega";

/** One destination inside a mega menu panel. */
export interface SiteHeaderLink {
  label: string;
  /** One short line under the label. */
  description?: string;
  /** A plain decorative icon beside the label. */
  icon?: ReactNode;
  href?: string;
}

/** A card beside the links in a mega menu panel. */
export interface SiteHeaderFeature {
  title: string;
  description?: string;
  href?: string;
  image?: { src: string; alt: string };
}

/** A top level destination. With `links` and the mega variant it opens a panel; otherwise it is a plain link. */
export interface SiteHeaderItem {
  /** Stable value, also used for `current`. */
  value: string;
  label: string;
  href?: string;
  links?: SiteHeaderLink[];
  feature?: SiteHeaderFeature;
}

export interface SiteHeaderAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

/** What `onNavigate` receives. */
export interface SiteHeaderDestination {
  label: string;
  href?: string;
  /** The top level item the destination belongs to. */
  section?: string;
}

export interface SiteHeaderProps {
  /** `simple` puts links beside the brand, `centered` centers them in a quiet capsule, `mega` opens panels for items with links. */
  variant?: SiteHeaderVariant;
  brand?: { name: string; href?: string; mark?: ReactNode };
  items?: SiteHeaderItem[];
  /** Value of the item that holds the current page (controlled). */
  current?: string;
  /** Initial current item when uncontrolled. */
  defaultCurrent?: string;
  /** Called when a destination inside an item is chosen, with that item's value. */
  onCurrentChange?: (value: string) => void;
  /** Called for every destination: items, panel links, the brand, and actions with an href. */
  onNavigate?: (destination: SiteHeaderDestination) => void;
  /** A quiet action before the primary one, such as Sign in. Pass null to hide it. */
  secondaryAction?: SiteHeaderAction | null;
  /** The one primary action at the end of the bar. Pass null to hide it. */
  primaryAction?: SiteHeaderAction | null;
  /** Sticks to the top of its scroll container. Defaults to true. */
  sticky?: boolean;
  /** The element that scrolls, when it is not the window. The header turns solid once it scrolls. */
  scrollContainer?: RefObject<HTMLElement | null>;
  /** Pixels of scroll before the background turns solid. Defaults to 8. */
  scrollThreshold?: number;
  /** Accessible name of the navigation landmark. */
  label?: string;
  className?: string;
}

type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;
/** Duration based springs restated as stiffness and damping, so a retarget keeps the velocity already in flight. */
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const GROW = physical(.44, .12), SHRINK = physical(.34, 0), GLIDE = physical(.3, .1), SLIDE = physical(.4, .06);
const HOVER_INTENT = 70, LEAVE_GRACE = 180, TRAVEL = 36;
/** Matches the container query in site-header.module.css. */
const COLLAPSE_BELOW = 760;

/** Panel content slides in from the side of the newly opened item; opening from closed drops in from the bar. */
const faceVariants: Variants = {
  hidden: (direction: number) => ({ opacity: 0, x: direction * TRAVEL, y: direction ? 0 : -6, filter: `blur(${motionTokens.blur.subtle}px)` }),
  shown: { opacity: 1, x: 0, y: 0, filter: "blur(0px)", transition: { x: SLIDE, y: SLIDE, opacity: { duration: motionTokens.duration.fast, ease: enter, delay: .02 }, filter: { duration: motionTokens.duration.standard, ease: enter } } },
  gone: (direction: number) => ({ opacity: 0, x: direction * -TRAVEL * .6, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { x: SLIDE, opacity: { duration: motionTokens.duration.instant, ease: standard }, filter: { duration: motionTokens.duration.instant, ease: standard } } }),
};
const fadeVariants: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: motionTokens.duration.fast } }, gone: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };

export function ArcMark(props: { className?: string }) {
  return <svg className={props.className} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 48V29C9 15 19 7 32 7s23 8 23 22v19" />
    <path d="M20 48V31c0-8 5-13 12-13s12 5 12 13v17" />
    <path d="M32 38v10" />
  </svg>;
}

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const curvedFacade = photo("curved-facade");

export const siteHeaderExampleItems: SiteHeaderItem[] = [
  {
    value: "product", label: "Product",
    links: [
      { label: "Components", description: "140 interactive React components", icon: <Boxes {...ICON} /> },
      { label: "Blocks", description: "Complete sections, ready to ship", icon: <PanelsTopLeft {...ICON} /> },
      { label: "Templates", description: "Starter sites with every page", icon: <LayoutTemplate {...ICON} /> },
      { label: "Themes", description: "Tune color, radius, and motion", icon: <Palette {...ICON} /> },
    ],
    feature: { title: "What's new in 2.4", description: "Site headers, footers, and hero sections.", image: { src: curvedFacade.src, alt: curvedFacade.alt } },
  },
  {
    value: "resources", label: "Resources",
    links: [
      { label: "Documentation", description: "Install, theme, and compose", icon: <BookOpen {...ICON} /> },
      { label: "Guides", description: "Patterns for real product work", icon: <Route {...ICON} /> },
      { label: "Changelog", description: "Every release, week by week", icon: <History {...ICON} /> },
      { label: "Community", description: "Questions, answers, and showcases", icon: <MessagesSquare {...ICON} /> },
    ],
  },
  { value: "pricing", label: "Pricing" },
  { value: "customers", label: "Customers" },
];

function useScrolled(threshold: number, container?: RefObject<HTMLElement | null>) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const node = container?.current ?? null;
    const target: HTMLElement | Window = node ?? window;
    const read = () => node ? node.scrollTop : window.scrollY;
    // Turns solid past the threshold and clear again only near the top, so it never flickers at the edge.
    const update = () => { const y = read(); setScrolled(previous => previous ? y > threshold / 2 : y > threshold); };
    update();
    target.addEventListener("scroll", update, { passive: true });
    return () => target.removeEventListener("scroll", update);
  }, [threshold, container]);
  return scrolled;
}

/** A panel face reports its natural height while current; a leaving face floats out of flow and turns inert. */
function Face({ direction, reduced, onHeight, children }: { direction: number; reduced: boolean; onHeight: (height: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !present) return;
    onHeight(node.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [present, onHeight]);
  return <motion.div ref={ref} className={styles.face} data-face="" data-leaving={present ? undefined : ""} inert={!present} custom={direction} variants={reduced ? fadeVariants : faceVariants} initial="hidden" animate="shown" exit="gone">
    {children}
  </motion.div>;
}

type DestinationProps = Omit<HTMLAttributes<HTMLElement>, "onClick" | "children"> & { link: { href?: string; label: string }; onChoose: (event: ReactMouseEvent) => void; children: ReactNode };
/** Renders an anchor when the destination has an href and a button otherwise, so demos and real sites share one path. */
function Destination({ link, onChoose, children, ...rest }: DestinationProps) {
  return link.href
    ? <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} href={link.href} onClick={onChoose}>{children}</a>
    : <button {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} type="button" onClick={onChoose}>{children}</button>;
}

/**
 * A website header in three layouts. It sticks to the top and turns solid once the page scrolls, marks the current section
 * with an indicator that glides between links, opens springy mega menu panels whose content slides in from the side you
 * moved toward, and folds into a menu sheet on narrow containers.
 */
export const SiteHeader = forwardRef<HTMLElement, SiteHeaderProps>(function SiteHeader({
  variant = "mega",
  brand = { name: "Arc" },
  items = siteHeaderExampleItems,
  current: currentProp,
  defaultCurrent,
  onCurrentChange,
  onNavigate,
  secondaryAction = { label: "Sign in" },
  primaryAction = { label: "Get Arc" },
  sticky = true,
  scrollContainer,
  scrollThreshold = 8,
  label = "Main",
  className,
}, ref) {
  const id = useId();
  const reduced = !!useReducedMotion();
  const scrolled = useScrolled(scrollThreshold, scrollContainer);
  const [innerCurrent, setInnerCurrent] = useState(defaultCurrent);
  const current = currentProp ?? innerCurrent;
  const [hovered, setHovered] = useState<string | null>(null);
  const [open, setOpen] = useState<{ value: string; direction: number } | null>(null);
  const [panel, setPanel] = useState<{ height: number | null; grow: boolean }>({ height: null, grow: true });
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement | HTMLAnchorElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined), closeTimer = useRef<number | undefined>(undefined);
  const focusFirst = useRef(false);
  const hasPanels = variant === "mega";
  const openItem = open ? items.find(item => item.value === open.value) : undefined;

  const setRefs = useCallback((node: HTMLElement | null) => {
    rootRef.current = node;
    if (typeof ref === "function") ref(node); else if (ref) ref.current = node;
  }, [ref]);

  const clearTimers = useCallback(() => { window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current); }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const openPanel = useCallback((value: string | null) => {
    setOpen(previous => {
      if (!value) return null;
      if (previous?.value === value) return previous;
      const from = previous ? items.findIndex(item => item.value === previous.value) : -1;
      const to = items.findIndex(item => item.value === value);
      return { value, direction: from < 0 ? 0 : Math.sign(to - from) };
    });
    if (!value) setPanel({ height: null, grow: true });
  }, [items]);

  const close = useCallback((restoreFocus = false) => {
    clearTimers();
    const was = open?.value;
    openPanel(null);
    if (restoreFocus && was) triggerRefs.current.get(was)?.focus();
  }, [open, openPanel, clearTimers]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    setExpanded(null);
    if (restoreFocus) menuButtonRef.current?.focus();
  }, []);

  const choose = useCallback((destination: SiteHeaderDestination, section: string | undefined) => {
    if (section) {
      if (currentProp === undefined) setInnerCurrent(section);
      onCurrentChange?.(section);
    }
    onNavigate?.(destination);
    close();
    closeMenu();
  }, [close, closeMenu, currentProp, onCurrentChange, onNavigate]);

  // Outside presses and Escape close whichever layer is open.
  useEffect(() => {
    if (!open && !menuOpen) return;
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) { close(); closeMenu(); } };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { if (open) close(true); else closeMenu(true); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, menuOpen, close, closeMenu]);

  // The sheet belongs to narrow layouts: widening the container closes it, and it holds the page still while open.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width >= COLLAPSE_BELOW) { setMenuOpen(false); setExpanded(null); } else setOpen(null);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const scroller: HTMLElement = scrollContainer?.current ?? document.documentElement;
    const previous = scroller.style.getPropertyValue("overflow");
    scroller.style.setProperty("overflow", "hidden");
    return () => { if (previous) scroller.style.setProperty("overflow", previous); else scroller.style.removeProperty("overflow"); };
  }, [menuOpen, scrollContainer]);

  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("[data-panel-link]")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function onTriggerPointerEnter(event: ReactPointerEvent, value: string) {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(openTimer.current);
    if (open) openPanel(value);
    else openTimer.current = window.setTimeout(() => openPanel(value), HOVER_INTENT);
  }
  function onRegionPointerLeave(event: ReactPointerEvent) {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => openPanel(null), LEAVE_GRACE);
  }
  function onRegionPointerEnter(event: ReactPointerEvent) {
    if (event.pointerType === "mouse") window.clearTimeout(closeTimer.current);
  }

  function onNavKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const triggers = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-nav-item]"));
    const index = triggers.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const nextIndex = (index + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) % triggers.length;
    triggers[nextIndex].focus();
    if (open) { const item = items[nextIndex]; openPanel(item && hasPanels && item.links?.length ? item.value : null); }
  }
  function onTriggerKeyDown(event: ReactKeyboardEvent, value: string) {
    if (event.key === "ArrowDown") { event.preventDefault(); focusFirst.current = true; openPanel(value); if (open?.value === value) panelRef.current?.querySelector<HTMLElement>("[data-panel-link]")?.focus(); }
  }
  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const unique = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-face]:not([data-leaving]) [data-panel-link]"));
    if (!unique.length) return;
    event.preventDefault();
    const index = unique.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? unique.length - 1 : event.key === "ArrowDown" ? Math.min(index + 1, unique.length - 1) : index - 1;
    if (next < 0) { close(true); return; }
    unique[next]?.focus();
  }

  // Growing carries a little life; shrinking settles without overshoot.
  const onHeight = useCallback((height: number) => setPanel(previous => previous.height === height ? previous : { height, grow: previous.height === null || height > previous.height }), []);

  const actionNode = (action: SiteHeaderAction, kind: "secondary" | "primary", extra = "") => {
    const onClick = () => { action.onClick?.(); if (action.href) onNavigate?.({ label: action.label, href: action.href }); closeMenu(); };
    const cls = `${styles.action} ${styles[kind]} ${extra}`;
    return action.href ? <a className={cls} href={action.href} onClick={onClick}>{action.label}</a> : <button type="button" className={cls} onClick={onClick}>{action.label}</button>;
  };

  const brandNode = <Destination link={{ label: brand.name, href: brand.href }} className={styles.brand} onChoose={() => { onNavigate?.({ label: brand.name, href: brand.href }); close(); closeMenu(); }}>
    {brand.mark ?? <ArcMark className={styles.brandMark} />}<span>{brand.name}</span>
  </Destination>;

  return <header
    ref={setRefs}
    className={[styles.header, sticky ? styles.sticky : "", className].filter(Boolean).join(" ")}
    data-variant={variant}
    data-scrolled={scrolled || menuOpen || !!open ? "" : undefined}
  >
    <div className={styles.inner} onPointerLeave={onRegionPointerLeave} onPointerEnter={onRegionPointerEnter}>
      <div className={styles.bar}>
        <div className={styles.brandSlot}>{brandNode}</div>
        <LayoutGroup id={id}>
          <nav className={styles.nav} aria-label={label} onKeyDown={onNavKeyDown} onPointerLeave={() => setHovered(null)}>
            <ul className={styles.navList}>
              {items.map(item => {
                const isCurrent = current === item.value;
                const withPanel = hasPanels && !!item.links?.length;
                const isOpen = open?.value === item.value;
                const panelId = `${id}-panel`;
                const common = {
                  className: styles.navItem,
                  "data-nav-item": "",
                  "data-current": isCurrent ? "" : undefined,
                  "data-open": isOpen ? "" : undefined,
                  onPointerEnter: (event: ReactPointerEvent) => { if (event.pointerType === "mouse") setHovered(item.value); if (withPanel) onTriggerPointerEnter(event, item.value); else if (event.pointerType === "mouse" && open) closeTimer.current = window.setTimeout(() => openPanel(null), LEAVE_GRACE); },
                  onFocus: () => setHovered(null),
                };
                const decorations = <>
                  {hovered === item.value && variant !== "centered" && <motion.span key={`hover-${variant}`} layoutId={`hover-${variant}`} className={styles.hover} transition={reduced ? { duration: 0 } : GLIDE} aria-hidden="true" />}
                  {isCurrent && <motion.span key={`current-${variant}`} layoutId={`current-${variant}`} className={styles.indicator} transition={reduced ? { duration: 0 } : motionTokens.spring.morph} aria-hidden="true" />}
                </>;
                return <li key={item.value} className={styles.navCell}>
                  {withPanel
                    ? <button
                        {...common}
                        ref={(node: HTMLButtonElement | null) => { if (node) triggerRefs.current.set(item.value, node); else triggerRefs.current.delete(item.value); }}
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? panelId : undefined}
                        onClick={() => { clearTimers(); openPanel(isOpen ? null : item.value); }}
                        onKeyDown={event => onTriggerKeyDown(event, item.value)}
                      >
                        {decorations}
                        <span className={styles.navLabel}>{item.label}</span>
                        <ChevronDown className={styles.chevron} size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    : <Destination
                        link={item}
                        {...common}
                        aria-current={isCurrent ? "page" : undefined}
                        onChoose={() => choose({ label: item.label, href: item.href, section: item.value }, item.value)}
                      >
                        {decorations}
                        <span className={styles.navLabel}>{item.label}</span>
                      </Destination>}
                </li>;
              })}
            </ul>
          </nav>
        </LayoutGroup>
        <div className={styles.actions}>
          {secondaryAction && actionNode(secondaryAction, "secondary", styles.wideOnly)}
          {primaryAction && actionNode(primaryAction, "primary")}
          <button ref={menuButtonRef} type="button" className={styles.menuButton} aria-expanded={menuOpen} aria-controls={`${id}-sheet`} aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => { if (menuOpen) closeMenu(); else setMenuOpen(true); }}>
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={menuOpen ? "close" : "open"} className={styles.menuIcon} initial={reduced ? { opacity: 0 } : { opacity: 0, rotate: menuOpen ? -45 : 45, scale: .8 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, rotate: menuOpen ? 45 : -45, scale: .8 }} transition={reduced ? { duration: 0 } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.instant } }}>
                {menuOpen ? <X size={20} strokeWidth={1.75} aria-hidden="true" /> : <Menu size={20} strokeWidth={1.75} aria-hidden="true" />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>

      {hasPanels && <AnimatePresence>
        {openItem?.links && <motion.div
          key="panel"
          id={`${id}-panel`}
          ref={panelRef}
          className={styles.panel}
          role="region"
          aria-label={openItem.label}
          onKeyDown={onPanelKeyDown}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: .985 }}
          animate={{ opacity: 1, y: 0, scale: 1, height: panel.height ?? "auto" }}
          exit={reduced ? { opacity: 0, transition: { duration: motionTokens.duration.instant } } : { opacity: 0, y: -4, scale: .99, transition: { duration: motionTokens.duration.exit, ease: standard } }}
          transition={reduced ? { duration: 0 } : { height: panel.grow ? GROW : SHRINK, y: GROW, scale: GROW, opacity: { duration: motionTokens.duration.fast, ease: enter } }}
        >
          <AnimatePresence initial={false} custom={open?.direction ?? 0}>
            <Face key={openItem.value} direction={open?.direction ?? 0} reduced={reduced} onHeight={onHeight}>
              <div className={styles.faceGrid} data-featured={openItem.feature ? "" : undefined}>
                <ul className={styles.panelLinks}>
                  {openItem.links.map(link => <li key={link.label}>
                    <Destination link={link} className={styles.panelLink} data-panel-link="" onChoose={() => choose({ label: link.label, href: link.href, section: openItem.value }, openItem.value)}>
                      {link.icon && <span className={styles.panelIcon}>{link.icon}</span>}
                      <span className={styles.panelText}><span>{link.label}</span>{link.description && <span>{link.description}</span>}</span>
                    </Destination>
                  </li>)}
                </ul>
                {openItem.feature && <Destination link={{ label: openItem.feature.title, href: openItem.feature.href }} className={styles.feature} data-panel-link="" onChoose={() => choose({ label: openItem.feature!.title, href: openItem.feature!.href, section: openItem.value }, openItem.value)}>
                  {openItem.feature.image && <span className={styles.featureImage}><Image src={openItem.feature.image.src} alt={openItem.feature.image.alt} fill sizes="260px" /></span>}
                  <span className={styles.featureTitle}>{openItem.feature.title}<ArrowRight size={14} strokeWidth={2} aria-hidden="true" /></span>
                  {openItem.feature.description && <span className={styles.featureText}>{openItem.feature.description}</span>}
                </Destination>}
              </div>
            </Face>
          </AnimatePresence>
        </motion.div>}
      </AnimatePresence>}
    </div>

    <AnimatePresence>
      {menuOpen && <>
        <motion.div key="scrim" className={styles.scrim} onClick={() => closeMenu()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : motionTokens.duration.standard, ease: standard }} aria-hidden="true" />
        <motion.div
          key="sheet"
          id={`${id}-sheet`}
          className={styles.sheet}
          initial={reduced ? { opacity: 0 } : { height: 0 }}
          animate={reduced ? { opacity: 1 } : { height: "auto" }}
          exit={reduced ? { opacity: 0 } : { height: 0, transition: SHRINK }}
          transition={reduced ? { duration: 0 } : GROW}
        >
          <nav className={styles.sheetInner} aria-label={label}>
            <ul className={styles.sheetList}>
              {items.map((item, index) => {
                const isCurrent = current === item.value;
                const group = !!item.links?.length && variant === "mega";
                const isExpanded = expanded === item.value;
                const rowMotion = { initial: reduced ? false : { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, transition: { duration: motionTokens.duration.standard, ease: enter, delay: reduced ? 0 : .04 + index * motionTokens.stagger.item } } as const;
                return <motion.li key={item.value} className={styles.sheetItem} {...rowMotion}>
                  {group ? <>
                    <button type="button" className={styles.sheetRow} data-current={isCurrent ? "" : undefined} aria-expanded={isExpanded} aria-controls={`${id}-group-${item.value}`} onClick={() => setExpanded(isExpanded ? null : item.value)}>
                      <span>{item.label}</span><ChevronDown className={styles.sheetChevron} size={18} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    <AnimatePresence initial={false}>
                      {isExpanded && <motion.div key="group" id={`${id}-group-${item.value}`} className={styles.sheetGroup} initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }} exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } }}>
                        <ul>{item.links!.map(link => <li key={link.label}>
                          <Destination link={link} className={styles.sheetLink} onChoose={() => choose({ label: link.label, href: link.href, section: item.value }, item.value)}>
                            {link.icon}<span>{link.label}</span>
                          </Destination>
                        </li>)}</ul>
                      </motion.div>}
                    </AnimatePresence>
                  </> : <Destination link={item} className={styles.sheetRow} data-current={isCurrent ? "" : undefined} aria-current={isCurrent ? "page" : undefined} onChoose={() => choose({ label: item.label, href: item.href, section: item.value }, item.value)}>
                    <span>{item.label}</span>{isCurrent && <span className={styles.sheetDot} aria-hidden="true" />}
                  </Destination>}
                </motion.li>;
              })}
            </ul>
            {(secondaryAction || primaryAction) && <motion.div className={styles.sheetActions} initial={reduced ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: motionTokens.duration.standard, ease: enter, delay: reduced ? 0 : .04 + items.length * motionTokens.stagger.item }}>
              {secondaryAction && actionNode(secondaryAction, "secondary")}
              {primaryAction && actionNode(primaryAction, "primary")}
            </motion.div>}
          </nav>
        </motion.div>
      </>}
    </AnimatePresence>
  </header>;
});

SiteHeader.displayName = "SiteHeader";

const variantOptions = [{ value: "mega", label: "Mega menu" }, { value: "simple", label: "Simple" }, { value: "centered", label: "Centered" }];
const pageLabels: Record<string, string> = { product: "Product", resources: "Resources", pricing: "Pricing", customers: "Customers" };

/** Preview: the header inside a small scrolling page, with a switch between its three layouts. */
export function SiteHeaderBlock({ variant: initial = "mega" }: { variant?: SiteHeaderVariant }) {
  const [variant, setVariant] = useState<SiteHeaderVariant>(initial);
  const [current, setCurrent] = useState("product");
  const [last, setLast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  return <div className={styles.preview}>
    <SegmentedControl label="Header layout" options={variantOptions} value={variant} onValueChange={value => setVariant(value as SiteHeaderVariant)} />
    <div className={styles.frame} ref={scrollRef}>
      <SiteHeader
        variant={variant}
        current={current}
        onCurrentChange={setCurrent}
        onNavigate={destination => setLast(destination.label)}
        scrollContainer={scrollRef}
        secondaryAction={{ label: "Sign in", onClick: () => setLast("Sign in") }}
        primaryAction={{ label: "Get Arc", onClick: () => setLast("Get Arc") }}
      />
      <div className={styles.page}>
        <div className={styles.pageHero}>
          <h2>{pageLabels[current] ?? "Arc"}</h2>
          <p className={styles.srOnly} aria-live="polite">{last ? `Opened ${last}` : ""}</p>
        </div>
        <div className={styles.pageRows} aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.pageRow}><span /><span /><span /></div>)}
        </div>
      </div>
    </div>
  </div>;
}

export default SiteHeaderBlock;
