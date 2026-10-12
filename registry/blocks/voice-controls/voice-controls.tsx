"use client";

import { AudioLines, Mic, Pause, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./voice-controls.module.css";

const HOLD_MS = 220;
const SAMPLE_MS = 110 / 0.75;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(hover: none), (pointer: coarse)");
    const update = () => setCoarse(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}

export interface VoiceInputProps {
  recording: boolean;
  starting?: boolean;
  /** Microphone loudness from 0 to 1. The parent owns capture and supplies this value. */
  level?: number;
  onStart: () => void;
  onStop: () => void;
  compact?: boolean;
  className?: string;
}

function Waveform({ recording, level }: Pick<VoiceInputProps, "recording" | "level">) {
  const rail = useRef<HTMLSpanElement>(null);
  const latestLevel = useRef(level);
  const reduced = !!useReducedMotion();
  useEffect(() => { latestLevel.current = level; }, [level]);
  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    const bars = Array.from(node.children) as HTMLElement[];
    const history = Array<number | null>(bars.length).fill(null);
    bars.forEach(bar => { bar.style.height = "3px"; bar.style.opacity = "0"; });
    node.style.transform = "translateX(0px)";
    if (!recording) return;
    if (reduced) {
      bars.forEach((bar, index) => { bar.style.height = `${3 + (index % 4) * 4}px`; bar.style.opacity = "1"; });
      return;
    }
    const started = performance.now();
    let previous = 0;
    let frame = 0;
    const update = (now: number) => {
      const elapsed = now - started;
      const sample = Math.floor(elapsed / SAMPLE_MS);
      if (sample > previous) {
        const count = Math.min(history.length, sample - previous);
        history.splice(0, count);
        for (let index = 0; index < count; index++) history.push(Number.isFinite(latestLevel.current) ? clamp(latestLevel.current!, 0, 1) : 0);
        bars.forEach((bar, index) => {
          const value = history[index];
          bar.style.height = `${3 + (value ?? 0) * 23}px`;
          bar.style.opacity = value === null ? "0" : "1";
        });
        previous = sample;
      }
      node.style.transform = `translateX(${-7 * ((elapsed % SAMPLE_MS) / SAMPLE_MS)}px)`;
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [recording, reduced]);
  return <span className={styles.waveform} aria-hidden="true"><span ref={rail} className={styles.waveRail}>{Array.from({ length: 15 }, (_, index) => <i key={index} />)}</span></span>;
}

/** A press starts capture in the original pointer gesture; release after a hold stops it. A tap toggles it. */
export function VoiceInput({ recording, starting = false, level, onStart, onStop, compact = false, className }: VoiceInputProps) {
  const reduced = !!useReducedMotion();
  const touch = useCoarsePointer();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const startedOnPress = useRef(false);
  const suppressClick = useRef(false);
  const clearHold = () => { if (holdTimer.current !== null) clearTimeout(holdTimer.current); holdTimer.current = null; };
  useEffect(() => () => { if (holdTimer.current !== null) clearTimeout(holdTimer.current); }, []);
  const endPress = () => {
    clearHold();
    if (held.current) { held.current = false; suppressClick.current = true; onStop(); }
  };
  const expanded = recording || starting;
  return <motion.span className={[styles.voice, compact && styles.compact, className].filter(Boolean).join(" ")} data-recording={recording || undefined} data-starting={starting || undefined}
    initial={false} animate={{ width: expanded ? 150 : touch ? 44 : compact ? 32 : 40 }} transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}>
    <span className={styles.voiceSurface} aria-hidden="true" />
    <span className={styles.waveClip}>{starting ? <span className={styles.starting}>Starting mic…</span> : <Waveform recording={recording} level={level} />}</span>
    <button type="button" className={styles.mic} aria-label={expanded ? "Stop voice input" : "Start voice input"} aria-pressed={expanded}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        suppressClick.current = false;
        startedOnPress.current = !expanded;
        held.current = false;
        if (startedOnPress.current) { suppressClick.current = true; onStart(); }
        holdTimer.current = setTimeout(() => { held.current = true; holdTimer.current = null; }, HOLD_MS);
      }}
      onPointerUp={endPress}
      onPointerCancel={() => {
        clearHold();
        const shouldStop = startedOnPress.current || held.current;
        held.current = false;
        suppressClick.current = true;
        if (shouldStop) onStop();
      }}
      onLostPointerCapture={endPress}
      onKeyDown={() => { suppressClick.current = false; }}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        if (expanded) onStop(); else onStart();
      }}><Mic size={compact ? 18 : 19} strokeWidth={1.75} aria-hidden="true" /></button>
    <span className={styles.srOnly} role="status">{starting ? "Starting voice input." : recording ? "Voice input active. Activate again to stop, or release after holding the button." : ""}</span>
  </motion.span>;
}

export interface SpeechControlProps {
  enabled: boolean;
  generating?: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  onEnabledChange: (enabled: boolean) => void;
  onPlayingChange: (playing: boolean) => void;
  onSeek: (seconds: number) => void;
  className?: string;
}

/** Compact speech toggle that unfolds into a play button and a seekable timeline. */
export function SpeechControl({ enabled, generating = false, playing, currentTime, duration, onEnabledChange, onPlayingChange, onSeek, className }: SpeechControlProps) {
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const touch = useCoarsePointer();
  const [preview, setPreview] = useState<number | null>(null);
  const [near, setNear] = useState(false);
  const drag = useRef<{ resume: boolean; duration: number } | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extrasId = useId();
  useEffect(() => () => { if (collapseTimer.current !== null) clearTimeout(collapseTimer.current); }, []);
  const enter = () => { if (collapseTimer.current !== null) clearTimeout(collapseTimer.current); collapseTimer.current = null; setHovered(true); };
  const leave = () => { setNear(false); if (collapseTimer.current !== null) clearTimeout(collapseTimer.current); collapseTimer.current = setTimeout(() => { collapseTimer.current = null; setHovered(false); }, 700); };
  const expanded = enabled && (keyboardFocus || preview !== null || (touch ? true : hovered));
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const position = clamp(Number.isFinite(preview ?? currentTime) ? preview ?? currentTime : 0, 0, safeDuration);
  const percent = safeDuration ? position / safeDuration * 100 : 0;
  const timeAt = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return clamp((event.clientX - box.left) / box.width, 0, 1) * (drag.current?.duration ?? safeDuration);
  };
  return <span className={[styles.speech, className].filter(Boolean).join(" ")} data-expanded={expanded || undefined} data-enabled={enabled || undefined}
    onMouseEnter={enter} onMouseLeave={leave}
    onPointerDownCapture={() => setKeyboardFocus(false)}
    onFocusCapture={event => { if (event.target.matches(":focus-visible")) setKeyboardFocus(true); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false); }}>
    <button type="button" className={styles.speechToggle} aria-label={enabled ? "Turn speech off" : "Turn speech on"} aria-pressed={enabled} aria-expanded={expanded} aria-controls={extrasId}
      onClick={() => onEnabledChange(!enabled)}><AudioLines size={16} strokeWidth={1.75} aria-hidden="true" className={styles.speechGlyph} /></button>
    <span id={extrasId} className={styles.speechExtras} inert={!expanded}>
      <button type="button" className={styles.play} aria-label={playing ? "Pause speech" : "Play speech"} disabled={generating && !safeDuration}
        onClick={() => { if (!playing && position >= safeDuration && safeDuration) onSeek(0); onPlayingChange(!playing); }}>
        {playing ? <Pause size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" /> : <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />}
      </button>
      <span className={styles.track} role="slider" aria-label="Speech position" tabIndex={expanded && safeDuration ? 0 : -1}
        aria-valuemin={0} aria-valuemax={safeDuration} aria-valuenow={position} aria-valuetext={`${timeLabel(position)} of ${timeLabel(safeDuration)}${generating ? " available; generating more speech" : ""}`}
        aria-disabled={!safeDuration} data-near={near || undefined} data-dragging={preview !== null || undefined}
        onPointerDown={event => {
          if (!safeDuration || !event.isPrimary || event.button !== 0) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { resume: playing, duration: safeDuration };
          if (playing) onPlayingChange(false);
          setPreview(timeAt(event));
        }}
        onPointerMove={event => {
          if (!safeDuration) return;
          if (drag.current) setPreview(timeAt(event));
          const box = event.currentTarget.getBoundingClientRect();
          setNear(Math.abs(event.clientX - box.left - box.width * percent / 100) <= 12);
        }}
        onPointerLeave={() => setNear(false)}
        onPointerUp={event => {
          if (!drag.current) return;
          const resume = drag.current.resume;
          const target = timeAt(event);
          drag.current = null;
          onSeek(target); setPreview(null);
          if (resume) onPlayingChange(true);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          if (!drag.current) return;
          const resume = drag.current.resume;
          drag.current = null; setPreview(null);
          if (resume) onPlayingChange(true);
        }}
        onKeyDown={event => {
          if (!safeDuration) return;
          const step = event.shiftKey ? 10 : 5;
          const next = event.key === "Home" ? 0 : event.key === "End" ? safeDuration
            : event.key === "ArrowRight" || event.key === "ArrowUp" ? position + step
            : event.key === "ArrowLeft" || event.key === "ArrowDown" ? position - step : null;
          if (next !== null) { event.preventDefault(); onSeek(clamp(next, 0, safeDuration)); }
        }}>
        <span className={styles.rail} /><span className={styles.fill} style={{ width: `${percent}%` }} /><span className={styles.thumb} style={{ left: `${percent}%` }} />
      </span>
    </span>
  </span>;
}

export interface SpeechTranscriptProps {
  text: string;
  /** Zero-based spoken word index; pass -1 when nothing is being spoken. */
  activeIndex: number;
  className?: string;
}

function transcriptParts(text: string) {
  let word = -1;
  return (text.match(/\s+|\S+/g) ?? []).map(part => ({ part, word: /^\s+$/.test(part) ? -1 : ++word }));
}

/** Plain text word following. Whitespace and punctuation stay untouched; screen readers receive one stable sentence. */
export function SpeechTranscript({ text, activeIndex, className }: SpeechTranscriptProps) {
  return <span className={[styles.transcript, className].filter(Boolean).join(" ")}>
    <span className={styles.srOnly}>{text}</span>
    <span aria-hidden="true">{transcriptParts(text).map(({ part, word }, index) => {
      if (word < 0) return part;
      return <span key={index} data-spoken={word === activeIndex || undefined}>{part}</span>;
    })}</span>
  </span>;
}
