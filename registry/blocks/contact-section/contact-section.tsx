"use client";

import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useAnimate, useIsPresent, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { Check, Clock, Mail, MessageCircle, Phone, Users } from "lucide-react";
import { Avatar } from "@/registry/components/avatar/avatar";
import { Button } from "@/registry/components/button/button";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { Input } from "@/registry/components/input/input";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { Textarea } from "@/registry/components/textarea/textarea";
import { motionTokens } from "@/lib/motion-tokens";
import { person } from "@/lib/media";
import styles from "./contact-section.module.css";

export type ContactSectionVariant = "form" | "channels" | "offices";

export interface ContactMessage {
  name: string;
  email: string;
  topic: string;
  message: string;
}

export interface ContactChannel {
  value: string;
  label: string;
  /** One line under the label in the list, such as a response time. */
  meta: string;
  icon?: ReactNode;
  /** The detail shown when the channel is selected. */
  detail: ReactNode;
}

export interface ContactOffice {
  city: string;
  /** IANA time zone, used for the live local time and open status. */
  timeZone: string;
  address: string[];
  email?: string;
  /** Opening hours in local 24 hour time. Defaults to 9 to 18. */
  hours?: [number, number];
}

export interface ContactSectionProps {
  /** `form` validates and morphs into a confirmation, `channels` lists ways to reach you, `offices` shows live local times. */
  variant?: ContactSectionVariant;
  title?: string;
  description?: string;
  /** Topics offered in the form. */
  topics?: string[];
  /** Called with a valid message. Reject to keep the form and show an error; resolve to show the confirmation. */
  onSubmit?: (message: ContactMessage) => void | Promise<void>;
  channels?: ContactChannel[];
  /** Selected channel (controlled). */
  channel?: string;
  defaultChannel?: string;
  onChannelChange?: (value: string) => void;
  offices?: ContactOffice[];
  className?: string;
}

type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_MESSAGE = 500;

/** Faces slide along one axis in the direction of travel and settle out of a soft blur. */
const faceVariants: Variants = {
  hidden: ({ direction, axis }: { direction: number; axis: "x" | "y" }) => ({ opacity: 0, x: axis === "x" ? direction * 18 : 0, y: axis === "y" ? direction * 18 : 0, filter: `blur(${motionTokens.blur.soft}px)` }),
  shown: { opacity: 1, x: 0, y: 0, filter: "blur(0px)", transition: { x: motionTokens.spring.smooth, y: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: enter, delay: .04 }, filter: { duration: motionTokens.duration.standard, ease: enter, delay: .04 } } },
  gone: ({ direction, axis }: { direction: number; axis: "x" | "y" }) => ({ opacity: 0, x: axis === "x" ? direction * -12 : 0, y: axis === "y" ? direction * -12 : 0, filter: `blur(${motionTokens.blur.soft}px)`, transition: { duration: motionTokens.duration.fast, ease: standard } }),
};
const fadeVariants: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: motionTokens.duration.fast } }, gone: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };

function Face({ children, custom, reduced, className }: { children: ReactNode; custom: { direction: number; axis: "x" | "y" }; reduced: boolean; className?: string }) {
  const present = useIsPresent();
  return <motion.div className={className} data-face="" data-leaving={present ? undefined : ""} inert={!present} custom={custom} variants={reduced ? fadeVariants : faceVariants} initial="hidden" animate="shown" exit="gone">{children}</motion.div>;
}

/**
 * One surface that springs from the height of its old content to the new one when `faceKey` changes, while the faces
 * crossfade along an axis. Between switches the height is automatic, so fields that grow inside it never get clipped.
 */
function MorphPanel({ faceKey, direction = 1, axis = "y", reduced, className, children, ...rest }: { faceKey: string; direction?: number; axis?: "x" | "y"; reduced: boolean; className?: string; children: ReactNode; id?: string; role?: string; "aria-labelledby"?: string }) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const lastKey = useRef(faceKey);
  const lastHeight = useRef(0);
  useEffect(() => {
    const node = scope.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    lastHeight.current = node.offsetHeight;
    const observer = new ResizeObserver(() => { lastHeight.current = node.offsetHeight; });
    observer.observe(node);
    return () => observer.disconnect();
  }, [scope]);
  useLayoutEffect(() => {
    if (lastKey.current === faceKey) return;
    lastKey.current = faceKey;
    const node = scope.current;
    const face = node?.querySelector<HTMLElement>(":scope > [data-face]:not([data-leaving])");
    if (!node || !face || reduced) return;
    const from = lastHeight.current || node.offsetHeight;
    const to = face.offsetHeight;
    if (Math.abs(from - to) < 1) return;
    node.style.setProperty("height", `${from}px`);
    const controls = animate(node, { height: [from, to] }, motionTokens.spring.smooth);
    controls.then(() => node.style.removeProperty("height"));
    return () => { controls.stop(); node.style.removeProperty("height"); };
  }, [faceKey, animate, scope, reduced]);
  return <div ref={scope} className={[styles.morph, className].filter(Boolean).join(" ")} {...rest}>
    <AnimatePresence initial={false} mode="popLayout" custom={{ direction, axis }}>
      <Face key={faceKey} custom={{ direction, axis }} reduced={reduced} className={styles.face}>{children}</Face>
    </AnimatePresence>
  </div>;
}

/** Topic chips as a radio group: a highlight glides to the choice and arrow keys move it. */
function TopicPicker({ topics, value, onChange, reduced }: { topics: string[]; value: string; onChange: (topic: string) => void; reduced: boolean }) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: KeyboardEvent) {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (topics.indexOf(value) + delta + topics.length) % topics.length;
    onChange(topics[next]);
    refs.current[next]?.focus();
  }
  return <div className={styles.topicField}>
    <span id={`${id}-label`} className={styles.fieldLabel}>Topic</span>
    <LayoutGroup id={id}>
      <div className={styles.topics} role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={onKeyDown}>
        {topics.map((topic, index) => <button key={topic} ref={node => { refs.current[index] = node; }} type="button" role="radio" aria-checked={topic === value} tabIndex={topic === value ? 0 : -1} className={styles.topic} onClick={() => onChange(topic)}>
          {topic === value && <motion.span layoutId="topic" className={styles.topicHighlight} transition={reduced ? { duration: 0 } : motionTokens.spring.morph} aria-hidden="true" />}
          <span>{topic}</span>
        </button>)}
      </div>
    </LayoutGroup>
  </div>;
}

type Errors = Partial<Record<"name" | "email" | "message", string>>;
function validate(values: { name: string; email: string; message: string }): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) errors.name = "Enter your name";
  if (!values.email.trim()) errors.email = "Enter your email address";
  else if (!EMAIL.test(values.email.trim())) errors.email = "Enter an email like name@example.com";
  if (values.message.trim().length < 20) errors.message = values.message.trim() ? "Add a little more detail, at least 20 characters" : "Tell us how we can help";
  return errors;
}

function ContactForm({ topics, onSubmit, reduced }: { topics: string[]; onSubmit?: ContactSectionProps["onSubmit"]; reduced: boolean }) {
  const [values, setValues] = useState({ name: "", email: "", message: "" });
  const [topic, setTopic] = useState(topics[0] ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<"editing" | "sending" | "sent">("editing");
  const [failure, setFailure] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState({ name: "", email: "" });
  const nameRef = useRef<HTMLInputElement>(null), emailRef = useRef<HTMLInputElement>(null), messageRef = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase === "sent") successRef.current?.focus();
    if (phase === "editing" && restoreFocus.current) { restoreFocus.current = false; nameRef.current?.focus(); }
  }, [phase]);

  const update = (field: keyof typeof values) => (event: { target: { value: string } }) => {
    const next = { ...values, [field]: event.target.value };
    setValues(next);
    if (submitted) setErrors(validate(next));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (phase !== "editing") return;
    setSubmitted(true);
    setFailure(null);
    const found = validate(values);
    setErrors(found);
    if (found.name) { nameRef.current?.focus(); return; }
    if (found.email) { emailRef.current?.focus(); return; }
    if (found.message) { messageRef.current?.focus(); return; }
    setPhase("sending");
    const payload = { name: values.name.trim(), email: values.email.trim(), topic, message: values.message.trim() };
    try {
      await (onSubmit ? onSubmit(payload) : new Promise(resolve => setTimeout(resolve, 1100)));
      setSentTo({ name: payload.name.split(/\s+/)[0], email: payload.email });
      setPhase("sent");
    } catch {
      setPhase("editing");
      setFailure("We couldn't send your message. Check your connection and try again.");
    }
  }

  function reset() {
    setValues({ name: "", email: "", message: "" });
    setErrors({});
    setSubmitted(false);
    setFailure(null);
    restoreFocus.current = true;
    setPhase("editing");
  }

  const left = MAX_MESSAGE - values.message.length;
  return <MorphPanel faceKey={phase === "sent" ? "sent" : "form"} direction={phase === "sent" ? 1 : -1} reduced={reduced} className={styles.formCard}>
    {phase === "sent"
      ? <div className={styles.success} aria-live="polite">
          <span className={styles.successMark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : .42, ease: enter, delay: .16 }} />
            </svg>
          </span>
          <h3 ref={successRef} tabIndex={-1} className={styles.successTitle}>Thanks, {sentTo.name}</h3>
          <p className={styles.successText}>Your message is with our {topic.toLowerCase()} team. We&rsquo;ll reply to {sentTo.email} within one business day.</p>
          <Button variant="secondary" onClick={reset}>Send another message</Button>
        </div>
      : <form className={styles.formBody} onSubmit={submit} noValidate aria-label="Contact form">
          <div className={styles.row}>
            <Input ref={nameRef} label="Name" name="name" autoComplete="name" placeholder="Emma Collins" value={values.name} onChange={update("name")} error={errors.name} readOnly={phase === "sending"} />
            <Input ref={emailRef} label="Work email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="emma@northwind.example" value={values.email} onChange={update("email")} error={errors.email} readOnly={phase === "sending"} />
          </div>
          <TopicPicker topics={topics} value={topic} onChange={setTopic} reduced={reduced} />
          <Textarea ref={messageRef} label="Message" name="message" rows={4} maxLength={MAX_MESSAGE} placeholder="What are you building?" value={values.message} onChange={update("message")} error={errors.message} description={`${left} characters left`} readOnly={phase === "sending"} />
          <AnimatePresence initial={false}>
            {failure && <motion.p key="failure" role="alert" className={styles.failure} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: standard } }}>{failure}</motion.p>}
          </AnimatePresence>
          <div className={styles.submitRow}>
            <p className={styles.fine}>We reply within one business day.</p>
            <Button type="submit" variant="primary" loading={phase === "sending"}>Send message</Button>
          </div>
        </form>}
  </MorphPanel>;
}

const hannah = person("hannah-walsh");
const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

/** A demo action that confirms in place: the label morphs, and the result stays visible below it. */
function ConfirmAction({ idle, busy, done, note }: { idle: string; busy?: boolean; done: string; note?: ReactNode }) {
  const reduced = !!useReducedMotion();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <div className={styles.confirm}>
    <Button variant={state === "done" ? "secondary" : "primary"} loading={state === "busy"} onClick={() => {
      if (state !== "idle") { setState("idle"); return; }
      if (busy) { setState("busy"); timer.current = window.setTimeout(() => setState("done"), 800); } else setState("done");
    }}>
      {state === "done" ? <><Check size={15} strokeWidth={2.25} aria-hidden="true" />{done}</> : idle}
    </Button>
    <div aria-live="polite">
      <AnimatePresence initial={false}>
        {state === "done" && note && <motion.div key="note" className={styles.confirmNote} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: standard } }}>{note}</motion.div>}
      </AnimatePresence>
    </div>
  </div>;
}

export const contactExampleChannels: ContactChannel[] = [
  {
    value: "chat", label: "Chat with support", meta: "Replies in about 4 minutes", icon: <MessageCircle {...ICON} />,
    detail: <>
      <h3>Chat with support</h3>
      <p>Hannah and Jordan are online now. Chat is best for quick questions about installing, theming, or a component that misbehaves.</p>
      <ConfirmAction idle="Start a chat" busy done="Chat started" note={<span className={styles.agent}><Avatar name={hannah.name} src={hannah.src} size="sm" status="online" /><span><strong>{hannah.name}</strong> joined the chat. Say hello.</span></span>} />
    </>,
  },
  {
    value: "email", label: "Email support", meta: "Replies within a business day", icon: <Mail {...ICON} />,
    detail: <>
      <h3>Email support</h3>
      <p>Send screenshots, links, or a reproduction. Every message gets a reply from a person within one business day.</p>
      <div className={styles.copyRow}><span>support@example.com</span><CopyButton value="support@example.com" label="Copy email" /></div>
    </>,
  },
  {
    value: "sales", label: "Talk to sales", meta: "Weekdays, 9am to 6pm PT", icon: <Phone {...ICON} />,
    detail: <>
      <h3>Talk to sales</h3>
      <p>Licensing for a larger team, invoicing, or a security review. Tyler will walk you through it on a 20 minute call.</p>
      <div className={styles.copyRow}><span className={styles.tabular}>+1 (415) 555-0132</span><CopyButton value="+14155550132" label="Copy number" /></div>
      <ConfirmAction idle="Request a call" busy done="Call requested" note="Tyler will email you a few times that work this week." />
    </>,
  },
  {
    value: "community", label: "Ask the community", meta: "4,200 members", icon: <Users {...ICON} />,
    detail: <>
      <h3>Ask the community</h3>
      <p>Designers and engineers who ship with Arc answer questions about components, theming, and motion, usually within the hour.</p>
      <ConfirmAction idle="Open the forum" done="Forum opened" note="The forum opens in a new tab on the live site." />
    </>,
  },
];

export const contactExampleOffices: ContactOffice[] = [
  { city: "San Francisco", timeZone: "America/Los_Angeles", address: ["100 Example Street, Floor 4", "San Francisco, CA 94000"], email: "sf@example.com" },
  { city: "New York", timeZone: "America/New_York", address: ["200 Sample Avenue, Suite 12", "New York, NY 10000"], email: "nyc@example.com" },
  { city: "Lisbon", timeZone: "Europe/Lisbon", address: ["Rua do Exemplo 10, 3º", "1000-000 Lisboa, Portugal"], email: "lisbon@example.com" },
];

function useNow(intervalMs: number) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function officeState(office: ContactOffice, now: Date | null) {
  if (!now) return { time: "--:--", open: null as boolean | null };
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: office.timeZone, hour: "numeric", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const hour = Number(get("hour")), weekday = get("weekday");
  const [start, end] = office.hours ?? [9, 18];
  const time = new Intl.DateTimeFormat("en-US", { timeZone: office.timeZone, hour: "numeric", minute: "2-digit" }).format(now);
  return { time, open: weekday !== "Sat" && weekday !== "Sun" && hour >= start && hour < end };
}

const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 || hour === 24 ? "am" : "pm"}`;

function Offices({ offices }: { offices: ContactOffice[] }) {
  const now = useNow(15000);
  return <ul className={styles.offices}>
    {offices.map(office => {
      const { time, open } = officeState(office, now);
      return <li key={office.city} className={styles.office}>
        <div className={styles.officeHead}>
          <h3>{office.city}</h3>
          <span className={styles.officeTime}><Clock size={14} strokeWidth={1.75} aria-hidden="true" /><span className={styles.tabular}>{time}</span></span>
        </div>
        <span className={styles.officeStatus} data-open={open === null ? undefined : open ? "" : undefined} data-closed={open === false ? "" : undefined}>
          <span className={styles.statusDot} aria-hidden="true" />{open === null ? "Checking hours" : open ? `Open until ${hourLabel((office.hours ?? [9, 18])[1])}` : "Closed now"}
        </span>
        <address className={styles.address}>{office.address.map(line => <span key={line}>{line}</span>)}</address>
        <div className={styles.officeActions}>
          {office.email && <a className={styles.officeLink} href={`mailto:${office.email}`}>{office.email}</a>}
          <CopyButton value={office.address.join(", ")} label="Copy address" variant="plain" />
        </div>
      </li>;
    })}
  </ul>;
}

function Channels({ channels, value, onChange, reduced }: { channels: ContactChannel[]; value: string; onChange: (value: string) => void; reduced: boolean }) {
  const id = useId();
  const [direction, setDirection] = useState(1);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = channels.find(channel => channel.value === value) ?? channels[0];
  const choose = (next: string) => {
    if (next === active.value) return;
    setDirection(Math.sign(channels.findIndex(channel => channel.value === next) - channels.indexOf(active)) || 1);
    onChange(next);
  };
  function onKeyDown(event: KeyboardEvent) {
    const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    const edge = event.key === "Home" ? 0 : event.key === "End" ? channels.length - 1 : -1;
    if (!delta && edge < 0) return;
    event.preventDefault();
    const next = edge >= 0 ? edge : (channels.indexOf(active) + delta + channels.length) % channels.length;
    choose(channels[next].value);
    refs.current[next]?.focus();
  }
  return <div className={styles.channels}>
    <LayoutGroup id={id}>
      <div className={styles.channelList} role="tablist" aria-orientation="vertical" aria-label="Ways to reach us" onKeyDown={onKeyDown}>
        {channels.map((channel, index) => {
          const selected = channel.value === active.value;
          return <button key={channel.value} ref={node => { refs.current[index] = node; }} type="button" role="tab" id={`${id}-tab-${channel.value}`} aria-selected={selected} aria-controls={`${id}-panel`} tabIndex={selected ? 0 : -1} className={styles.channel} onClick={() => choose(channel.value)}>
            {selected && <motion.span layoutId="channel" className={styles.channelHighlight} transition={reduced ? { duration: 0 } : motionTokens.spring.morph} aria-hidden="true" />}
            <span className={styles.channelIcon}>{channel.icon}</span>
            <span className={styles.channelText}><span>{channel.label}</span><span>{channel.meta}</span></span>
          </button>;
        })}
      </div>
    </LayoutGroup>
    <MorphPanel faceKey={active.value} direction={direction} axis="y" reduced={reduced} className={styles.channelPanel} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active.value}`}>
      <div className={styles.channelDetail}>{active.detail}</div>
    </MorphPanel>
  </div>;
}

/**
 * A contact section in three layouts: a validated form whose card springs into a confirmation, a list of support
 * channels whose detail panel morphs to each channel, and office cards with live local times and open status.
 */
export const ContactSection = forwardRef<HTMLElement, ContactSectionProps>(function ContactSection({
  variant = "form",
  title,
  description,
  topics = ["Sales", "Support", "Partnerships", "Press"],
  onSubmit,
  channels = contactExampleChannels,
  channel: channelProp,
  defaultChannel,
  onChannelChange,
  offices = contactExampleOffices,
  className,
}, ref) {
  const id = useId();
  const reduced = !!useReducedMotion();
  const [innerChannel, setInnerChannel] = useState(defaultChannel ?? channels[0]?.value ?? "");
  const activeChannel = channelProp ?? innerChannel;
  const setChannel = (next: string) => { if (channelProp === undefined) setInnerChannel(next); onChannelChange?.(next); };
  const copy = {
    form: { title: "Talk to our team", description: "Questions about licensing, a bug you can't pin down, or a component you wish existed. A person reads every message." },
    channels: { title: "Get help your way", description: "Pick whatever suits the question. Every channel reaches the same small team." },
    offices: { title: "Visit us", description: "We work across three time zones, so someone is usually awake. Drop by for coffee, just let us know first." },
  }[variant];

  return <section ref={ref} className={[styles.contact, className].filter(Boolean).join(" ")} data-variant={variant} aria-labelledby={`${id}-title`}>
    <div className={styles.inner}>
      <div className={styles.intro}>
        <h2 id={`${id}-title`} className={styles.title}>{title ?? copy.title}</h2>
        <p className={styles.description}>{description ?? copy.description}</p>
        {variant === "form" && <ul className={styles.facts}>
          <li><Clock size={16} strokeWidth={1.75} aria-hidden="true" />Replies within one business day</li>
          <li><Mail size={16} strokeWidth={1.75} aria-hidden="true" /><span>hello@example.com</span><CopyButton value="hello@example.com" label="Copy email" iconOnly variant="plain" /></li>
        </ul>}
      </div>
      {variant === "form" && <ContactForm topics={topics} onSubmit={onSubmit} reduced={reduced} />}
      {variant === "channels" && <Channels channels={channels} value={activeChannel} onChange={setChannel} reduced={reduced} />}
      {variant === "offices" && <Offices offices={offices} />}
    </div>
  </section>;
});

ContactSection.displayName = "ContactSection";

const variantOptions = [{ value: "form", label: "Form" }, { value: "channels", label: "Channels" }, { value: "offices", label: "Offices" }];

/** Preview: the contact section with a switch between its three layouts. Messages are simulated and never sent. */
export function ContactSectionBlock({ variant: initial = "form" }: { variant?: ContactSectionVariant }) {
  const [variant, setVariant] = useState<ContactSectionVariant>(initial);
  return <div className={styles.preview}>
    <SegmentedControl label="Contact layout" options={variantOptions} value={variant} onValueChange={next => setVariant(next as ContactSectionVariant)} />
    <div className={styles.frame}>
      <ContactSection key={variant} variant={variant} />
    </div>
  </div>;
}

export default ContactSectionBlock;
