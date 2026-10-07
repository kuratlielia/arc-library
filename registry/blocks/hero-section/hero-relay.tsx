"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Check, Database, Minus, Split } from "lucide-react";
import { Button } from "@/registry/components/button/button";
import { motionTokens } from "@/lib/motion-tokens";
import { ActionLink } from "./hero-content";
import type { HeroAction } from "./hero-content";
import { ease, heroGroup, heroRise, useHeroReducedMotion } from "./hero-motion";
import shell from "./hero-section.module.css";
import styles from "./hero-relay.module.css";

type NodeId = "trigger" | "lookup" | "branch" | "slack" | "linear" | "warehouse";
type Status = "idle" | "running" | "done" | "skipped";

/** Sample events. Each one runs the same workflow; the branch decides which actions it reaches. */
const EVENTS = [
  { customer: "Northwind Labs", amount: "$4,800", plan: "Enterprise, 212 seats", routed: true, issue: "ONB-482", total: 412, ms: { lookup: 118, branch: 2, slack: 164, linear: 231, warehouse: 58 } },
  { customer: "Tidepool", amount: "$240", plan: "Team, 9 seats", routed: false, issue: "", total: 171, ms: { lookup: 96, branch: 1, slack: 0, linear: 0, warehouse: 61 } },
  { customer: "Halcyon Health", amount: "$12,600", plan: "Enterprise, 540 seats", routed: true, issue: "ONB-483", total: 436, ms: { lookup: 131, branch: 2, slack: 149, linear: 244, warehouse: 66 } },
] as const;
type RelayEvent = (typeof EVENTS)[number];

/**
 * One run in phases. Odd phases run a step, even phases carry the data along the edges out of it; the last phase holds the
 * finished run on screen before the next event arrives. Durations in milliseconds.
 */
const PHASES = [900, 420, 380, 640, 380, 360, 440, 760, 2800];
const DONE = PHASES.length - 1;
const STEPS: Record<NodeId, [start: number, end: number]> = { trigger: [1, 2], lookup: [3, 4], branch: [5, 6], slack: [7, 8], linear: [7, 8], warehouse: [7, 8] };
const ACTIONS = ["slack", "linear", "warehouse"] as const;

function statusOf(id: NodeId, phase: number, event: RelayEvent): Status {
  const [start, end] = STEPS[id];
  if ((id === "slack" || id === "linear") && !event.routed && phase >= 6) return "skipped";
  return phase < start ? "idle" : phase < end ? "running" : "done";
}

/** The graph is drawn at a fixed size and scaled to its column, like a screenshot, so it never reflows mid run. */
type Box = { x: number; y: number; w: number; h: number };
const LAYOUTS = {
  wide: {
    width: 640, height: 524, summary: 480,
    nodes: { trigger: { x: 170, y: 0, w: 300, h: 60 }, lookup: { x: 170, y: 112, w: 300, h: 60 }, branch: { x: 170, y: 224, w: 300, h: 60 }, slack: { x: 0, y: 356, w: 200, h: 84 }, linear: { x: 220, y: 356, w: 200, h: 84 }, warehouse: { x: 440, y: 356, w: 200, h: 84 } } as Record<NodeId, Box>,
  },
  narrow: {
    width: 344, height: 316, summary: 0,
    nodes: { trigger: { x: 0, y: 0, w: 344, h: 52 }, lookup: { x: 0, y: 78, w: 344, h: 52 }, branch: { x: 0, y: 156, w: 344, h: 52 }, slack: { x: 0, y: 244, w: 108, h: 72 }, linear: { x: 118, y: 244, w: 108, h: 72 }, warehouse: { x: 236, y: 244, w: 108, h: 72 } } as Record<NodeId, Box>,
  },
};
type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];

const EDGES: { from: NodeId; to: NodeId; phase: number }[] = [
  { from: "trigger", to: "lookup", phase: 2 },
  { from: "lookup", to: "branch", phase: 4 },
  { from: "branch", to: "slack", phase: 6 },
  { from: "branch", to: "linear", phase: 6 },
  { from: "branch", to: "warehouse", phase: 6 },
];

function edgePath(layout: Layout, from: NodeId, to: NodeId) {
  const a = layout.nodes[from], b = layout.nodes[to];
  const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
  const mid = (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${y1 + mid} ${x2} ${y2 - mid} ${x2} ${y2}`;
}

const RESULTS: Record<(typeof ACTIONS)[number], (event: RelayEvent) => string> = {
  slack: event => `Sent in ${event.ms.slack} ms`,
  linear: event => `${event.issue} in ${event.ms.linear} ms`,
  warehouse: event => `Saved in ${event.ms.warehouse} ms`,
};

const logo = (name: string) => <span className={styles.logo} style={{ backgroundImage: `url(/block-logos/${name}.svg)` }} aria-hidden="true" />;

export interface HeroRelayProps {
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  animateIn?: boolean;
  className?: string;
}

/**
 * Split hero, one full screen: the copy beside a live workflow graph on a dotted canvas. Sample Stripe events arrive on their
 * own and run the workflow node by node; the data draws along each edge, the branch decides which actions run, and every step
 * reports its time. "Send test event" runs the next sample at once. The run pauses off screen, and under reduced motion each
 * event shows its finished run without playing.
 */
export function HeroRelay({ primaryAction = { label: "Start building", doneLabel: "Workspace created" }, secondaryAction = { label: "Read the docs", doneLabel: "Opening docs" }, animateIn = true, className }: HeroRelayProps) {
  const item = heroRise;
  const reduced = useHeroReducedMotion();
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<keyof typeof LAYOUTS>("wide");
  const [scale, setScale] = useState(1);
  const [run, setRun] = useState({ index: 0, count: 2418, phase: 0 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const next = width < 520 ? "narrow" : "wide";
      setMode(next);
      setScale(Math.min(1, width / LAYOUTS[next].width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The run only plays while the hero is on screen and the tab is visible.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let onScreen = false;
    const sync = () => setVisible(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(([entry]) => { if (!entry) return; onScreen = entry.isIntersecting; sync(); });
    io.observe(node);
    document.addEventListener("visibilitychange", sync);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);

  useEffect(() => {
    if (reduced || !visible) return;
    const timer = window.setTimeout(() => setRun(current => current.phase < DONE
      ? { ...current, phase: current.phase + 1 }
      : { index: (current.index + 1) % EVENTS.length, count: current.count + 1, phase: 0 }), PHASES[run.phase]);
    return () => window.clearTimeout(timer);
  }, [run.phase, run.index, reduced, visible]);

  const sendTest = () => setRun(current => ({ index: (current.index + 1) % EVENTS.length, count: current.count + 1, phase: 1 }));

  const layout = LAYOUTS[mode];
  const event = EVENTS[run.index]!;
  // Reduced motion: every event is shown as its finished run; the button moves to the next one at once.
  const phase = reduced ? DONE : run.phase;
  const status = (id: NodeId) => statusOf(id, phase, event);
  const narrow = mode === "narrow";

  // Reduced motion: Motion skips every transform (rise, tilt entrance); opacity still fades briefly.
  return <MotionConfig reducedMotion="user"><section ref={root} className={[shell.hero, shell.screen, styles.hero, className].filter(Boolean).join(" ")}>
    <div className={styles.inner}>
      <motion.div className={styles.copy} variants={heroGroup} initial={animateIn ? "hidden" : false} animate="shown">
        <motion.h1 variants={item} className={[shell.title, styles.title].join(" ")}>Every event, handled in milliseconds</motion.h1>
        <motion.p variants={item} className={[shell.description, styles.description].join(" ")}>Relay turns webhooks from Stripe, GitHub and Postgres into typed workflows with retries, branches and a trace of every run. Write steps in TypeScript, or wire them on the canvas.</motion.p>
        <motion.div variants={item} className={styles.actions}>
          <ActionLink action={primaryAction} kind="primary" />
          <ActionLink action={secondaryAction} kind="secondary" />
        </motion.div>
        <motion.p variants={item} className={styles.fine}>Free for 10,000 runs a month. No card needed.</motion.p>
      </motion.div>

      <motion.div
        className={styles.canvas}
        initial={animateIn ? { opacity: 0, y: 24 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: ease.enter, delay: .28 }}
      >
        <div className={styles.toolbar}>
          <span className={styles.file}><i className={styles.live} data-on={visible || reduced || undefined} aria-hidden="true" />on-invoice-paid.ts</span>
          <Button variant="secondary" size="sm" onClick={sendTest}>Send test event</Button>
        </div>
        <div ref={stage} className={styles.stage} style={{ height: layout.height * scale }}>
          <div className={styles.graph} role="group" aria-label={`Relay workflow, sample run for ${event.customer}`} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
            <svg className={styles.edges} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              {EDGES.map(edge => {
                const d = edgePath(layout, edge.from, edge.to);
                const skipped = status(edge.to) === "skipped";
                const lit = phase >= edge.phase && !skipped;
                return <g key={`${edge.from}-${edge.to}`}>
                  <path d={d} className={styles.wire} data-skipped={skipped || undefined} />
                  <motion.path
                    d={d}
                    className={styles.flow}
                    initial={false}
                    animate={{ pathLength: lit ? 1 : 0, opacity: lit ? 1 : 0 }}
                    transition={lit && !reduced ? { pathLength: { duration: PHASES[edge.phase]! / 1000, ease: ease.inOut }, opacity: { duration: .08 } } : { duration: 0 }}
                  />
                </g>;
              })}
            </svg>

            <RelayNode box={layout.nodes.trigger} status={status("trigger")} icon={logo("stripe-color")} title="Invoice paid" sub={`${event.customer}, ${event.amount}`} />
            <RelayNode box={layout.nodes.lookup} status={status("lookup")} icon={logo("hubspot-color")} title="Find account in HubSpot" sub={status("lookup") === "done" ? event.plan : "Plan, seats and owner"} meta={`${event.ms.lookup} ms`} />
            <RelayNode box={layout.nodes.branch} status={status("branch")} icon={<Split size={17} strokeWidth={1.75} className={styles.glyph} aria-hidden="true" />} title="Amount over $1,000" sub={status("branch") === "done" ? event.routed ? "Yes, alert the team" : "No, record only" : "Condition"} meta={`${event.ms.branch} ms`} />
            {ACTIONS.map(id => {
              const s = status(id);
              const copy = {
                slack: { icon: logo("slack-color"), title: narrow ? "Slack" : "Post to #revenue", waiting: "Slack" },
                linear: { icon: logo("linear-color"), title: narrow ? "Linear" : "Create Linear issue", waiting: "Onboarding team" },
                warehouse: { icon: <Database size={16} strokeWidth={1.75} className={styles.glyph} aria-hidden="true" />, title: narrow ? "Warehouse" : "Save to warehouse", waiting: "Postgres" },
              }[id];
              const sub = s === "skipped" ? "Skipped" : s === "done" ? narrow ? `${event.ms[id]} ms` : RESULTS[id](event) : s === "running" ? "Running" : narrow ? "Waiting" : copy.waiting;
              return <RelayNode key={id} box={layout.nodes[id]} compact status={s} icon={copy.icon} title={copy.title} sub={sub} />;
            })}

            {!narrow && <div className={styles.summary} style={{ top: layout.summary, width: layout.width }}>
              <span className={styles.event}><code>invoice.paid</code><span>Run <span className={styles.num}>{run.count.toLocaleString("en-US")}</span></span></span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={phase === DONE ? `done-${run.count}` : phase === 0 ? "waiting" : "running"}
                  className={styles.result}
                  data-done={phase === DONE || undefined}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: motionTokens.duration.fast, ease: ease.standard }}
                >
                  {phase === DONE ? <><Check size={14} strokeWidth={2} aria-hidden="true" /><span>Completed in <span className={styles.num}>{event.total} ms</span></span></> : phase === 0 ? "Waiting for the next event" : <><i className={styles.spinner} aria-hidden="true" />Running</>}
                </motion.span>
              </AnimatePresence>
            </div>}
          </div>
        </div>
      </motion.div>
    </div>
  </section></MotionConfig>;
}

function RelayNode({ box, status, icon, title, sub, meta, compact = false }: { box: Box; status: Status; icon: ReactNode; title: string; sub: string; meta?: string; compact?: boolean }) {
  return <div className={styles.node} data-status={status} data-compact={compact || undefined} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
    <span className={styles.icon}>{icon}</span>
    <span className={styles.text}>
      <strong>{title}</strong>
      <small>{sub}</small>
    </span>
    <span className={styles.state}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          className={styles.stateInner}
          initial={{ opacity: 0, scale: .6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: .6 }}
          transition={motionTokens.spring.snappy}
        >
          {status === "running" ? <i className={styles.spinner} role="img" aria-label="Running" />
            : status === "done" ? <>{meta && <span className={styles.meta}>{meta}</span>}<Check size={14} strokeWidth={2} className={styles.check} role="img" aria-label="Done" /></>
            : status === "skipped" ? <Minus size={14} strokeWidth={2} className={styles.skip} role="img" aria-label="Skipped" />
            : <i className={styles.pending} role="img" aria-label="Waiting" />}
        </motion.span>
      </AnimatePresence>
    </span>
  </div>;
}

export default HeroRelay;
