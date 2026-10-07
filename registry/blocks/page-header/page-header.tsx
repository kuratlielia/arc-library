"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, ReactNode, UIEvent } from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Transition, type Variants } from "motion/react";
import { Archive, ArchiveRestore, Bell, BellOff, BellRing, CalendarDays, Check, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDashed, Ellipsis, FileSpreadsheet, FileText, Film, Link2, Megaphone, PenTool, Plus, Presentation, type LucideIcon } from "lucide-react";
import { AnimatedCounter } from "@/registry/components/animated-counter/animated-counter";
import { Avatar } from "@/registry/components/avatar/avatar";
import { AvatarGroup } from "@/registry/components/avatar-group/avatar-group";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { Progress } from "@/registry/components/progress/progress";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./page-header.module.css";

/** The header condenses past CONDENSE_AT and only opens again near the top, so it never flickers at the threshold. */
const CONDENSE_AT = 16;
const EXPAND_AT = 4;
/** Secondary actions fold into the overflow menu when the breadcrumbs would get less room than this, and return with a little slack. */
const LEAD_MIN = 240;
const LEAD_RETURN = 272;
const DONE_AT_START = 31;
const PROJECT_URL = "https://northline.example/projects/checkout-redesign";

type PersonId = "emma" | "marcus" | "ava" | "sofia" | "jasmine";
const people: Record<PersonId, { name: string; src: string }> = {
  emma: { name: "Emma Collins", src: "/media/people/emma-collins.jpg" },
  marcus: { name: "Marcus Johnson", src: "/media/people/marcus-johnson.jpg" },
  ava: { name: "Ava Mitchell", src: "/media/people/ava-mitchell.jpg" },
  sofia: { name: "Sofia Ramirez", src: "/media/people/sofia-ramirez.jpg" },
  jasmine: { name: "Jasmine Brooks", src: "/media/people/jasmine-brooks.jpg" },
};
const members = (["emma", "marcus", "ava", "sofia", "jasmine"] as const).map(key => people[key]);

type Section = "overview" | "issues" | "updates" | "files";
const sections: { value: Section; label: string }[] = [{ value: "overview", label: "Overview" }, { value: "issues", label: "Issues" }, { value: "updates", label: "Updates" }, { value: "files", label: "Files" }];
const order = (section: Section) => sections.findIndex(item => item.value === section);

type Issue = { id: string; title: string; owner: PersonId; label: string; fresh?: boolean };
const startingIssues: Issue[] = [
  { id: "CHK-138", title: "Saved card list clips the expiry date on small screens", owner: "sofia", label: "Bug" },
  { id: "CHK-136", title: "Add an edit link beside each section of the review step", owner: "emma", label: "Design" },
  { id: "CHK-135", title: "Wallet sheet opens twice after a failed card check", owner: "marcus", label: "Bug" },
  { id: "CHK-133", title: "Show the delivery estimate before payment", owner: "ava", label: "Research" },
  { id: "CHK-131", title: "Promo code field loses focus after an invalid code", owner: "sofia", label: "Bug" },
  { id: "CHK-129", title: "Track drop-off between review and pay", owner: "ava", label: "Analytics" },
  { id: "CHK-127", title: "Preselect the last used card for returning customers", owner: "marcus", label: "Feature" },
  { id: "CHK-124", title: "Write clearer copy for declined cards", owner: "emma", label: "Content" },
  { id: "CHK-122", title: "Address autocomplete drops apartment numbers", owner: "sofia", label: "Bug" },
];
const draftIssues = ["Keyboard focus skips the save card checkbox", "Recalculate tax when the shipping country changes", "Pay button needs a pressed and loading state", "Review totals wrap awkwardly at large text sizes"];

type Update = { id: string; author: PersonId; date: string; tone: "success" | "warning"; status: string; body: string; fresh?: boolean };
const startingUpdates: Update[] = [
  { id: "u4", author: "emma", date: "Sep 19", tone: "success", status: "On track", body: "Saved payment methods reached every iOS customer on Thursday. Returning customers now finish checkout 3.1 points more often. The review step is next." },
  { id: "u3", author: "ava", date: "Sep 12", tone: "success", status: "On track", body: "Five usability sessions are done. People trust a single review step as long as the total stays visible while they edit." },
  { id: "u2", author: "marcus", date: "Sep 5", tone: "warning", status: "At risk", body: "Card tokenization is waiting on the payments team. We moved the review step ahead so the October date can hold." },
  { id: "u1", author: "emma", date: "Aug 29", tone: "success", status: "On track", body: "Kickoff. Scope is saved cards, one review step, and a staged rollout starting October 14." },
];
const draftUpdates = ["The review step is in staging behind a flag. If error rates hold through Friday, we open it to 10% of traffic on Monday.", "Declined card copy is final and with support for review. No change to the October 14 rollout."];

const files: { name: string; kind: string; size: string; owner: PersonId; date: string; icon: LucideIcon }[] = [
  { name: "Checkout flows v3", kind: "Design file", size: "18.4 MB", owner: "emma", date: "Sep 20", icon: PenTool },
  { name: "Review step walkthrough", kind: "Video", size: "46 MB", owner: "emma", date: "Sep 18", icon: Film },
  { name: "Payments API notes", kind: "Document", size: "96 KB", owner: "marcus", date: "Sep 16", icon: FileText },
  { name: "Usability findings, round two", kind: "PDF", size: "2.1 MB", owner: "ava", date: "Sep 13", icon: FileText },
  { name: "Rollout plan", kind: "Slides", size: "4.8 MB", owner: "sofia", date: "Sep 11", icon: Presentation },
  { name: "Conversion baseline", kind: "Spreadsheet", size: "640 KB", owner: "ava", date: "Sep 9", icon: FileSpreadsheet },
  { name: "Empty and error states", kind: "Design file", size: "9.2 MB", owner: "emma", date: "Sep 6", icon: PenTool },
  { name: "Launch checklist", kind: "Document", size: "54 KB", owner: "sofia", date: "Sep 2", icon: FileText },
];

const milestoneIcons = { done: CircleCheck, active: CircleDashed, planned: Circle };
const milestones: { name: string; note: string; state: keyof typeof milestoneIcons }[] = [
  { name: "Saved payment methods", note: "Shipped Sep 18", state: "done" },
  { name: "Single review step", note: "In progress, due Oct 1", state: "active" },
  { name: "Staged rollout", note: "Planned for Oct 14", state: "planned" },
];
const activity: { who: PersonId; text: string; time: string }[] = [
  { who: "ava", text: "moved CHK-131 to review", time: "1h ago" },
  { who: "marcus", text: "merged the saved cards endpoint", time: "3h ago" },
  { who: "emma", text: "shared Checkout flows v3", time: "Yesterday" },
  { who: "sofia", text: "closed CHK-119, a double charge on retry", time: "Yesterday" },
  { who: "jasmine", text: "set the rollout date to October 14", time: "Sep 17" },
];

type Notice = { key: number; text: string; tone: "success" | "error" | "neutral" };
type MenuAction = { key: string; label: string; icon: ReactNode; onSelect: () => void; disabled?: boolean; separatorBefore?: boolean };

const still: Transition = { duration: 0 };
const quick: Transition = { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] };
const blur = (px: number) => `blur(${px}px)`;
const icon = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

/** Panels slide a few pixels in the direction of the tab that was chosen. */
const panelSlide: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 12 }),
  center: { opacity: 1, x: 0, transition: { x: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } } },
  exit: (direction: number) => ({ opacity: 0, x: direction * -8, transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }),
};
const panelFade: Variants = { enter: { opacity: 0, x: 0 }, center: { opacity: 1, x: 0, transition: { duration: motionTokens.duration.instant } }, exit: { opacity: 0, x: 0, transition: { duration: motionTokens.duration.instant } } };

/** Rows open and close their own height, so the list closes the gap instead of jumping. */
function rowMotion(reduce: boolean) {
  return reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: motionTokens.duration.instant } }
    : { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: "auto" }, exit: { opacity: 0, height: 0 }, transition: { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.standard] } } };
}

function StatusDot() {
  return <span className={styles.dot} />;
}

/** The overflow button never scales: it anchors the menu. A shared highlight glides between items under the pointer. */
function OverflowMenu({ actions, reduce }: { actions: MenuAction[]; reduce: boolean }) {
  const [highlight, setHighlight] = useState<{ top: number; height: number; glide: boolean } | null>(null);
  const pointer = useRef(false);
  const clearTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  function onFocus(event: FocusEvent<HTMLDivElement>) {
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
    window.clearTimeout(clearTimer.current);
    if (!item) { clearTimer.current = window.setTimeout(() => setHighlight(null), pointer.current ? 70 : 0); return; }
    const glide = pointer.current;
    setHighlight(current => ({ top: item.offsetTop, height: item.offsetHeight, glide: glide && current !== null }));
  }
  return <DropdownPrimitive.Root onOpenChange={open => { if (open) { window.clearTimeout(clearTimer.current); setHighlight(null); } }}>
    <DropdownPrimitive.Trigger asChild><Button variant="secondary" size="sm" className={styles.iconButton} aria-label="More actions"><Ellipsis size={17} strokeWidth={1.75} aria-hidden="true" /></Button></DropdownPrimitive.Trigger>
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content className={styles.menu} align="end" sideOffset={6} collisionPadding={12} loop onFocus={onFocus} onPointerMoveCapture={() => { pointer.current = true; }} onKeyDownCapture={() => { pointer.current = false; }}>
        <motion.span className={styles.highlight} aria-hidden="true" initial={false} animate={highlight ? { y: highlight.top, height: highlight.height, opacity: 1 } : { opacity: 0 }} transition={{ default: highlight?.glide && !reduce ? motionTokens.spring.snappy : still, opacity: { duration: reduce ? 0 : .08 } }} />
        {actions.map(action => <Fragment key={action.key}>
          {action.separatorBefore && <DropdownPrimitive.Separator className={styles.separator} />}
          <DropdownPrimitive.Item className={styles.item} disabled={action.disabled} onSelect={action.onSelect}>{action.icon}{action.label}</DropdownPrimitive.Item>
        </Fragment>)}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  </DropdownPrimitive.Root>;
}

function OverviewPanel({ done, open }: { done: number; open: number }) {
  const total = done + open;
  return <div className={styles.overview}>
    <div className={styles.progress}><Progress value={done} max={total} label={`${done} of ${total} issues done`} showValue /></div>
    <div>
      <h3 className={styles.sectionTitle}>Milestones</h3>
      <ol className={styles.milestones}>{milestones.map(item => {
        const Icon = milestoneIcons[item.state];
        return <li key={item.name} data-state={item.state}><Icon size={16} strokeWidth={1.75} aria-hidden="true" /><span className={styles.milestoneName}>{item.name}</span><span className={styles.note}>{item.note}</span></li>;
      })}</ol>
    </div>
    <div>
      <h3 className={styles.sectionTitle}>Recent activity</h3>
      <ul className={styles.activity}>{activity.map(item => <li key={`${item.who}-${item.text}`}><Avatar name={people[item.who].name} src={people[item.who].src} size="sm" /><p><strong>{people[item.who].name}</strong> {item.text}</p><span className={styles.note}>{item.time}</span></li>)}</ul>
    </div>
  </div>;
}

function IssuesPanel({ issues, closing, reduce, onComplete, onReset, register }: { issues: Issue[]; closing: string[]; reduce: boolean; onComplete: (issue: Issue) => void; onReset: () => void; register: (id: string, node: HTMLButtonElement | null) => void }) {
  const row = rowMotion(reduce);
  return <>
    <ul className={styles.issues} aria-label="Open issues">
      <AnimatePresence initial={false}>
        {issues.map(issue => {
          const isClosing = closing.includes(issue.id);
          const owner = people[issue.owner];
          return <motion.li key={issue.id} className={styles.issue} data-fresh={issue.fresh || undefined} data-closing={isClosing || undefined} {...row}>
            <div className={styles.issueInner}>
              <button ref={node => register(issue.id, node)} type="button" className={styles.check} aria-label={`Mark ${issue.id} done`} aria-disabled={isClosing || undefined} onClick={() => onComplete(issue)}>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span key={isClosing ? "done" : "open"} className={styles.checkGlyph} initial={reduce ? { opacity: 0 } : { opacity: 0, scale: .5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduce ? 1 : .5, transition: quick }} transition={reduce ? still : motionTokens.spring.snappy}>
                    {isClosing ? <CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" /> : <Circle size={18} strokeWidth={1.75} aria-hidden="true" />}
                  </motion.span>
                </AnimatePresence>
              </button>
              <span className={styles.issueText}><span className={styles.issueId}>{issue.id}</span><span className={styles.issueTitle}>{issue.title}</span></span>
              <span className={styles.issueLabel}>{issue.label}</span>
              <Avatar name={owner.name} src={owner.src} size="sm" />
            </div>
          </motion.li>;
        })}
      </AnimatePresence>
    </ul>
    {issues.length === 0 && <motion.div className={styles.empty} initial={{ opacity: 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: motionTokens.duration.instant } : motionTokens.spring.smooth}>
      <CircleCheck size={24} strokeWidth={1.75} aria-hidden="true" />
      <p>No open issues</p>
      <span>Everything in this project is done.</span>
      <Button variant="secondary" size="sm" onClick={onReset}>Restore sample issues</Button>
    </motion.div>}
  </>;
}

function UpdatesPanel({ updates, reduce }: { updates: Update[]; reduce: boolean }) {
  const row = rowMotion(reduce);
  return <ol className={styles.updates} aria-label="Project updates">
    <AnimatePresence initial={false}>
      {updates.map(update => {
        const author = people[update.author];
        return <motion.li key={update.id} className={styles.update} data-fresh={update.fresh || undefined} {...row}>
          <article className={styles.updateInner}>
            <Avatar name={author.name} src={author.src} size="md" />
            <div>
              <div className={styles.updateHead}><span className={styles.author}>{author.name}</span><span className={styles.note}>{update.date}</span><Badge size="sm" tone={update.tone} icon={<StatusDot />}>{update.status}</Badge></div>
              <p>{update.body}</p>
            </div>
          </article>
        </motion.li>;
      })}
    </AnimatePresence>
  </ol>;
}

function FilesPanel() {
  return <ul className={styles.files} aria-label="Project files">{files.map(file => {
    const Icon = file.icon;
    const owner = people[file.owner];
    return <li key={file.name}><Icon size={16} strokeWidth={1.75} aria-hidden="true" /><span className={styles.fileName}><span>{file.name}</span><span className={styles.note}>{file.kind}, {file.size}</span></span><Avatar name={owner.name} src={owner.src} size="sm" /><span className={styles.fileDate}>{file.date}</span></li>;
  })}</ul>;
}

export function PageHeader() {
  const id = useId();
  const reduce = useReducedMotion() ?? false;
  const bar = useRef<HTMLDivElement>(null);
  const secondary = useRef<HTMLDivElement>(null);
  const trailing = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toggles = useRef(new Map<string, HTMLButtonElement>());
  const timers = useRef(new Set<number>());
  const counters = useRef({ issue: 0, update: 0, notice: 0 });
  const [view, setView] = useState<{ section: Section; direction: number }>({ section: "overview", direction: 1 });
  const [condensed, setCondensed] = useState(false);
  const [layout, setLayout] = useState({ measured: false, collapsed: false, animate: false });
  const [following, setFollowing] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sharing, setSharing] = useState<"idle" | "sending" | "sent">("idle");
  const [issues, setIssues] = useState(startingIssues);
  const [closing, setClosing] = useState<string[]>([]);
  const [done, setDone] = useState(DONE_AT_START);
  const [updates, setUpdates] = useState(startingUpdates);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Only the header width is observed, so a label that grows (Follow to Following) never folds the button you just pressed.
  // The first measurement applies at once; later width changes fold the actions with a spring.
  useEffect(() => {
    const row = bar.current, folded = secondary.current, fixed = trailing.current;
    if (!row || !folded || !fixed || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const room = row.clientWidth - folded.offsetWidth - fixed.offsetWidth - 16;
      setLayout(current => {
        const collapsed = current.measured && current.collapsed ? room < LEAD_RETURN : room < LEAD_MIN;
        return current.measured && current.collapsed === collapsed ? current : { measured: true, collapsed, animate: current.measured };
      });
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(handle => window.clearTimeout(handle));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(handle);
  }, [notice]);

  // Keep the chosen tab in view when the list scrolls sideways on narrow screens.
  useEffect(() => {
    const list = tabList.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!list || !tab) return;
    const start = tab.offsetLeft - 12;
    const end = tab.offsetLeft + tab.offsetWidth + 12 - list.clientWidth;
    const behavior = reduce ? "auto" : "smooth";
    if (list.scrollLeft > start) list.scrollTo({ left: start, behavior });
    else if (list.scrollLeft < end) list.scrollTo({ left: end, behavior });
  }, [view.section, reduce]);

  function later(run: () => void, delay: number) {
    const handle = window.setTimeout(() => { timers.current.delete(handle); run(); }, delay);
    timers.current.add(handle);
  }

  function notify(text: string, tone: Notice["tone"] = "success") {
    counters.current.notice += 1;
    setNotice({ key: counters.current.notice, text, tone });
  }

  /** Switching sections while condensed shows the top of the new panel and keeps the compact bar. */
  function selectSection(next: Section, reveal = false) {
    setView(current => current.section === next ? current : { section: next, direction: order(next) > order(current.section) ? 1 : -1 });
    const node = scroller.current;
    if (node && (reveal || next !== view.section) && node.scrollTop > CONDENSE_AT + 1) node.scrollTop = CONDENSE_AT + 1;
  }

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop;
    setCondensed(current => (current ? top > EXPAND_AT : top > CONDENSE_AT));
  }

  function backToTop() {
    scroller.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    titleRef.current?.focus({ preventScroll: true });
  }

  function toggleFollow() {
    const next = !following;
    setFollowing(next);
    notify(next ? "Following Checkout redesign" : "Stopped following Checkout redesign", next ? "success" : "neutral");
  }

  function shareUpdate() {
    if (archived || sharing !== "idle") return;
    setSharing("sending");
    later(() => {
      const index = counters.current.update++;
      const key = `draft-${index}`;
      setUpdates(list => [{ id: key, author: "jasmine", date: "Just now", tone: "success", status: "On track", body: draftUpdates[index % draftUpdates.length]!, fresh: true }, ...list]);
      setSharing("sent");
      selectSection("updates", true);
      notify("Update shared with the project team");
      later(() => setSharing("idle"), 1800);
      later(() => setUpdates(list => list.map(item => item.id === key ? { ...item, fresh: false } : item)), 1800);
    }, 700);
  }

  function createIssue() {
    if (archived) return;
    const index = counters.current.issue++;
    const issue: Issue = { id: `CHK-${139 + index}`, title: draftIssues[index % draftIssues.length]!, owner: "jasmine", label: "Triage", fresh: true };
    setIssues(list => [issue, ...list]);
    selectSection("issues", true);
    notify(`${issue.id} created and assigned to you`);
    later(() => setIssues(list => list.map(item => item.id === issue.id ? { ...item, fresh: false } : item)), 1800);
  }

  function completeIssue(issue: Issue) {
    if (closing.includes(issue.id)) return;
    const index = issues.findIndex(item => item.id === issue.id);
    const remaining = issues.filter(item => item.id !== issue.id && !closing.includes(item.id));
    const neighbor = remaining[Math.min(index, remaining.length - 1)];
    setClosing(list => [...list, issue.id]);
    later(() => {
      const hadFocus = document.activeElement === toggles.current.get(issue.id);
      setIssues(list => list.filter(item => item.id !== issue.id));
      setClosing(list => list.filter(item => item !== issue.id));
      setDone(count => count + 1);
      notify(`${issue.id} marked done`);
      if (hadFocus) (neighbor ? toggles.current.get(neighbor.id) : scroller.current?.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]'))?.focus();
    }, 380);
  }

  function resetIssues() {
    setIssues(startingIssues);
    setDone(DONE_AT_START);
    notify("Sample issues restored", "neutral");
  }

  function toggleArchive() {
    const next = !archived;
    setArchived(next);
    notify(next ? "Project archived. New issues and updates are paused." : "Project restored", "neutral");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(PROJECT_URL);
      notify("Link copied");
    } catch {
      notify("Couldn't copy the link. Try again from the address bar.", "error");
    }
  }

  function openCrumb(label: string) {
    notify(`${label} would open here.`, "neutral");
  }

  const status = archived ? { tone: "neutral" as const, label: "Archived" } : { tone: "success" as const, label: "On track" };
  const menuActions: MenuAction[] = [
    ...(layout.collapsed ? [
      { key: "follow", label: following ? "Unfollow" : "Follow", icon: following ? <BellOff {...icon} /> : <Bell {...icon} />, onSelect: toggleFollow },
      { key: "share", label: "Share update", icon: <Megaphone {...icon} />, onSelect: shareUpdate, disabled: archived || sharing !== "idle" },
    ] : []),
    { key: "copy", label: "Copy link", icon: <Link2 {...icon} />, onSelect: copyLink, separatorBefore: layout.collapsed },
    { key: "archive", label: archived ? "Restore project" : "Archive project", icon: archived ? <ArchiveRestore {...icon} /> : <Archive {...icon} />, onSelect: toggleArchive },
  ];

  /** Leaving copy fades fast; arriving copy settles on the smooth spring with a short blur. */
  const swap = (entering: boolean): Transition => reduce ? still : { ...motionTokens.spring.smooth, opacity: { duration: entering ? motionTokens.duration.standard : motionTokens.duration.fast, ease: [...motionTokens.ease.standard], delay: entering ? .05 : 0 }, filter: { duration: entering ? motionTokens.duration.standard : motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
  const shown = { opacity: 1, y: 0, scale: 1, filter: blur(0) };

  return (
    <TabsPrimitive.Root asChild value={view.section} onValueChange={value => selectSection(value as Section)}>
      <section className={styles.frame} aria-labelledby={`${id}-title`} data-measured={layout.measured || undefined}>
        <header className={styles.header}>
          <div ref={bar} className={styles.bar}>
            <div className={styles.lead}>
              <motion.nav className={styles.crumbs} aria-label="Breadcrumb" inert={condensed} initial={false} animate={condensed ? { opacity: 0, y: -8, filter: blur(motionTokens.blur.subtle) } : shown} transition={swap(!condensed)}>
                <ol>
                  <li className={styles.rootCrumb}><button type="button" className={styles.crumb} onClick={() => openCrumb("Northline")}>Northline</button><ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /></li>
                  <li><button type="button" className={styles.crumb} onClick={() => openCrumb("Projects")}>Projects</button><ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /></li>
                  <li><span className={styles.current} aria-current="page">Checkout redesign</span></li>
                </ol>
              </motion.nav>
              <motion.button type="button" className={styles.compact} inert={!condensed} aria-label="Checkout redesign, back to top" onClick={backToTop} initial={false} animate={condensed ? shown : { opacity: 0, y: 14, filter: blur(motionTokens.blur.soft) }} transition={swap(condensed)}>
                <span className={styles.compactTitle}>Checkout redesign</span>
                <Badge className={styles.compactBadge} size="sm" tone={status.tone} icon={<StatusDot />}>{status.label}</Badge>
              </motion.button>
            </div>

            <div className={styles.actions}>
              <motion.div className={styles.secondary} inert={layout.collapsed} initial={false} animate={layout.collapsed ? { width: 0, opacity: 0 } : { width: "auto", opacity: 1 }} transition={layout.animate && !reduce ? { width: motionTokens.spring.smooth, opacity: { duration: layout.collapsed ? motionTokens.duration.fast : motionTokens.duration.standard, ease: [...motionTokens.ease.standard], delay: layout.collapsed ? .04 : .08 } } : still}>
                <div ref={secondary} className={styles.secondaryInner}>
                  <Button variant="secondary" size="sm" onClick={toggleFollow}>{following ? <><BellRing {...icon} /> Following</> : <><Bell {...icon} /> Follow</>}</Button>
                  <Button variant="secondary" size="sm" loading={sharing === "sending"} disabled={archived} onClick={shareUpdate}>{sharing === "sent" ? <><Check {...icon} /> Shared</> : <><Megaphone {...icon} /> Share update</>}</Button>
                </div>
              </motion.div>
              <div ref={trailing} className={styles.trailing}>
                <OverflowMenu actions={menuActions} reduce={reduce} />
                <Button className={styles.create} size="sm" aria-label="New issue" disabled={archived} onClick={createIssue}><Plus {...icon} /><span className={styles.createText}>New issue</span></Button>
              </div>
            </div>
          </div>

          <motion.div className={styles.intro} initial={false} animate={{ height: condensed ? 0 : "auto" }} transition={reduce ? still : motionTokens.spring.smooth}>
            <div className={styles.introInner}>
              <motion.div className={styles.titleRow} initial={false} animate={condensed ? { opacity: 0, y: -10, scale: .62, filter: blur(motionTokens.blur.subtle) } : shown} transition={swap(!condensed)}>
                <h2 ref={titleRef} id={`${id}-title`} className={styles.title} tabIndex={-1}>Checkout redesign</h2>
                <Badge tone={status.tone} icon={<StatusDot />}>{status.label}</Badge>
              </motion.div>
              <motion.div className={styles.details} initial={false} animate={condensed ? { opacity: 0, y: -6 } : { opacity: 1, y: 0 }} transition={swap(!condensed)}>
                <p className={styles.description}>Rebuilding mobile checkout around saved payment methods and a single review step, then rolling it out in stages from October 14.</p>
                <div className={styles.meta}>
                  <AvatarGroup members={members} max={4} size="sm" label="Project members" />
                  <span>Led by <strong>Emma Collins</strong></span>
                  <span className={styles.metaIcon}><CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" />Target Oct 14</span>
                </div>
              </motion.div>
            </div>
          </motion.div>

          <LayoutGroup id={id}>
            <TabsPrimitive.List asChild aria-label="Project sections">
              <motion.div ref={tabList} layoutScroll className={styles.tabs}>
                {sections.map(item => {
                  const count = item.value === "issues" ? issues.length : item.value === "updates" ? updates.length : item.value === "files" ? files.length : null;
                  return <TabsPrimitive.Trigger key={item.value} value={item.value} className={styles.tab}>
                    <span className={styles.tabLabel}>{item.label}</span>
                    {count !== null && <span className={styles.count}><AnimatedCounter value={count} /></span>}
                    {view.section === item.value && <motion.span className={styles.indicator} layoutId="indicator" layoutDependency={view.section} transition={reduce ? still : motionTokens.spring.morph} aria-hidden="true" />}
                  </TabsPrimitive.Trigger>;
                })}
              </motion.div>
            </TabsPrimitive.List>
          </LayoutGroup>
        </header>

        <div ref={scroller} className={styles.scroller} onScroll={onScroll}>
          <AnimatePresence initial={false} mode="popLayout" custom={view.direction}>
            <TabsPrimitive.Content key={view.section} value={view.section} forceMount asChild>
              <motion.div className={styles.panel} custom={view.direction} variants={reduce ? panelFade : panelSlide} initial="enter" animate="center" exit="exit">
                {view.section === "overview" && <OverviewPanel done={done} open={issues.length} />}
                {view.section === "issues" && <IssuesPanel issues={issues} closing={closing} reduce={reduce} onComplete={completeIssue} onReset={resetIssues} register={(key, node) => { if (node) toggles.current.set(key, node); else toggles.current.delete(key); }} />}
                {view.section === "updates" && <UpdatesPanel updates={updates} reduce={reduce} />}
                {view.section === "files" && <FilesPanel />}
              </motion.div>
            </TabsPrimitive.Content>
          </AnimatePresence>
        </div>

        <div className={styles.toastLayer} aria-hidden="true">
          <AnimatePresence initial={false} mode="popLayout">
            {notice && <motion.div key={notice.key} className={styles.toast} data-tone={notice.tone} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, filter: blur(motionTokens.blur.soft) }} animate={{ opacity: 1, y: 0, filter: blur(0) }} exit={reduce ? { opacity: 0, transition: still } : { opacity: 0, y: 8, filter: blur(motionTokens.blur.subtle), transition: quick }} transition={reduce ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] }, filter: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }}>
              {notice.tone === "success" ? <Check {...icon} /> : notice.tone === "error" ? <CircleAlert {...icon} /> : null}
              <span>{notice.text}</span>
            </motion.div>}
          </AnimatePresence>
        </div>
        <p className={styles.srOnly} role="status" aria-live="polite">{notice?.text}</p>
      </section>
    </TabsPrimitive.Root>
  );
}

export default PageHeader;
