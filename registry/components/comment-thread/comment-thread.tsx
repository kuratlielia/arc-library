"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { Transition, Variants } from "motion/react";
import { Check, ChevronRight, CornerDownRight, RotateCcw, SmilePlus, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./comment-thread.module.css";

export interface CommentAuthor {
  id: string;
  name: string;
  /** Square image URL. Initials are shown without one. */
  avatar?: string;
}

export interface CommentReaction {
  emoji: string;
  /** Ids of the people who reacted. */
  users: string[];
}

export interface ThreadComment {
  id: string;
  author: CommentAuthor;
  /** Plain text. "@Full Name" mentions of known people are highlighted. */
  body: string;
  /** Display label such as "2h" or "Sep 18". */
  createdAt: string;
  edited?: boolean;
  /** A deleted comment that still has replies keeps its place as a quiet placeholder. */
  deleted?: boolean;
  reactions?: CommentReaction[];
  replies?: ThreadComment[];
}

/** What changed, for syncing to a server. `comments` on `onCommentsChange` is always the full next tree. */
export type CommentThreadEvent =
  | { type: "reply"; comment: ThreadComment; parentId: string | null }
  | { type: "edit"; id: string; body: string }
  | { type: "delete"; id: string }
  | { type: "react"; id: string; emoji: string; added: boolean };

/** Every word the thread shows or announces. Each one has an English default; words with a count or a name are functions, so an app can apply its own plural rules. */
export interface CommentThreadLabels {
  /** Accessible name of the whole thread. */
  thread?: string;
  /** Header and resolved chip, such as "3 comments". */
  commentCount?: (count: number) => string;
  /** Resolved chip, such as "2 people". */
  peopleCount?: (count: number) => string;
  resolve?: string;
  /** Title of the resolved chip. */
  resolved?: string;
  reopen?: string;
  /** Shown when there are no comments. */
  empty?: string;
  reply?: string;
  edit?: string;
  delete?: string;
  cancel?: string;
  send?: string;
  /** Saves an edit. */
  save?: string;
  /** Placeholder and accessible name of the edit field. */
  editComment?: string;
  /** After the time of an edited comment. */
  edited?: string;
  deleteConfirm?: string;
  /** Placeholder text of a deleted comment that still has replies. */
  deletedText?: string;
  /** Accessible name of that placeholder. */
  deletedComment?: string;
  /** Above the composer while replying. The name inside it is highlighted. */
  replyingTo?: (name: string) => string;
  cancelReply?: string;
  showReplies?: (count: number) => string;
  hideReplies?: string;
  addReaction?: string;
  closeReactions?: string;
  /** Accessible name of the reaction picker. */
  reactions?: string;
  /** Accessible name of an emoji in the picker. */
  reactWith?: (emoji: string) => string;
  /** Accessible name of a reaction under a comment. */
  reactionCount?: (emoji: string, count: number, includesYou: boolean) => string;
  /** Accessible name of the @mention suggestions. */
  mentions?: string;
}

const DEFAULT_LABELS: Required<CommentThreadLabels> = {
  thread: "Comment thread",
  commentCount: count => `${count} ${count === 1 ? "comment" : "comments"}`,
  peopleCount: count => `${count} ${count === 1 ? "person" : "people"}`,
  resolve: "Resolve",
  resolved: "Resolved",
  reopen: "Reopen",
  empty: "No comments yet. Start the conversation below.",
  reply: "Reply",
  edit: "Edit",
  delete: "Delete",
  cancel: "Cancel",
  send: "Send",
  save: "Save",
  editComment: "Edit comment",
  edited: "edited",
  deleteConfirm: "Delete this comment?",
  deletedText: "This comment was deleted",
  deletedComment: "Deleted comment",
  replyingTo: name => `Replying to ${name}`,
  cancelReply: "Cancel reply",
  showReplies: count => `Show ${count} ${count === 1 ? "reply" : "replies"}`,
  hideReplies: "Hide replies",
  addReaction: "Add reaction",
  closeReactions: "Close reactions",
  reactions: "Reactions",
  reactWith: emoji => `React with ${emoji}`,
  reactionCount: (emoji, count, includesYou) => `${emoji} ${count}${includesYou ? ", including you" : ""}`,
  mentions: "People",
};

/** A key passed as undefined keeps its default too. */
const withDefaults = <T extends object>(defaults: Required<T>, given?: T): Required<T> =>
  ({ ...defaults, ...Object.fromEntries(Object.entries(given ?? {}).filter(([, value]) => value !== undefined)) });

/**
 * A threaded discussion: replies nest under their comment and collapse, reactions toggle with a count that rolls,
 * authors edit and delete their own comments in place, mentions autocomplete in the composer, and resolving folds the
 * whole thread into a single chip that reopens it. Controlled with `comments` and `resolved`, or uncontrolled.
 */
export interface CommentThreadProps {
  comments?: ThreadComment[];
  defaultComments?: ThreadComment[];
  onCommentsChange?: (comments: ThreadComment[], event: CommentThreadEvent) => void;
  /** The person writing. Their comments can be edited and deleted. */
  currentUser: CommentAuthor;
  /** People who can be mentioned. Defaults to everyone in the thread. */
  people?: CommentAuthor[];
  resolved?: boolean;
  defaultResolved?: boolean;
  onResolvedChange?: (resolved: boolean) => void;
  /** What the thread is about, shown in its header, such as "Hero headline". */
  title?: ReactNode;
  /** Emoji offered by the reaction picker. */
  reactions?: string[];
  placeholder?: string;
  /** Replies deeper than this attach to the deepest allowed parent. Defaults to 2. */
  maxDepth?: number;
  /** Label for comments written now. */
  nowLabel?: string;
  /** Words for localization. Leave out any key to keep its English default. */
  labels?: CommentThreadLabels;
  className?: string;
}

type Bezier = [number, number, number, number];
const enter = [...motionTokens.ease.enter] as Bezier;
const standard = [...motionTokens.ease.standard] as Bezier;
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const HEIGHT = physical(.42, 0);
const DEFAULT_REACTIONS = ["👍", "❤️", "🎉", "👀", "🚀", "✅"];

const subscribe = () => () => {};
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

/* Tree helpers. Every change returns a new tree so controlled parents can store it as is. */
const mapTree = (list: ThreadComment[], id: string, fn: (comment: ThreadComment) => ThreadComment | null): ThreadComment[] =>
  list.flatMap(comment => {
    if (comment.id === id) { const next = fn(comment); return next ? [next] : []; }
    return comment.replies?.length ? [{ ...comment, replies: mapTree(comment.replies, id, fn) }] : [comment];
  });
const countTree = (list: ThreadComment[]): number => list.reduce((sum, comment) => sum + (comment.deleted ? 0 : 1) + countTree(comment.replies ?? []), 0);
const authorsOf = (list: ThreadComment[], into = new Map<string, CommentAuthor>()) => {
  list.forEach(comment => { if (!comment.deleted) into.set(comment.author.id, comment.author); authorsOf(comment.replies ?? [], into); });
  return into;
};
/** Path of ids from the root to `id`. */
const pathTo = (list: ThreadComment[], id: string, trail: string[] = []): string[] | null => {
  for (const comment of list) {
    if (comment.id === id) return [...trail, id];
    const found = pathTo(comment.replies ?? [], id, [...trail, comment.id]);
    if (found) return found;
  }
  return null;
};
const find = (list: ThreadComment[], id: string): ThreadComment | null => {
  for (const comment of list) {
    if (comment.id === id) return comment;
    const found = find(comment.replies ?? [], id);
    if (found) return found;
  }
  return null;
};
/** Wraps the first `part` inside `text`, so a translated sentence keeps its highlighted name wherever the language puts it. */
const highlight = (text: string, part: string, className: string): ReactNode => {
  const at = part ? text.indexOf(part) : -1;
  return at < 0 ? text : <>{text.slice(0, at)}<span className={className}>{part}</span>{text.slice(at + part.length)}</>;
};
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
let serial = 0;
const newId = () => `c-${Date.now().toString(36)}-${(serial++).toString(36)}`;

function Avatar({ author, size = 28 }: { author: CommentAuthor; size?: number }) {
  return author.avatar
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className={styles.avatar} src={author.avatar} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className={styles.avatar} style={{ width: size, height: size, fontSize: Math.round(size * .38) }} aria-hidden="true">{initials(author.name)}</span>;
}

/** Highlights "@Full Name" for known people. */
function Body({ text, people }: { text: string; people: CommentAuthor[] }) {
  const parts = useMemo(() => {
    const names = people.map(person => person.name).sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!names.length) return [text];
    return text.split(new RegExp(`(@(?:${names.join("|")}))`, "g"));
  }, [people, text]);
  return <p className={styles.body}>{parts.map((part, index) => index % 2 ? <span key={index} className={styles.mention}>{part}</span> : part)}</p>;
}

const roll: Variants = {
  hidden: (dir: number) => ({ y: `${dir * 70}%`, opacity: 0 }),
  shown: { y: 0, opacity: 1 },
  gone: (dir: number) => ({ y: `${dir * -70}%`, opacity: 0 }),
};
const rollReduced: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1 }, gone: { opacity: 0 } };

/** Rolls a count up or down in place. */
function Count({ value, reduced }: { value: number; reduced: boolean }) {
  const [last, setLast] = useState(value);
  const [dir, setDir] = useState(1);
  if (value !== last) { setDir(value > last ? 1 : -1); setLast(value); }
  return <span className={styles.count}>
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.span key={value} custom={dir} variants={reduced ? rollReduced : roll} initial="hidden" animate="shown" exit="gone"
        transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}>{value}</motion.span>
    </AnimatePresence>
  </span>;
}

/** Follows its content's height exactly, except when `morphKey` changes: then it springs, so the thread and the resolved chip morph into each other. */
function AutoHeight({ children, reduced, morphKey }: { children: ReactNode; reduced: boolean; morphKey: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const height = useMotionValue(0);
  const [measured, setMeasured] = useState(false);
  const morphing = useRef(false);
  const lastKey = useRef(morphKey);
  useLayoutEffect(() => {
    if (lastKey.current !== morphKey) { lastKey.current = morphKey; morphing.current = true; }
  }, [morphKey]);
  useLayoutEffect(() => {
    const node = inner.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // The border box keeps subpixel line heights, so the frame never clips a fraction of the last line.
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
      if (morphing.current && !reduced) {
        morphing.current = false;
        animate(height, next, HEIGHT);
        return;
      }
      if (height.isAnimating()) { animate(height, next, HEIGHT); return; }
      height.jump(next);
      setMeasured(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [height, reduced]);
  return <motion.div className={styles.autoHeight} style={{ height: measured ? height : "auto" }}><div ref={inner} className={styles.autoInner}>{children}</div></motion.div>;
}

interface ComposerProps {
  people: CommentAuthor[];
  initial?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  focusKey?: number;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  leading?: ReactNode;
  compact?: boolean;
  cancelLabel: string;
  mentionsLabel: string;
}

/** A growing text field with @mention suggestions. ⌘ or Ctrl + Enter sends; Escape cancels. */
function Composer({ people, initial = "", placeholder, submitLabel, autoFocus, focusKey, onSubmit, onCancel, leading, compact, cancelLabel, mentionsLabel }: ComposerProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduced = useReducedFlag();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState<{ start: number; term: string } | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = useMemo(() => {
    if (!query) return [];
    const term = query.term.toLowerCase();
    return people.filter(person => person.name.toLowerCase().split(" ").some(part => part.startsWith(term)) || person.name.toLowerCase().startsWith(term)).slice(0, 5);
  }, [people, query]);
  const open = !!query && suggestions.length > 0;

  useEffect(() => {
    if (!autoFocus && !focusKey) return;
    const node = field.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, [autoFocus, focusKey]);

  const readQuery = (value: string, caret: number) => {
    const match = /(^|\s)@([\p{L}]*)$/u.exec(value.slice(0, caret));
    setQuery(match ? { start: caret - match[2].length - 1, term: match[2] } : null);
    setActive(0);
  };

  const insert = (person: CommentAuthor) => {
    const node = field.current;
    if (!node || !query) return;
    const caret = node.selectionStart ?? text.length;
    const next = `${text.slice(0, query.start)}@${person.name} ${text.slice(caret)}`;
    const at = query.start + person.name.length + 2;
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(at, at); });
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    onSubmit(body);
    setText("");
    setQuery(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insert(suggestions[active]); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuery(null); return; }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); return; }
    if (event.key === "Escape" && onCancel) { event.preventDefault(); event.stopPropagation(); onCancel(); }
  };

  return <div className={styles.composer} data-compact={compact || undefined}>
    {leading}
    <div className={styles.fieldWrap}>
      <textarea ref={field} className={styles.field} value={text} placeholder={placeholder} rows={1} aria-label={placeholder}
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${uid}-people`} aria-activedescendant={open ? `${uid}-person-${active}` : undefined}
        onChange={event => { setText(event.target.value); readQuery(event.target.value, event.target.selectionStart); }}
        onSelect={event => readQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setQuery(null)} onKeyDown={onKeyDown} />
      <AnimatePresence>
        {open && <motion.ul key="people" id={`${uid}-people`} role="listbox" aria-label={mentionsLabel} className={styles.suggestions}
          initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: { duration: motionTokens.duration.instant, ease: standard } }} transition={reduced ? { duration: 0 } : { height: HEIGHT, opacity: { duration: motionTokens.duration.fast, ease: enter } }}>
          {suggestions.map((person, index) => <li key={person.id} id={`${uid}-person-${index}`} role="option" aria-selected={index === active} className={styles.suggestion}
            onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => insert(person)}>
            <Avatar author={person} size={20} />{person.name}
          </li>)}
        </motion.ul>}
      </AnimatePresence>
    </div>
    <div className={styles.composerActions}>
      {onCancel && <button type="button" className={styles.ghost} onClick={onCancel}>{cancelLabel}</button>}
      <button type="button" className={styles.send} disabled={!text.trim() || text.trim() === initial.trim()} onClick={send}>{submitLabel}</button>
    </div>
  </div>;
}

type Ui = { editing: string | null; confirming: string | null; picker: string | null; collapsed: Record<string, boolean> };

export const CommentThread = forwardRef<HTMLElement, CommentThreadProps>(function CommentThread({
  comments, defaultComments = [], onCommentsChange, currentUser, people, resolved, defaultResolved = false, onResolvedChange,
  title, reactions = DEFAULT_REACTIONS, placeholder = "Reply, or @mention someone", maxDepth = 2, nowLabel = "Just now", labels, className,
}, forwardedRef) {
  const t = withDefaults(DEFAULT_LABELS, labels);
  const reduced = useReducedFlag();
  const rootRef = useRef<HTMLElement>(null);
  useImperativeHandle(forwardedRef, () => rootRef.current as HTMLElement);
  const [internal, setInternal] = useState(defaultComments);
  const list = comments ?? internal;
  const [internalResolved, setInternalResolved] = useState(defaultResolved);
  const isResolved = resolved ?? internalResolved;
  const [ui, setUi] = useState<Ui>({ editing: null, confirming: null, picker: null, collapsed: {} });
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [focusKey, setFocusKey] = useState(0);

  const mentionable = useMemo(() => people ?? [...authorsOf(list, new Map([[currentUser.id, currentUser]])).values()], [currentUser, list, people]);
  const total = countTree(list);
  const participants = useMemo(() => [...authorsOf(list).values()], [list]);

  const commit = useCallback((next: ThreadComment[], event: CommentThreadEvent) => {
    if (comments === undefined) setInternal(next);
    onCommentsChange?.(next, event);
  }, [comments, onCommentsChange]);

  const setResolved = (next: boolean) => {
    if (resolved === undefined) setInternalResolved(next);
    onResolvedChange?.(next);
    setUi(current => ({ ...current, editing: null, confirming: null, picker: null }));
    setReplyTo(null);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(next ? "[data-reopen]" : "[data-resolve]")?.focus({ preventScroll: true }));
  };

  const addReply = (body: string) => {
    const comment: ThreadComment = { id: newId(), author: currentUser, body, createdAt: nowLabel, reactions: [] };
    let parentId: string | null = null;
    if (replyTo) {
      const path = pathTo(list, replyTo.id) ?? [];
      parentId = path[Math.min(path.length, maxDepth) - 1] ?? null;
    }
    const next = parentId ? mapTree(list, parentId, parent => ({ ...parent, replies: [...(parent.replies ?? []), comment] })) : [...list, comment];
    if (parentId) setUi(current => ({ ...current, collapsed: { ...current.collapsed, [parentId!]: false } }));
    commit(next, { type: "reply", comment, parentId });
    setReplyTo(null);
  };

  const edit = (id: string, body: string) => {
    commit(mapTree(list, id, comment => ({ ...comment, body, edited: true })), { type: "edit", id, body });
    setUi(current => ({ ...current, editing: null }));
  };

  const remove = (id: string) => {
    commit(mapTree(list, id, comment => comment.replies?.length ? { ...comment, deleted: true, body: "", reactions: [] } : null), { type: "delete", id });
    setUi(current => ({ ...current, confirming: null }));
    if (replyTo?.id === id) setReplyTo(null);
  };

  const react = (id: string, emoji: string) => {
    const target = find(list, id);
    if (!target) return;
    const existing = target.reactions?.find(reaction => reaction.emoji === emoji);
    const added = !existing?.users.includes(currentUser.id);
    const nextReactions = existing
      ? (target.reactions ?? []).map(reaction => reaction.emoji !== emoji ? reaction : { ...reaction, users: added ? [...reaction.users, currentUser.id] : reaction.users.filter(user => user !== currentUser.id) }).filter(reaction => reaction.users.length)
      : [...(target.reactions ?? []), { emoji, users: [currentUser.id] }];
    commit(mapTree(list, id, comment => ({ ...comment, reactions: nextReactions })), { type: "react", id, emoji, added });
    setUi(current => ({ ...current, picker: null }));
  };

  const grow = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: motionTokens.duration.instant } }
    : { initial: { height: 0, opacity: 0 }, animate: { height: "auto", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { height: HEIGHT, opacity: { duration: motionTokens.duration.standard, ease: enter } } };

  const swap = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: reduced ? 0 : motionTokens.duration.instant, ease: standard } }, transition: { duration: reduced ? 0 : motionTokens.duration.fast, ease: enter } };

  const renderComment = (comment: ThreadComment, depth: number): ReactNode => {
    const mine = comment.author.id === currentUser.id;
    const replies = comment.replies ?? [];
    const collapsed = !!ui.collapsed[comment.id];
    const editing = ui.editing === comment.id, confirming = ui.confirming === comment.id, picking = ui.picker === comment.id;
    return <motion.li key={comment.id} className={styles.item} {...grow}>
      <article className={styles.comment} aria-label={comment.deleted ? t.deletedComment : `${comment.author.name}, ${comment.createdAt}`}>
        {comment.deleted ? <span className={styles.deletedDot} aria-hidden="true" /> : <Avatar author={comment.author} />}
        <div className={styles.main}>
          {comment.deleted
            ? <p className={styles.deleted}>{t.deletedText}</p>
            : <>
              <header className={styles.meta}>
                <span className={styles.name}>{comment.author.name}</span>
                <span className={styles.time}>{comment.createdAt}{comment.edited && ` · ${t.edited}`}</span>
              </header>
              {/* Editing swaps the body for a composer in place: the two cross-fade while the comment's height springs between them.
                  The picker and delete prompt can wrap onto a new line on narrow screens, so they spring the height too. */}
              <AutoHeight reduced={reduced} morphKey={editing ? "edit" : confirming ? "confirm" : picking ? "picker" : "view"}>
                <AnimatePresence mode="popLayout" initial={false}>
                {editing
                ? <motion.div key="edit" {...swap}><Composer people={mentionable} initial={comment.body} placeholder={t.editComment} submitLabel={t.save} cancelLabel={t.cancel} mentionsLabel={t.mentions} autoFocus compact onSubmit={body => edit(comment.id, body)} onCancel={() => setUi(current => ({ ...current, editing: null }))} /></motion.div>
                : <motion.div key="view" {...swap}>
                <Body text={comment.body} people={mentionable} />

              <div className={styles.footer}>
                {(comment.reactions ?? []).length > 0 && <div className={styles.reactions}>
                  <AnimatePresence initial={false} mode="popLayout">
                    {(comment.reactions ?? []).map(reaction => {
                      const pressed = reaction.users.includes(currentUser.id);
                      return <motion.button key={reaction.emoji} type="button" layout={!reduced} className={styles.reaction} aria-pressed={pressed}
                        aria-label={t.reactionCount(reaction.emoji, reaction.users.length, pressed)} onClick={() => react(comment.id, reaction.emoji)}
                        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .7 }}
                        transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}>
                        <span aria-hidden="true">{reaction.emoji}</span><Count value={reaction.users.length} reduced={reduced} />
                      </motion.button>;
                    })}
                  </AnimatePresence>
                </div>}

                <AnimatePresence mode="wait" initial={false}>
                  {confirming
                    ? <motion.div key="confirm" className={styles.actions} data-open="" initial={reduced ? { opacity: 0 } : { opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : motionTokens.duration.instant, ease: standard } }} transition={{ duration: reduced ? 0 : motionTokens.duration.fast, ease: enter }}
                      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setUi(current => ({ ...current, confirming: null })); } }}>
                      <span className={styles.prompt}>{t.deleteConfirm}</span>
                      <button type="button" className={styles.action} onClick={() => setUi(current => ({ ...current, confirming: null }))}>{t.cancel}</button>
                      <button type="button" className={styles.action} data-tone="danger" autoFocus onClick={() => remove(comment.id)}>{t.delete}</button>
                    </motion.div>
                    : picking
                    ? <motion.div key="picker" role="group" aria-label={t.reactions} className={styles.actions} data-open=""
                      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setUi(current => ({ ...current, picker: null })); } }}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : motionTokens.duration.instant, ease: standard } }} transition={{ duration: reduced ? 0 : motionTokens.duration.fast, ease: enter }}>
                      {reactions.map((emoji, index) => <motion.button key={emoji} type="button" className={styles.emoji} autoFocus={index === 0} aria-label={t.reactWith(emoji)}
                        aria-pressed={!!comment.reactions?.find(reaction => reaction.emoji === emoji)?.users.includes(currentUser.id)} onClick={() => react(comment.id, emoji)}
                        initial={reduced ? false : { opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} transition={reduced ? { duration: 0 } : { ...motionTokens.spring.snappy, delay: index * motionTokens.stagger.item }}>{emoji}</motion.button>)}
                      <button type="button" className={styles.iconAction} aria-label={t.closeReactions} onClick={() => setUi(current => ({ ...current, picker: null }))}><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>
                    </motion.div>
                    : <motion.div key="actions" className={styles.actions} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : motionTokens.duration.instant, ease: standard }}>
                      <button type="button" className={styles.iconAction} aria-label={t.addReaction} onClick={() => setUi(current => ({ ...current, picker: comment.id, confirming: null }))}>
                        <SmilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                      <button type="button" className={styles.action} onClick={() => { setReplyTo({ id: comment.id, name: comment.author.name }); setFocusKey(key => key + 1); }}>{t.reply}</button>
                      {mine && <button type="button" className={styles.action} onClick={() => setUi(current => ({ ...current, editing: comment.id, confirming: null, picker: null }))}>{t.edit}</button>}
                      {mine && <button type="button" className={styles.action} onClick={() => setUi(current => ({ ...current, confirming: comment.id, editing: null, picker: null }))}>{t.delete}</button>}
                    </motion.div>}
                </AnimatePresence>
              </div>
                </motion.div>}
                </AnimatePresence>
              </AutoHeight>
            </>}

          {replies.length > 0 && <button type="button" className={styles.toggle} aria-expanded={!collapsed}
            onClick={() => setUi(current => ({ ...current, collapsed: { ...current.collapsed, [comment.id]: !collapsed } }))}>
            <motion.span className={styles.toggleIcon} initial={false} animate={{ rotate: collapsed ? 0 : 90 }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy} aria-hidden="true">
              <ChevronRight size={13} strokeWidth={1.75} />
            </motion.span>
            {collapsed ? t.showReplies(countTree(replies)) : t.hideReplies}
            {collapsed && <span className={styles.stack} aria-hidden="true">{[...authorsOf(replies).values()].slice(0, 3).map(author => <Avatar key={author.id} author={author} size={18} />)}</span>}
          </button>}
        </div>
      </article>

      <AnimatePresence initial={false}>
        {replies.length > 0 && !collapsed && <motion.div key="replies" className={styles.repliesWrap} {...grow}>
          <ul className={styles.replies} data-depth={depth + 1}>
            <AnimatePresence initial={false}>{replies.map(reply => renderComment(reply, depth + 1))}</AnimatePresence>
          </ul>
        </motion.div>}
      </AnimatePresence>
    </motion.li>;
  };

  const face = { initial: reduced ? { opacity: 0 } : { opacity: 0, filter: `blur(${motionTokens.blur.subtle}px)` }, animate: { opacity: 1, filter: "blur(0px)" }, exit: { opacity: 0, filter: reduced ? "blur(0px)" : `blur(${motionTokens.blur.subtle}px)` }, transition: { duration: reduced ? 0 : motionTokens.duration.standard, ease: enter } };

  return <section ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} data-resolved={isResolved || undefined} aria-label={t.thread}>
    <AutoHeight reduced={reduced} morphKey={isResolved ? "resolved" : "thread"}>
      <AnimatePresence mode="popLayout" initial={false}>
        {isResolved
          ? <motion.div key="resolved" className={styles.resolved} {...face}>
            <span className={styles.resolvedIcon} aria-hidden="true"><Check size={14} strokeWidth={2} /></span>
            <span className={styles.resolvedText}>
              <span className={styles.resolvedTitle}>{t.resolved}{title ? <> · <span className={styles.resolvedSubject}>{title}</span></> : null}</span>
              <span className={styles.resolvedMeta}>{t.commentCount(total)} · {t.peopleCount(participants.length)}</span>
            </span>
            <span className={styles.stack} aria-hidden="true">{participants.slice(0, 3).map(author => <Avatar key={author.id} author={author} size={22} />)}</span>
            <button type="button" className={styles.reopen} data-reopen onClick={() => setResolved(false)}><RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />{t.reopen}</button>
          </motion.div>
          : <motion.div key="thread" className={styles.thread} {...face}>
            <header className={styles.header}>
              <div className={styles.heading}>
                {title && <h3 className={styles.title}>{title}</h3>}
                <span className={styles.subtitle}>{t.commentCount(total)}</span>
              </div>
              <button type="button" className={styles.resolve} data-resolve disabled={!total} onClick={() => setResolved(true)}><Check size={15} strokeWidth={1.75} aria-hidden="true" />{t.resolve}</button>
            </header>

            {list.length > 0
              ? <ul className={styles.list}><AnimatePresence initial={false}>{list.map(comment => renderComment(comment, 0))}</AnimatePresence></ul>
              : <p className={styles.empty}>{t.empty}</p>}

            <div className={styles.composerArea}>
              <AnimatePresence initial={false}>
                {replyTo && <motion.div key="replying" className={styles.replying} {...grow}>
                  <span className={styles.replyingInner}>
                    <CornerDownRight size={13} strokeWidth={1.75} aria-hidden="true" />
                    <span>{highlight(t.replyingTo(replyTo.name), replyTo.name, styles.replyingName)}</span>
                    <button type="button" className={styles.iconAction} aria-label={t.cancelReply} onClick={() => setReplyTo(null)}><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>
                  </span>
                </motion.div>}
              </AnimatePresence>
              <Composer people={mentionable} placeholder={placeholder} submitLabel={t.send} cancelLabel={t.cancel} mentionsLabel={t.mentions} focusKey={focusKey} onSubmit={addReply}
                onCancel={replyTo ? () => setReplyTo(null) : undefined} leading={<Avatar author={currentUser} />} />
            </div>
          </motion.div>}
      </AnimatePresence>
    </AutoHeight>
  </section>;
});

export default CommentThread;
