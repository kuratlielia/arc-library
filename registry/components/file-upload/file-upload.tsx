"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type HTMLMotionProps, type MotionProps, type TargetAndTransition, type Transition } from "motion/react";
import { File, FileArchive, FileImage, FileText, RotateCw, UploadCloud, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./file-upload.module.css";

export type FileUploadItem = { id: string; file: File; error?: string };

export interface FileUploadProps {
  accept?: string;
  disabled?: boolean;
  label?: string;
  description?: string;
  multiple?: boolean;
  maxSize?: number;
  value?: FileUploadItem[];
  onChange?: (files: FileUploadItem[]) => void;
  /** Uploads each accepted file. Report progress from 0 to 100, resolve when done, or reject to mark the file as failed. Removing a file aborts its signal. */
  onUpload?: (file: File, options: { onProgress: (percent: number) => void; signal: AbortSignal }) => Promise<void>;
}

type Upload = { status: "uploading" | "done" | "failed"; progress: number };

const enter: Transition = { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] };
const exitFast: Transition = { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] };
const instant: Transition = { duration: 0 };
const textIn: TargetAndTransition = { opacity: 0, y: "0.3em", filter: `blur(${motionTokens.blur.soft}px)` };
const textOut: TargetAndTransition = { opacity: 0, y: "-0.3em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: exitFast };
const iconIn: TargetAndTransition = { opacity: 0, scale: .6, filter: `blur(${motionTokens.blur.subtle}px)` };
const shown: TargetAndTransition = { opacity: 1, y: "0em", scale: 1, filter: "blur(0px)" };
const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } };

function FileTypeIcon({ file }: { file: File }) {
  const props = { size: 16, strokeWidth: 1.8, "aria-hidden": true } as const;
  if (file.type.startsWith("image/")) return <FileImage {...props} />;
  if (file.type.startsWith("text/")) return <FileText {...props} />;
  if (file.type.includes("zip") || file.name.endsWith(".gz")) return <FileArchive {...props} />;
  return <File {...props} />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1))} MB`;
}

/** Outgoing copies are hidden from assistive tech while they fade, so live text reads only the current message. */
function Swap(props: HTMLMotionProps<"span">) {
  const present = useIsPresent();
  return <motion.span {...props} aria-hidden={present ? props["aria-hidden"] : true} />;
}

function FileRow({ item, upload, reduce, onRemove, onRetry, removeRef }: { item: FileUploadItem; upload?: Upload; reduce: boolean | null; onRemove: () => void; onRetry: () => void; removeRef: (node: HTMLButtonElement | null) => void }) {
  const status = upload?.status;
  // A finished upload keeps its bar until the spring reaches the end, so 100% is seen before the label turns to Uploaded.
  const [filled, setFilled] = useState(status !== "uploading");
  const [seen, setSeen] = useState(status);
  if (seen !== status) { setSeen(status); if (status === "uploading") setFilled(false); }
  const shownStatus = status === "done" && !filled && !reduce ? "uploading" : status;
  const phase = item.error ? "invalid" : shownStatus ?? "ready";
  // One spring drives the bar and the counted percentage, so both always agree.
  const progress = useMotionValue(upload?.progress ?? 0);
  // The fill slides in from the left instead of scaling, so its rounded end keeps its shape at every value.
  const x = useTransform(progress, latest => `${Math.min(Math.max(latest, 0), 100) - 100}%`);
  const percent = useTransform(progress, latest => `${Math.round(Math.min(Math.max(latest, 0), 100))}%`);
  const target = status === "done" ? 100 : upload?.progress ?? 0;
  useEffect(() => {
    // Every upload starts from an empty bar, even a retry that failed halfway.
    if (reduce || (status === "uploading" && target === 0)) { progress.jump(target); return; }
    const controls = animate(progress, target, { ...motionTokens.spring.smooth, onComplete: status === "done" ? () => setFilled(true) : undefined });
    return () => controls.stop();
  }, [status, target, progress, reduce]);
  // The label turns as soon as the count reads 100%, without waiting out the spring's last fraction of a pixel.
  useMotionValueEvent(progress, "change", latest => { if (status === "done" && latest >= 99.5) setFilled(true); });
  const swap: MotionProps = { initial: reduce ? { opacity: 0 } : textIn, animate: shown, exit: reduce ? fadeOut : textOut, transition: reduce ? instant : enter };
  return <div className={styles.fileItem}>
    <span className={styles.fileIcon}><FileTypeIcon file={item.file} /></span>
    <span className={styles.fileCopy}>
      <strong title={item.file.name}>{item.file.name}</strong>
      <span className={styles.meta}>{formatSize(item.file.size)}{shownStatus ? <><span className={styles.dot} aria-hidden="true">·</span><span className={styles.phase}><AnimatePresence mode="popLayout" initial={false}>
        <Swap key={shownStatus} className={shownStatus === "failed" ? `${styles.phaseText} ${styles.error}` : styles.phaseText} {...swap}>{shownStatus === "uploading" ? <>Uploading <motion.span className={styles.percent}>{percent}</motion.span></> : shownStatus === "done" ? "Uploaded" : "Upload failed"}</Swap>
      </AnimatePresence></span></> : null}</span>
      {item.error && <span className={styles.error}>{item.error}</span>}
      {/* The bar fills on a spring, then folds away once the file lands. */}
      <AnimatePresence initial={false}>{shownStatus === "uploading" && <motion.span key="bar" className={styles.barFrame} initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? fadeOut : { height: 0, opacity: 0, transition: { height: { ...motionTokens.spring.smooth, delay: .24 }, opacity: { ...exitFast, delay: .24 } } }} transition={reduce ? instant : { height: motionTokens.spring.smooth, opacity: enter }}>
        <span className={styles.bar}><motion.span className={styles.barFill} style={{ x }} /></span>
      </motion.span>}</AnimatePresence>
    </span>
    <span className={styles.statusSlot}>
      <AnimatePresence mode="popLayout" initial={false}>
        {(phase === "ready" || phase === "done") && <motion.span key="ready" className={styles.ready} initial={reduce ? { opacity: 0 } : { opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={fadeOut} transition={reduce ? instant : motionTokens.spring.snappy}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><motion.path d="M4 12.5l5 5L20 6.5" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...enter, delay: .08 }} /></svg>
          <span className={styles.srOnly}>{phase === "done" ? "Uploaded" : "Ready"}</span>
        </motion.span>}
        {/* The wrapper carries the entrance, so the button's own press scale never competes with it. */}
        {phase === "failed" && <motion.span key="retry" className={styles.retrySlot} initial={reduce ? { opacity: 0 } : iconIn} animate={shown} exit={reduce ? fadeOut : { ...iconIn, transition: exitFast }} transition={reduce ? instant : motionTokens.spring.snappy}>
          <button type="button" className={styles.retry} aria-label={`Retry ${item.file.name}`} onClick={onRetry}><RotateCw size={14} strokeWidth={1.8} aria-hidden="true" /></button>
        </motion.span>}
      </AnimatePresence>
    </span>
    <button ref={removeRef} type="button" className={styles.remove} aria-label={`Remove ${item.file.name}`} onClick={onRemove}><X size={15} aria-hidden="true" /></button>
  </div>;
}

export function FileUpload({
  accept,
  disabled = false,
  label = "Upload files",
  description = "Drop files here or browse from your device.",
  multiple = true,
  maxSize,
  value,
  onChange,
  onUpload,
}: FileUploadProps) {
  const inputId = useId();
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const [internalFiles, setInternalFiles] = useState<FileUploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [uploads, setUploads] = useState<Record<string, Upload>>({});
  const dragDepth = useRef(0);
  const nextId = useRef(0);
  const controllers = useRef(new Map<string, AbortController>());
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const files = value ?? internalFiles;

  useEffect(() => {
    const active = controllers.current;
    return () => active.forEach(controller => controller.abort());
  }, []);

  function update(next: FileUploadItem[]) {
    if (value === undefined) setInternalFiles(next);
    onChange?.(next);
  }

  function startUpload(item: FileUploadItem) {
    if (!onUpload) return;
    controllers.current.get(item.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    const set = (next: (current?: Upload) => Upload) => setUploads(current => ({ ...current, [item.id]: next(current[item.id]) }));
    set(() => ({ status: "uploading", progress: 0 }));
    onUpload(item.file, {
      signal: controller.signal,
      onProgress: percent => { if (!controller.signal.aborted) set(current => ({ status: "uploading", progress: Math.min(Math.max(percent, current?.progress ?? 0), 100) })); },
    }).then(() => {
      if (controller.signal.aborted) return;
      set(() => ({ status: "done", progress: 100 }));
      setStatus(`${item.file.name} uploaded.`);
    }, () => {
      if (controller.signal.aborted) return;
      set(current => ({ status: "failed", progress: current?.progress ?? 0 }));
      setStatus(`${item.file.name} could not be uploaded.`);
    }).finally(() => { if (controllers.current.get(item.id) === controller) controllers.current.delete(item.id); });
  }

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).slice(0, multiple ? undefined : 1);
    const acceptedTypes = accept?.split(",").map(type => type.trim().toLowerCase()).filter(Boolean) ?? [];
    const matchesAccept = (file: File) => acceptedTypes.length === 0 || acceptedTypes.some(type => type.startsWith(".")
      ? file.name.toLowerCase().endsWith(type)
      : type.endsWith("/*") ? file.type.startsWith(type.slice(0, -1)) : file.type === type);
    const accepted = incoming.map(file => ({
      id: `${file.name}-${file.lastModified}-${nextId.current++}`,
      file,
      error: !matchesAccept(file)
        ? "This file type is not accepted."
        : maxSize && file.size > maxSize ? `File is larger than ${formatSize(maxSize)}.` : undefined,
    }));
    if (!multiple) controllers.current.forEach(controller => controller.abort());
    update(multiple ? [...files, ...accepted] : accepted);
    const invalidCount = accepted.filter(item => item.error).length;
    const validCount = accepted.length - invalidCount;
    const added = `${validCount} file${validCount === 1 ? "" : "s"} added.`;
    const attention = `${invalidCount} file${invalidCount === 1 ? " needs" : "s need"} attention.`;
    setStatus(!invalidCount ? added : validCount ? `${added} ${attention}` : attention);
    accepted.filter(item => !item.error).forEach(startUpload);
  }

  function removeFile(item: FileUploadItem) {
    controllers.current.get(item.id)?.abort();
    controllers.current.delete(item.id);
    // Keep keyboard focus in the list: the next row's remove button, else the previous one, else the dropzone.
    const index = files.findIndex(file => file.id === item.id);
    const neighbor = files[index + 1] ?? files[index - 1];
    update(files.filter(file => file.id !== item.id));
    setStatus(`${item.file.name} removed.`);
    requestAnimationFrame(() => (neighbor ? removeRefs.current.get(neighbor.id) : dropzoneRef.current)?.focus());
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!disabled && event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) {
      dragDepth.current += 1;
      setDragging(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  const height: Transition = reduce ? instant : { height: motionTokens.spring.smooth, opacity: enter };
  return <div className={styles.root}>
    <input ref={inputRef} id={inputId} className={styles.input} type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={handleInput} />
    <div
      ref={dropzoneRef}
      className={[styles.dropzone, dragging ? styles.dragging : "", disabled ? styles.disabled : ""].filter(Boolean).join(" ")}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-describedby={`${inputId}-description`}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={event => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className={styles.uploadIcon}><UploadCloud size={20} strokeWidth={1.8} aria-hidden="true" /></span>
      {/* While a file hovers over the target the label says what releasing it will do. */}
      <span className={styles.copy}><strong className={styles.label}><AnimatePresence mode="popLayout" initial={false}><Swap key={dragging ? "drop" : "idle"} className={styles.labelText} initial={reduce ? { opacity: 0 } : textIn} animate={shown} exit={reduce ? fadeOut : textOut} transition={reduce ? instant : enter}>{dragging ? `Drop to add ${multiple ? "files" : "a file"}` : label}</Swap></AnimatePresence></strong><span id={`${inputId}-description`}>{description}</span></span>
      <span className={styles.browse}>Browse</span>
    </div>
    {/* The live region stays mounted; its frame opens on the first message and each new message rises in. */}
    <motion.div className={styles.statusFrame} initial={false} animate={{ height: status ? "auto" : 0 }} transition={height}>
      <p className={styles.status} aria-live="polite" aria-atomic="true"><AnimatePresence mode="popLayout" initial={false}>{status ? <Swap key={status} className={styles.statusText} initial={reduce ? { opacity: 0 } : textIn} animate={shown} exit={reduce ? fadeOut : textOut} transition={reduce ? instant : enter}>{status}</Swap> : null}</AnimatePresence></p>
    </motion.div>
    {/* Rows open and close their own height, so the list closes the gap when a file is removed. */}
    <motion.ul className={styles.fileList} aria-label="Selected files" aria-hidden={files.length === 0 ? true : undefined} initial={false} animate={{ paddingTop: files.length ? 6 : 0 }} transition={reduce ? instant : motionTokens.spring.smooth}>
      <AnimatePresence initial={false}>
        {files.map(item => <motion.li key={item.id} className={styles.fileRow} initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? fadeOut : { height: 0, opacity: 0, transition: { height: motionTokens.spring.smooth, opacity: exitFast } }} transition={height}>
          <FileRow item={item} upload={uploads[item.id]} reduce={reduce} onRemove={() => removeFile(item)} onRetry={() => startUpload(item)} removeRef={node => { if (node) removeRefs.current.set(item.id, node); else removeRefs.current.delete(item.id); }} />
        </motion.li>)}
      </AnimatePresence>
    </motion.ul>
  </div>;
}

export default FileUpload;
