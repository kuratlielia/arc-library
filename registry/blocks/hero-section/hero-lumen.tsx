"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { BarChart3, BookOpen, ChevronsUpDown, Gauge, LineChart as LineIcon, Search, Settings, Sparkles, Users } from "lucide-react";
import { LineChart } from "@/registry/components/line-chart/line-chart";
import { Sparkline } from "@/registry/components/sparkline/sparkline";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { Avatar } from "@/registry/components/avatar/avatar";
import { avatar } from "@/lib/media";
import { motionTokens } from "@/lib/motion-tokens";
import { ActionLink } from "./hero-content";
import type { HeroAction } from "./hero-content";
import { HeroMesh } from "./hero-mesh";
import type { HeroMeshPoint } from "./hero-mesh";
import { heroGroup, heroRise } from "./hero-motion";
import { lumenInsight, lumenKpis, lumenMovers, lumenRanges, lumenSeries } from "./hero-lumen-data";
import type { LumenRange } from "./hero-lumen-data";
import shell from "./hero-section.module.css";
import styles from "./hero-lumen.module.css";

/** A soft mesh across the whole screen: cool tints at the top, a warm one low behind the window, all a few steps off the page. */
const MESH: HeroMeshPoint[] = [
  { x: .1, y: .92, spread: .7 },
  { x: .92, y: .86, spread: .66 },
  { x: .14, y: .08, spread: .64 },
  { x: .86, y: .04, spread: .6 },
  { x: .5, y: .38, spread: .46 },
];

const NAV = [
  { label: "Overview", icon: Gauge, active: true },
  { label: "Revenue", icon: LineIcon },
  { label: "Customers", icon: Users },
  { label: "Cohorts", icon: BarChart3 },
  { label: "Forecasts", icon: Sparkles },
  { label: "Reports", icon: BookOpen },
];
const VIEWS = [{ label: "Enterprise expansion", tone: "accent" }, { label: "Churn risk", tone: "danger" }, { label: "EU customers", tone: "neutral" }];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compact = (value: number) => value >= 1000 ? `$${+(value / 1000).toFixed(1)}K` : `$${value}`;

/** Width the dashboard is designed at, wide and narrow. It is drawn at that size and scaled to fit, like a screenshot. */
const WIDE = 1200, NARROW = 600;

export interface HeroLumenProps {
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  animateIn?: boolean;
  className?: string;
}

/**
 * Centered hero, one full screen: a headline over a drifting mesh, and a live revenue dashboard rising from the bottom edge. The
 * window settles from a tilt as it enters and runs off the bottom of the screen into a fade. It is real markup built from Arc
 * charts; its range control works.
 */
export function HeroLumen({ primaryAction = { label: "Start free trial", doneLabel: "Trial started" }, secondaryAction = { label: "Book a demo", doneLabel: "Demo requested" }, animateIn = true, className }: HeroLumenProps) {
  const calm = !!useReducedMotion();
  const item = heroRise;
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: WIDE, scale: 1 });

  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => {
      const css = getComputedStyle(node);
      const width = node.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const design = width < 720 ? NARROW : WIDE;
      // On a phone the window keeps a legible size and crops evenly at both edges instead of shrinking to fit.
      setBox({ width: design, scale: design === NARROW ? Math.max(.6, Math.min(1, width / design)) : Math.min(1, width / design) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const narrow = box.width === NARROW;
  const height = narrow ? 700 : 760;

  // Reduced motion: Motion skips every transform (rise, zoom, tilt entrance); opacity still fades briefly.
  return <MotionConfig reducedMotion="user"><section className={[shell.hero, shell.screen, styles.hero, className].filter(Boolean).join(" ")}>
    <HeroMesh className={styles.mesh} points={MESH} grain={.18} speed={.55} />
    <motion.div className={styles.copy} variants={heroGroup} initial={animateIn ? "hidden" : false} animate="shown">
      <motion.h1 variants={item} className={[shell.title, styles.title].join(" ")}>See every dollar of revenue move</motion.h1>
      <motion.p variants={item} className={[shell.description, styles.description].join(" ")}>Lumen connects Stripe, HubSpot and your warehouse, then explains each change in MRR the moment it happens. No SQL, no stale spreadsheets.</motion.p>
      <motion.div variants={item} className={styles.actions}>
        <ActionLink action={primaryAction} kind="primary" />
        <ActionLink action={secondaryAction} kind="secondary" />
      </motion.div>
      <motion.p variants={item} className={styles.fine}>Free for 14 days. Connects in about four minutes.</motion.p>
    </motion.div>

    <motion.div
      ref={stage}
      className={styles.stage}
      initial={animateIn ? { opacity: 0, y: 56 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={calm ? { duration: motionTokens.duration.standard } : { duration: 1.1, ease: [...motionTokens.ease.enter], delay: .32 }}
    >
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.perspective}>
        <motion.div
          className={styles.tilt}
          style={{ width: box.width * box.scale, height: height * box.scale }}
          initial={animateIn ? { rotateX: 22, scale: .94 } : false}
          animate={{ rotateX: 0, scale: 1 }}
          transition={{ duration: 1.5, ease: [...motionTokens.ease.enter], delay: .36 }}
        >
          {/* The scale is a Motion value rather than a CSS transform, so layout animations inside (the date range highlight)
              are projected through it and slide exactly between options at any screen width. */}
          <motion.div className={styles.scaler} style={{ width: box.width, height, scale: box.scale, originX: 0, originY: 0 }}>
            <LumenDashboard narrow={narrow} />
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  </section></MotionConfig>;
}

/** The Lumen app window. Everything is content except the range control, which changes the data the whole screen shows. */
function LumenDashboard({ narrow }: { narrow: boolean }) {
  const [range, setRange] = useState<LumenRange>("30d");
  const insight = lumenInsight[range];
  return <div className={styles.window} data-narrow={narrow || undefined} role="group" aria-label="Lumen revenue dashboard, sample data">
    <div className={styles.chrome} aria-hidden="true">
      <span className={styles.lights}><i /><i /><i /></span>
      <span className={styles.url}>app.lumen.so/acme/overview</span>
    </div>
    <div className={styles.app}>
      {!narrow && <aside className={styles.sidebar}>
        <div className={styles.workspace}>
          <span className={styles.wsMark}>A</span>
          <span className={styles.wsName}>Acme Cloud</span>
          <ChevronsUpDown size={14} strokeWidth={1.75} className={styles.dim} />
        </div>
        <div className={styles.search}><Search size={14} strokeWidth={1.75} />Search<kbd>⌘K</kbd></div>
        <div className={styles.nav}>
          {NAV.map(({ label, icon: Icon, active }) => <div key={label} className={styles.navItem} data-active={active || undefined}><Icon size={15} strokeWidth={1.75} />{label}</div>)}
        </div>
        <div className={styles.groupLabel}>Saved views</div>
        <div className={styles.nav}>
          {VIEWS.map(view => <div key={view.label} className={styles.navItem}><i className={styles.dot} data-tone={view.tone} />{view.label}</div>)}
        </div>
        <div className={styles.me}>
          <Avatar name="Chloe Nguyen" src={avatar("chloe-nguyen")} size="sm" />
          <span><strong>Chloe Nguyen</strong><small>Data analyst</small></span>
          <Settings size={15} strokeWidth={1.75} className={styles.dim} />
        </div>
      </aside>}
      <div className={styles.main}>
        <header className={styles.head}>
          <div>
            <h2 className={styles.h2}>Revenue overview</h2>
            <p className={styles.sub}>Synced with Stripe 2 minutes ago</p>
          </div>
          <SegmentedControl label="Date range" options={lumenRanges} value={range} onValueChange={value => setRange(value as LumenRange)} className={styles.range} />
        </header>

        <div className={styles.kpis}>
          {lumenKpis.map(kpi => {
            const now = kpi.byRange[range];
            return <div key={kpi.id} className={styles.kpi}>
              <Sparkline label={kpi.label} value={now.value} change={now.change} data={now.data} tone={kpi.tone} width={220} height={34} interactive={false} />
            </div>;
          })}
        </div>

        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <p className={styles.insight}><Sparkles size={15} strokeWidth={1.75} className={styles.insightIcon} /><span><strong>{insight.lead}</strong> {insight.rest}</span></p>
              <div className={styles.legend} aria-hidden="true"><span><i className={styles.swatch} />This period</span><span><i className={styles.swatch} data-last="" />Last period</span></div>
            </div>
            <LineChart
              label="Net new MRR"
              data={lumenSeries[range]}
              series={[{ key: "mrr", label: "This period", area: true }, { key: "last", label: "Last period", dashed: true }]}
              height={narrow ? 210 : 232}
              legend={false}
              formatValue={value => money.format(value)}
              formatTick={compact}
            />
          </div>
          {!narrow && <div className={styles.card}>
            <div className={styles.cardTitle}>Biggest movers<span>MRR change</span></div>
            <ul className={styles.movers}>
              {lumenMovers.map(mover => <li key={mover.name}>
                <span className={styles.logo} data-mono={mover.mono || undefined} style={mover.mono ? { maskImage: `url(${mover.logo})`, WebkitMaskImage: `url(${mover.logo})` } : { backgroundImage: `url(${mover.logo})` }} />
                <span className={styles.who}><strong>{mover.name}</strong><small>{mover.change}</small></span>
                <span className={styles.amount} data-down={mover.amount < 0 || undefined}>{mover.amount < 0 ? "−" : "+"}{money.format(Math.abs(mover.amount))}</span>
              </li>)}
            </ul>
          </div>}
        </div>
      </div>
    </div>
  </div>;
}

export default HeroLumen;
