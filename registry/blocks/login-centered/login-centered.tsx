"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionStyle, type Transition, type Variants } from "motion/react";
import { Check, FingerprintPattern, Mail } from "lucide-react";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import { OtpInput } from "@/registry/components/otp-input/otp-input";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./login-centered.module.css";

type Step = "passkey" | "email" | "code" | "done";
type Mode = "sign-in" | "sign-up";
type Provider = "Google" | "Apple" | "GitHub";
type PasskeyPhase = "idle" | "waiting" | "verified";
export type LoginMethod = "Passkey" | "Email code" | Provider;
export interface LoginCenteredProps {
  /** The code the simulated email contains. */
  demoCode?: string;
  /** Fill the viewport (100dvh, no frame) when the block is the whole page. */
  fullScreen?: boolean;
  /** The account a simulated passkey or single sign-on resolves to. */
  demoEmail?: string;
  termsHref?: string;
  privacyHref?: string;
  /** Called once the simulated sign in or sign up succeeds. */
  onSignIn?: (email: string, method: LoginMethod, mode: Mode) => void;
  className?: string;
}
type StepCustom = { direction: number; reduce: boolean };

const RESEND_SECONDS = 30;
/** The official four-colour Google "G"; Apple and GitHub ship monochrome marks, drawn in currentColor. */
function GoogleLogo({ className }: { className?: string }) {
  return <svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>;
}

const providers: Provider[] = ["Google", "Apple", "GitHub"];
/** Monochrome provider marks in currentColor, so they stay neutral in both themes. */
const providerMarks: Record<Provider, string> = {
  Google: "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",
  Apple: "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
  GitHub: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
};
/** Concentric rings behind the card. Outer rings drift further, so the set reads as depth rather than a flat pattern. */
const rings = Array.from({ length: 14 }, (_, index) => ({ r: 224 + index * 60, k: 1 + index * .34, major: index % 3 === 2 }));
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

/** Steps rise into place out of a small blur; going back, they settle down from above. */
const stepMotion: Variants = {
  enter: ({ direction, reduce }: StepCustom) => reduce ? { opacity: 0 } : { opacity: 0, y: direction * 12, filter: `blur(${motionTokens.blur.soft}px)` },
  center: ({ reduce }: StepCustom) => ({ opacity: 1, y: 0, filter: "blur(0px)", transition: reduce ? { duration: motionTokens.duration.instant } : { y: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: motionTokens.ease.enter, delay: .06 }, filter: { duration: motionTokens.duration.standard, ease: motionTokens.ease.enter, delay: .04 } } }),
  exit: ({ direction, reduce }: StepCustom) => reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: direction * -8, filter: `blur(${motionTokens.blur.soft}px)`, transition: { duration: motionTokens.duration.exit, ease: motionTokens.ease.standard } },
};
const swap = (reduce: boolean) => ({
  initial: reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: `blur(${motionTokens.blur.soft}px)` },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast } },
  transition: (reduce ? { duration: motionTokens.duration.instant } : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }) as Transition,
});
/** Both header labels share one cell and cross-fade in place, so the switch never changes width when the mode flips. */
const labelState = (active: boolean, reduce: boolean) => active ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: reduce ? 0 : -6, filter: `blur(${reduce ? 0 : motionTokens.blur.subtle}px)` };
const labelTransition = (reduce: boolean): Transition => reduce ? { duration: motionTokens.duration.instant } : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] };
/** Seconds roll down while the timer runs and back up when a new code restarts it. */
const roll: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${-0.7 * direction}em`, filter: `blur(${motionTokens.blur.subtle}px)` }),
  center: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: (direction: number) => ({ opacity: 0, y: `${0.7 * direction}em`, filter: `blur(${motionTokens.blur.subtle}px)` }),
};

function RollingTime({ seconds, reduce }: { seconds: number; reduce: boolean }) {
  const [shown, setShown] = useState({ seconds, direction: 1 });
  if (shown.seconds !== seconds) setShown({ seconds, direction: seconds < shown.seconds ? 1 : -1 });
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const transition: Transition = reduce ? { duration: 0 } : { y: motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast }, filter: { duration: motionTokens.duration.fast } };
  return <span className={styles.time}>{text.split("").map((character, index) => <span key={index} className={styles.timeColumn}>
    <AnimatePresence initial={false} mode="popLayout" custom={shown.direction}><motion.span key={character} custom={shown.direction} variants={roll} initial="enter" animate="center" exit="exit" transition={transition}>{character}</motion.span></AnimatePresence>
  </span>)}</span>;
}

/** Two rings leave the fingerprint while the device is asked, then stop on their own. */
function PasskeyPulse({ reduce }: { reduce: boolean }) {
  return <span className={styles.pulse}>
    {!reduce && [0, 1].map(index => <motion.span key={index} className={styles.pulseRing} initial={{ scale: .7, opacity: 0 }} animate={{ scale: [.7, 2.1], opacity: [.6, 0] }} transition={{ duration: 1.2, ease: [...motionTokens.ease.standard], delay: index * .6 }} />)}
    <FingerprintPattern size={16} strokeWidth={1.75} aria-hidden="true" />
  </span>;
}

/** The card follows its content on a spring only while the view changes; otherwise it stays auto, so field messages open without lag. */
function useViewHeight(view: string, reduce: boolean) {
  const track = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | "auto">("auto");
  const measured = useRef(0);
  const gliding = useRef(false);
  const lastView = useRef(view);
  const glide = useCallback((to: number) => {
    gliding.current = true;
    animate(height, to, { ...motionTokens.spring.smooth, onComplete: () => { gliding.current = false; height.jump("auto"); } });
  }, [height]);
  useEffect(() => {
    const node = track.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      measured.current = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
      if (gliding.current) glide(measured.current);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [glide]);
  useLayoutEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    const current = height.get();
    const from = typeof current === "number" ? current : measured.current;
    const to = track.current?.offsetHeight ?? 0;
    if (reduce || !from || !to) { gliding.current = false; height.jump("auto"); return; }
    if (current === "auto") height.jump(from);
    glide(to);
  }, [view, reduce, height, glide]);
  return { track, height };
}

/** Pointer drift for the line backdrop: fine pointers with hover only, never under reduced motion. */
function useDrift(reduce: boolean) {
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const x = useSpring(pointerX, { visualDuration: .9, bounce: 0 });
  const y = useSpring(pointerY, { visualDuration: .9, bounce: 0 });
  const dx = useTransform(x, value => `${value.toFixed(2)}px`);
  const dy = useTransform(y, value => `${value.toFixed(2)}px`);
  const canHover = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => { canHover.current = query.matches; };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (reduce || !canHover.current || event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    pointerX.set(((event.clientX - box.left) / box.width - .5) * -2);
    pointerY.set(((event.clientY - box.top) / box.height - .5) * -2);
  };
  const onPointerLeave = () => { pointerX.set(0); pointerY.set(0); };
  return { style: { "--dx": dx, "--dy": dy } as MotionStyle, onPointerMove, onPointerLeave };
}

export function LoginCentered({ demoCode = "482913", fullScreen = false, demoEmail = "maya@northwind.studio", termsHref = "#terms", privacyHref = "#privacy", onSignIn, className }: LoginCenteredProps) {
  const reduce = !!useReducedMotion();
  const [step, setStep] = useState<Step>("passkey");
  const [mode, setMode] = useState<Mode>("sign-in");
  const [direction, setDirection] = useState(1);
  const [passkey, setPasskey] = useState<PasskeyPhase>("idle");
  const [busy, setBusy] = useState<null | "email" | "code" | Provider>(null);
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [account, setAccount] = useState(demoEmail);
  const [method, setMethod] = useState<LoginMethod>("Passkey");
  const [status, setStatus] = useState("");
  const passkeyRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<Step | null>(null);
  const timers = useRef<number[]>([]);
  const view = step === "email" ? `email-${mode}` : step;
  const { track, height } = useViewHeight(view, reduce);
  const drift = useDrift(reduce);

  const emailError = (touched || attempted) && !isEmail(email) ? (email.trim() ? "Enter a full address, like name@example.com." : "Enter your email address.") : "";
  const custom: StepCustom = { direction, reduce };
  const signingUp = mode === "sign-up";

  useEffect(() => { const pending = timers; return () => pending.current.forEach(window.clearTimeout); }, []);
  useEffect(() => {
    if (step !== "code" || resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn(seconds => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [step, resendIn]);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "passkey") passkeyRef.current?.focus();
    if (target === "email") emailRef.current?.focus();
    if (target === "done") doneRef.current?.focus();
  }, [view]);

  function later(run: () => void, ms: number) { timers.current.push(window.setTimeout(run, ms)); }
  /** Any new direction cancels whatever the previous one was still waiting on. */
  function settle() { timers.current.forEach(window.clearTimeout); timers.current = []; setBusy(null); setVerified(false); }
  function go(next: Step, towards: number, focus: Step | null = next === "code" ? null : next) {
    focusNext.current = focus;
    setDirection(towards);
    if (next === "passkey") setPasskey("idle");
    setStep(next);
  }
  const focusCode = () => codeRef.current?.querySelector("input")?.focus();

  function complete(address: string, how: LoginMethod) {
    settle();
    setAccount(address);
    setMethod(how);
    go("done", 1);
    setStatus(`${signingUp ? "Account created" : "Signed in"} with ${how === "Email code" ? "an email code" : how === "Passkey" ? "a passkey" : how}`);
    onSignIn?.(address, how, mode);
  }

  function startPasskey() {
    if (passkey !== "idle" || busy) return;
    setPasskey("waiting");
    setStatus("Waiting for your passkey");
    later(() => {
      setPasskey("verified");
      setStatus("Passkey verified");
      later(() => complete(demoEmail, "Passkey"), 640);
    }, 1700);
  }

  function cancelPasskey() {
    settle();
    setPasskey("idle");
    setStatus("Passkey request canceled");
    passkeyRef.current?.focus();
  }

  function switchToEmail() {
    if (passkey === "verified" || busy) return;
    settle();
    setPasskey("idle");
    setAttempted(false);
    go("email", 1);
    setStatus("We will email you a sign in code");
  }

  function signInWith(provider: Provider) {
    if (busy || passkey !== "idle") return;
    setBusy(provider);
    setStatus(`Opening ${provider}`);
    later(() => complete(demoEmail, provider), 900);
  }

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setAttempted(true);
    if (!isEmail(email)) { emailRef.current?.focus(); return; }
    setBusy("email");
    setStatus("Sending a code");
    later(() => {
      const address = email.trim().toLowerCase();
      setBusy(null);
      setAccount(address);
      setCode("");
      setCodeError("");
      setResendIn(RESEND_SECONDS);
      go("code", 1);
      setStatus(`Code sent to ${address}`);
    }, 800);
  }

  function verify(value: string) {
    if (busy || verified) return;
    if (value.length < 6) { setCodeError("Enter all 6 digits."); focusCode(); return; }
    setBusy("code");
    setStatus("Checking code");
    later(() => {
      setBusy(null);
      if (value !== demoCode) {
        setCode("");
        setCodeError("That code didn't match. Check the latest email and try again.");
        setStatus("Code didn't match");
        focusCode();
        return;
      }
      setVerified(true);
      setStatus("Code verified");
      later(() => complete(account, "Email code"), 600);
    }, 700);
  }

  function changeCode(value: string) {
    if (busy || verified) return;
    setCode(value);
    if (codeError && value) setCodeError("");
    if (value.length === 6) verify(value);
  }

  function resend() {
    if (busy || verified || resendIn > 0) return;
    setResendIn(RESEND_SECONDS);
    setCode("");
    setCodeError("");
    setStatus("New code sent");
    focusCode();
  }

  function changeEmail() {
    settle();
    setAttempted(false);
    go("email", -1);
    setStatus("Edit your email");
  }

  function switchToPasskey() {
    settle();
    setMode("sign-in");
    go("passkey", -1);
    setStatus("Sign in with your passkey");
  }

  function switchMode() {
    settle();
    setAttempted(false);
    setCode("");
    if (signingUp) { setMode("sign-in"); go("passkey", -1); setStatus("Sign in to your account"); return; }
    setMode("sign-up");
    go("email", 1);
    setStatus("Create an account with your email");
  }

  function signOut() {
    settle();
    setEmail("");
    setTouched(false);
    setAttempted(false);
    setCode("");
    setMode("sign-in");
    go("passkey", -1);
    setStatus("Signed out");
  }

  function openLegal(href: string, label: string) {
    return (event: { preventDefault: () => void }) => {
      if (!href.startsWith("#")) return;
      event.preventDefault();
      setStatus(`${label} opens here in your app (demo)`);
    };
  }

  const passkeyLabel = passkey === "waiting" ? <><PasskeyPulse reduce={reduce} />Waiting for your device</> : passkey === "verified" ? <><Check size={16} strokeWidth={2} aria-hidden="true" />Passkey verified</> : <><FingerprintPattern size={16} strokeWidth={1.75} aria-hidden="true" />Sign in with passkey</>;

  return (
    <section className={[styles.screen, fullScreen ? styles.fullScreen : "", className].filter(Boolean).join(" ")} aria-label={signingUp ? "Create an account" : "Sign in"} onPointerMove={drift.onPointerMove} onPointerLeave={drift.onPointerLeave}>
      <motion.div className={styles.backdrop} style={drift.style} aria-hidden="true">
        <svg className={styles.lines}>
          <svg x="50%" y="50%" overflow="visible">
            <line className={styles.axis} x1="-2400" x2="2400" y1="0" y2="0" />
            <line className={styles.axis} x1="0" x2="0" y1="-2400" y2="2400" />
            {rings.map(ring => <circle key={ring.r} className={ring.major ? `${styles.ring} ${styles.ringMajor}` : styles.ring} r={ring.r} cx="0" cy="0" style={{ "--k": ring.k } as CSSProperties} />)}
          </svg>
        </svg>
      </motion.div>

      <header className={styles.bar}>
        <span className={styles.mark}><svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 15a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="10" cy="15" r="1.75" fill="currentColor" /></svg>Arc</span>
        <p className={styles.switch}>
          <span className={styles.switchPrompt}>{(["sign-in", "sign-up"] as const).map(option => <motion.span key={option} aria-hidden={option !== mode || undefined} initial={false} animate={labelState(option === mode, reduce)} transition={labelTransition(reduce)}>{option === "sign-up" ? "Have an account?" : "No account?"}</motion.span>)}</span>
          <button type="button" className={styles.switchButton} aria-label={signingUp ? "Sign in" : "Sign up"} onClick={switchMode}>{(["sign-in", "sign-up"] as const).map(option => <motion.span key={option} aria-hidden="true" initial={false} animate={labelState(option === mode, reduce)} transition={labelTransition(reduce)}>{option === "sign-up" ? "Sign in" : "Sign up"}</motion.span>)}</button>
        </p>
      </header>

      <div className={styles.stage}>
        <div className={styles.card}>
          <motion.div className={styles.viewport} style={{ height }}>
            <div ref={track} className={styles.track}>
              <AnimatePresence mode="popLayout" initial={false} custom={custom}>
                {step === "passkey" && <motion.div key="passkey" className={styles.step} custom={custom} variants={stepMotion} initial="enter" animate="center" exit="exit">
                  <div className={styles.heading}><h2>Sign in to Arc</h2><p>Use the passkey saved on this device. No password needed.</p></div>
                  <div className={styles.actions}>
                    <Button ref={passkeyRef} type="button" className={styles.wide} aria-busy={passkey === "waiting" || undefined} aria-disabled={passkey !== "idle" || !!busy || undefined} onClick={startPasskey}>{passkeyLabel}</Button>
                    <Button type="button" variant="secondary" className={styles.wide} aria-disabled={passkey === "verified" || !!busy || undefined} onClick={passkey === "waiting" ? cancelPasskey : switchToEmail}>{passkey === "waiting" ? "Cancel" : <><Mail size={16} strokeWidth={1.75} aria-hidden="true" />Use email instead</>}</Button>
                  </div>
                  <div className={styles.divider}>or</div>
                  <div className={styles.sso} role="group" aria-label="Single sign-on">
                    {providers.map(provider => <Button key={provider} type="button" variant="secondary" className={styles.ssoButton} aria-label={`Continue with ${provider}`} aria-disabled={passkey !== "idle" || (!!busy && busy !== provider) || undefined} loading={busy === provider} onClick={() => signInWith(provider)}>{provider === "Google" ? <GoogleLogo /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={providerMarks[provider]} /></svg>}{provider}</Button>)}
                  </div>
                </motion.div>}

                {step === "email" && <motion.div key={`email-${mode}`} className={styles.step} custom={custom} variants={stepMotion} initial="enter" animate="center" exit="exit">
                  <div className={styles.heading}>{signingUp ? <><h2>Create your account</h2><p>Enter your work email. We will send a code to confirm it.</p></> : <><h2>Sign in with email</h2><p>We will send a 6 digit code to your inbox.</p></>}</div>
                  <form className={styles.form} onSubmit={submitEmail} noValidate>
                    <Input ref={emailRef} label={signingUp ? "Work email" : "Email"} type="email" name="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" value={email} readOnly={busy === "email"} error={emailError} onChange={event => setEmail(event.target.value)} onBlur={() => { if (email.trim()) setTouched(true); }} />
                    <Button type="submit" className={styles.wide} loading={busy === "email"}>{signingUp ? "Create account" : "Send code"}</Button>
                  </form>
                  {!signingUp && <button type="button" className={styles.textButton} onClick={switchToPasskey}><FingerprintPattern size={14} strokeWidth={1.75} aria-hidden="true" />Use a passkey instead</button>}
                </motion.div>}

                {step === "code" && <motion.div key="code" className={styles.step} custom={custom} variants={stepMotion} initial="enter" animate="center" exit="exit">
                  <div className={styles.heading}><h2>Check your email</h2><p>Enter the code sent to <span className={styles.address}>{account}</span>. <button type="button" className={styles.inlineButton} onClick={changeEmail}>Change</button></p></div>
                  <form className={styles.form} onSubmit={event => { event.preventDefault(); verify(code); }} noValidate>
                    <div ref={codeRef}><OtpInput label="Verification code" description={`Demo code: ${demoCode}`} value={code} onChange={changeCode} error={codeError} autoFocus /></div>
                    <Button type="submit" className={styles.wide} loading={busy === "code"} aria-disabled={verified || undefined}>{verified ? <><Check size={16} strokeWidth={2} aria-hidden="true" />Verified</> : signingUp ? "Verify and create account" : "Verify"}</Button>
                  </form>
                  <button type="button" className={styles.textButton} aria-disabled={resendIn > 0 || verified || undefined} aria-label={resendIn > 0 ? `Resend code, available in ${resendIn} seconds` : "Resend code"} onClick={resend}>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span key={resendIn > 0 ? "wait" : "ready"} className={styles.resendLabel} {...swap(reduce)}>{resendIn > 0 ? <>Resend code in <RollingTime seconds={resendIn} reduce={reduce} /></> : "Resend code"}</motion.span>
                    </AnimatePresence>
                  </button>
                </motion.div>}

                {step === "done" && <motion.div key="done" className={styles.step} custom={custom} variants={stepMotion} initial="enter" animate="center" exit="exit">
                  <svg className={styles.success} viewBox="0 0 48 48" aria-hidden="true">
                    <g transform="rotate(-90 24 24)"><motion.circle cx="24" cy="24" r="22.25" fill="none" stroke="currentColor" strokeWidth="1.5" initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { duration: motionTokens.duration.considered, ease: [...motionTokens.ease.inOut], delay: .16 }, opacity: { duration: motionTokens.duration.instant, delay: .16 } }} /></g>
                    <motion.path d="M15.5 24.5l5.5 5.5 11.5-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { duration: motionTokens.duration.standard + .08, ease: [...motionTokens.ease.enter], delay: .52 }, opacity: { duration: motionTokens.duration.instant, delay: .52 } }} />
                  </svg>
                  <div className={styles.heading}><h2 ref={doneRef} tabIndex={-1}>{signingUp ? "Welcome to Arc" : "Welcome back"}</h2><p>{signingUp ? "Your account is ready. " : "You are signed in as "}<span className={styles.address}>{account}</span>{signingUp ? "" : "."}</p></div>
                  <dl className={styles.details}>
                    <div><dt>Method</dt><dd>{method}</dd></div>
                    <div><dt>This device</dt><dd>Remembered for 30 days</dd></div>
                  </dl>
                  <Button type="button" variant="secondary" className={styles.wide} onClick={signOut}>Sign out</Button>
                </motion.div>}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>

      <footer className={styles.foot}>
        <p className={styles.srOnly} role="status" aria-live="polite">{status}</p>
        <span className={styles.status} aria-hidden="true"><AnimatePresence mode="popLayout" initial={false}><motion.span key={status} {...swap(reduce)}>{status}</motion.span></AnimatePresence></span>
        <nav className={styles.legal} aria-label="Legal">
          <a href={termsHref} onClick={openLegal(termsHref, "Terms")}>Terms</a>
          <a href={privacyHref} onClick={openLegal(privacyHref, "Privacy policy")}>Privacy</a>
        </nav>
      </footer>
    </section>
  );
}

export default LoginCentered;
