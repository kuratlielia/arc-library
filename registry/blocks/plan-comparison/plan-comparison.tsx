"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { Button } from "@/registry/components/button/button";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { Switch } from "@/registry/components/switch/switch";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./plan-comparison.module.css";

type Plan = "team" | "studio";
type Billing = "monthly" | "yearly";
type Feature = { label: string; team: string; studio: string; shared?: boolean };

const features: Feature[] = [
  { label: "Active projects", team: "Unlimited", studio: "Unlimited", shared: true },
  { label: "Shared workspaces", team: "1 workspace", studio: "Unlimited" },
  { label: "Guest reviewers", team: "5 per project", studio: "Unlimited" },
  { label: "Version history", team: "30 days", studio: "Unlimited" },
  { label: "Approval flows", team: "Not included", studio: "Included" },
  { label: "Custom roles", team: "Not included", studio: "Included" },
  { label: "Source exports", team: "Included", studio: "Included", shared: true },
  { label: "Support", team: "Email", studio: "Priority email" },
];

const pricing: Record<Plan, Record<Billing, number>> = {
  team: { monthly: 13, yearly: 10 },
  studio: { monthly: 27, yearly: 22 },
};

function Value({ text }: { text: string }) {
  if (text === "Included") return <span className={styles.included}><Check size={16} strokeWidth={1.75} aria-hidden="true" />Included</span>;
  return <span className={text === "Not included" ? styles.unavailable : undefined}>{text}</span>;
}

function AnimatedNumber({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);

  useEffect(() => {
    if (reduce) {
      previousValue.current = value;
      return;
    }

    const controls = animate(previousValue.current, value, {
      duration: motionTokens.duration.standard,
      ease: [...motionTokens.ease.enter],
      onUpdate: (latest) => setDisplayValue(Math.round(latest)),
    });

    previousValue.current = value;
    return () => controls.stop();
  }, [reduce, value]);

  return <>{reduce ? value : displayValue}</>;
}

export function PlanComparison() {
  const id = useId();
  const reduce = useReducedMotion();
  const [billing, setBilling] = useState<Billing>("monthly");
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [selected, setSelected] = useState<Plan | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState<"lg" | "md" | "sm" | "xs">("lg");
  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const measure = (width: number) => setSize(width <= 340 ? "xs" : width <= 540 ? "sm" : width <= 720 ? "md" : "lg");
    measure(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => { if (entry) measure(entry.contentRect.width); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const visibleFeatures = differencesOnly ? features.filter((feature) => !feature.shared) : features;

  return (
    <section ref={rootRef} className={styles.comparison} data-size={size} aria-labelledby={`${id}-title`}>
      <div className={styles.intro}>
        <div><h2 id={`${id}-title`}>Room for the way you work</h2><p>Only the details that change between plans. Switch billing to see what you would pay.</p></div>
        <div className={styles.billing}><SegmentedControl label="Billing period" value={billing} onValueChange={(value) => setBilling(value as Billing)} options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }]} /><small>{billing === "yearly" ? "Billed yearly, save up to 23%" : "Billed month to month"}</small></div>
      </div>

      <div className={styles.filter}><div><h3>Compare plans</h3><span className={styles.featureCount}><AnimatedNumber value={visibleFeatures.length} /> of {features.length} features</span></div><Switch checked={differencesOnly} onCheckedChange={setDifferencesOnly} label="Show differences only" /></div>

      <div className={styles.matrix} role="table" aria-label="Team and Studio plan comparison">
        <div className={styles.planHeader} role="row">
          <div className={styles.featureHeader} role="columnheader">What changes</div>
          {(["team", "studio"] as const).map((plan) => (
            <div key={plan} className={`${styles.planCell} ${selected === plan ? styles.planSelected : ""}`} role="columnheader" aria-label={`${plan === "team" ? "Team" : "Studio"} plan`}>
              <div className={styles.planTop}><h3>{plan === "team" ? "Team" : "Studio"}</h3><span>{plan === "team" ? "For smaller teams" : "For work across teams"}</span></div>
              <div className={styles.price}><span className={styles.priceValue} aria-live="polite" aria-atomic="true">$<AnimatedNumber value={pricing[plan][billing]} /></span><span className={styles.pricePeriod}>per seat / month</span></div>
              <Button type="button" variant={selected === plan ? "primary" : "secondary"} className={styles.selectButton} aria-pressed={selected === plan} onClick={() => setSelected(current => current === plan ? null : plan)}>{selected === plan ? "Selected" : `Select ${plan === "team" ? "Team" : "Studio"}`}</Button>
              {selected === plan && <motion.span className={styles.selectedRail} layoutId={`${id}-selected-rail`} transition={reduce ? { duration: 0 } : motionTokens.spring.responsive} aria-hidden="true" />}
            </div>
          ))}
        </div>

        <div className={styles.rows} role="rowgroup">
          <AnimatePresence initial={false}>
            {visibleFeatures.map((feature) => (
              <motion.div key={feature.label} className={styles.featureRow} role="row" initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? undefined : { height: 0, opacity: 0, transition: { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } } }} transition={reduce ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter], delay: .04 } }}>
                <div className={styles.featureName} role="rowheader">{feature.label}</div>
                <div className={`${styles.featureValue} ${selected === "team" ? styles.valueSelected : ""}`} role="cell"><span className={styles.mobilePlan}>Team</span><Value text={feature.team} /></div>
                <div className={`${styles.featureValue} ${selected === "studio" ? styles.valueSelected : ""}`} role="cell"><span className={styles.mobilePlan}>Studio</span><Value text={feature.studio} /></div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className={styles.footer}><span>Prices in USD per seat. Yearly plans are billed annually.</span><p className={styles.srOnly} role="status" aria-live="polite">{selected ? `${selected === "team" ? "Team" : "Studio"} selected` : ""}</p></div>
    </section>
  );
}

export default PlanComparison;
