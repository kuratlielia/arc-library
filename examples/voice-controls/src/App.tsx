import { ArrowUpRight, Moon, RotateCcw, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SpeechControl, SpeechTranscript, VoiceInput } from "../../../registry/blocks/voice-controls/voice-controls";

const DICTATION = "Let's give this page a little more room to breathe and keep the controls close to the conversation.";
const RESPONSE = "A clear interface makes room for the conversation. Speak a thought, then follow the response at your own pace.";
const WORDS = RESPONSE.match(/\S+/g) ?? [];
const DURATION = 14.4;
const GENERATION_MS = 1250;
const START_MS = 320;
const wordWeights = WORDS.map(word => Math.max(0.55, word.replace(/[^a-z]/gi, "").length * 0.11));
const totalWeight = wordWeights.reduce((sum, weight) => sum + weight, 0);
const wordEnds = wordWeights.reduce<number[]>((ends, weight) => {
  ends.push((ends.at(-1) ?? 0) + weight / totalWeight * DURATION);
  return ends;
}, []);

type Capture = {
  phase: "idle" | "starting" | "recording" | "captured";
  startedAt: number;
  recordingAt: number;
  elapsed: number;
};

type Speech = {
  enabled: boolean;
  generating: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  generationAt: number;
  generationProgress: number;
  playAt: number;
  playFrom: number;
};

const initialCapture: Capture = { phase: "idle", startedAt: 0, recordingAt: 0, elapsed: 0 };
const initialSpeech: Speech = { enabled: false, generating: false, playing: false, currentTime: 0, duration: 0, generationAt: 0, generationProgress: 0, playAt: 0, playFrom: 0 };
const timeLabel = (seconds: number) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`;

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [capture, setCapture] = useState<Capture>(initialCapture);
  const [speech, setSpeech] = useState<Speech>(initialSpeech);
  const captureRef = useRef(capture);
  const speechRef = useRef(speech);
  const lastFrame = useRef(0);

  const updateCapture = (next: Capture) => { captureRef.current = next; setCapture(next); };
  const updateSpeech = (next: Speech) => { speechRef.current = next; setSpeech(next); };

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      if (now - lastFrame.current >= 34) {
        lastFrame.current = now;
        const mic = captureRef.current;
        if (mic.phase === "starting" && now - mic.startedAt >= START_MS) {
          updateCapture({ ...mic, phase: "recording", recordingAt: now });
        } else if (mic.phase === "recording") {
          updateCapture({ ...mic, elapsed: (now - mic.recordingAt) / 1000 });
        }

        const audio = speechRef.current;
        if (audio.enabled && audio.generating) {
          updateSpeech(now - audio.generationAt >= GENERATION_MS
            ? { ...audio, generating: false, duration: DURATION, generationProgress: 100 }
            : { ...audio, generationProgress: (now - audio.generationAt) / GENERATION_MS * 100 });
        } else if (audio.enabled && audio.playing) {
          const currentTime = Math.min(DURATION, audio.playFrom + (now - audio.playAt) / 1000);
          updateSpeech({ ...audio, currentTime, playing: currentTime < DURATION });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const startCapture = () => {
    if (captureRef.current.phase === "starting" || captureRef.current.phase === "recording") return;
    updateCapture({ phase: "starting", startedAt: performance.now(), recordingAt: 0, elapsed: 0 });
  };
  const stopCapture = () => {
    const mic = captureRef.current;
    if (mic.phase !== "recording" && mic.phase !== "starting") return;
    updateCapture({ ...mic, phase: "captured", elapsed: mic.phase === "recording" ? (performance.now() - mic.recordingAt) / 1000 : 0 });
  };
  const setSpeechEnabled = (enabled: boolean) => {
    updateSpeech(enabled
      ? { ...initialSpeech, enabled: true, generating: true, generationAt: performance.now() }
      : { ...initialSpeech });
  };
  const setPlaying = (playing: boolean) => {
    const audio = speechRef.current;
    if (!audio.enabled || audio.generating || !audio.duration) return;
    const now = performance.now();
    const currentTime = audio.playing ? Math.min(audio.duration, audio.playFrom + (now - audio.playAt) / 1000) : audio.currentTime;
    const nextTime = playing && currentTime >= audio.duration ? 0 : currentTime;
    updateSpeech({ ...audio, playing, currentTime: nextTime, playAt: now, playFrom: nextTime });
  };
  const seek = (seconds: number) => {
    const audio = speechRef.current;
    const currentTime = Math.max(0, Math.min(audio.duration, seconds));
    updateSpeech({ ...audio, currentTime, playFrom: currentTime, playAt: performance.now(), playing: audio.playing && currentTime < audio.duration });
  };

  const micActive = capture.phase === "recording";
  const dictationWords = DICTATION.split(" ");
  const visibleWords = micActive ? Math.min(dictationWords.length, Math.max(1, Math.floor(capture.elapsed * 3.5))) : dictationWords.length;
  const dictationText = capture.phase === "idle" || capture.phase === "starting" ? "" : dictationWords.slice(0, visibleWords).join(" ");
  const activeIndex = speech.enabled && speech.duration > 0 && speech.currentTime < speech.duration && (speech.playing || speech.currentTime > 0)
    ? wordEnds.findIndex(end => speech.currentTime < end) : -1;
  const micLevel = micActive ? Math.min(1, 0.32 + Math.abs(Math.sin(capture.elapsed * 5.2) * Math.cos(capture.elapsed * 1.7)) * 0.64) : 0;

  return <div className="page">
    <header className="site-header">
      <a className="brand" href="https://uiarc.dev" aria-label="Arc home"><span className="brand-mark" aria-hidden="true">a<span>.</span></span><span>arc<span className="brand-light"> / components</span></span></a>
      <div className="header-actions"><span className="header-caption">Interactive preview</span><button className="icon-button theme-button" type="button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button></div>
    </header>

    <main>
      <section className="intro" aria-labelledby="page-title">
        <div className="eyebrow"><span className="eyebrow-line" /> ARC BLOCKS <span className="eyebrow-divider">/</span> VOICE</div>
        <h1 id="page-title">Let the conversation <em>flow.</em></h1>
        <p>Two quiet controls for speaking and listening. Dictate a thought, then follow a response at your own pace.</p>
        <span className="simulated-label"><span className="simulated-dot" /> Simulated preview <span className="label-separator">·</span> No microphone or audio service</span>
      </section>

      <section className="showcase" aria-label="Voice controls demo">
        <div className="showcase-heading"><div><span className="section-number">01 / 02</span><h2>Voice controls</h2></div><span className="showcase-subtitle">A small interaction, thoughtfully made.</span></div>
        <div className="demo-grid">
          <article className="demo-card compose-card">
            <div className="card-top"><span className="card-kicker">INPUT <span>—</span> DICTATION</span><span className="card-index">01</span></div>
            <div className="card-main">
              <h3>Say what’s on your mind.</h3>
              <p className="card-description">Tap to start or stop. You can also press and hold.</p>
              <div className="composer" data-active={micActive || undefined}>
                <div className="composer-content" aria-live="polite">
                  {dictationText ? <p className="dictation-text">{dictationText}{micActive && <span className="caret" aria-hidden="true" />}</p> : <span className="placeholder">Your words will appear here…</span>}
                </div>
                <div className="composer-bottom"><span className="composer-status"><span className="status-light" data-active={capture.phase === "starting" || micActive || undefined} />{capture.phase === "starting" ? "Voice input" : micActive ? `Listening · ${timeLabel(capture.elapsed)}` : capture.phase === "captured" ? "Draft captured" : "Ready when you are"}</span><VoiceInput recording={micActive} starting={capture.phase === "starting"} level={micLevel} onStart={startCapture} onStop={stopCapture} /></div>
              </div>
              {capture.phase === "captured" && <button className="text-button" type="button" onClick={() => updateCapture(initialCapture)}><RotateCcw size={13} /> Try again</button>}
            </div>
            <div className="card-foot"><span>01</span><span>VoiceInput</span><span>Tap / hold</span></div>
          </article>

          <article className="demo-card speech-card">
            <div className="card-top"><span className="card-kicker">OUTPUT <span>—</span> READ ALOUD</span><span className="card-index">02</span></div>
            <div className="card-main">
              <h3>Listen at your own pace.</h3>
              <p className="card-description">Turn on speech, play, pause, and seek through the response.</p>
              <div className="response">
                <div className="response-head"><span className="avatar" aria-hidden="true">a<span>.</span></span><div><strong>Arc</strong><span>Just now</span></div><span className="response-menu" aria-hidden="true">···</span></div>
                <p className="response-copy"><SpeechTranscript text={RESPONSE} activeIndex={activeIndex} /></p>
                <div className="response-actions"><SpeechControl className="preview-speech-control" enabled={speech.enabled} generating={speech.generating} playing={speech.playing} currentTime={speech.currentTime} duration={speech.duration} onEnabledChange={setSpeechEnabled} onPlayingChange={setPlaying} onSeek={seek} /><span className="response-time">{speech.generating ? "Generating sample speech…" : speech.enabled ? `${timeLabel(speech.currentTime)} / ${timeLabel(speech.duration)}` : "Speech is off"}</span></div>
                {speech.generating && <div className="generation-track" role="progressbar" aria-label="Generating sample speech" aria-valuenow={Math.round(speech.generationProgress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${speech.generationProgress}%` }} /></div>}
              </div>
            </div>
            <div className="card-foot"><span>02</span><span>SpeechControl + SpeechTranscript</span><span>Seek / follow</span></div>
          </article>
        </div>
        <p className="demo-note"><span className="note-asterisk">✳</span> This preview uses sample text and a local clock. It never requests microphone access or produces sound.</p>
      </section>
    </main>

    <footer className="site-footer"><span>ARC <span className="footer-muted">/</span> VOICE CONTROLS</span><a href="https://uiarc.dev" target="_blank" rel="noreferrer">Explore Arc <ArrowUpRight size={14} /></a></footer>
  </div>;
}
