"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { Transition, Variants } from "motion/react";
import { ArrowLeft, Bold, Check, Code, Heading1, Heading2, Heading3, Italic, Link, List, ListOrdered, Minus, Pilcrow, Quote, SquareCode, Strikethrough, Unlink } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./rich-text-editor.module.css";

/* ------------------------------------------------------------------------------------------------
 * Markdown and HTML. Small, dependency free converters for the subset the editor writes.
 * ---------------------------------------------------------------------------------------------- */

export type BlockType = "p" | "h1" | "h2" | "h3" | "ul" | "ol" | "blockquote" | "pre" | "hr";

const ZWSP = /\u200b/g;
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (url: string) => /^(https?:|mailto:|tel:|\/|#)/i.test(url.trim());

/** Adds a scheme to bare domains so `example.com/docs` becomes a working link. */
export function normalizeUrl(input: string) {
  const url = input.trim();
  if (!url) return "";
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("/") || url.startsWith("#")) return url;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}

function inlineMarkdown(text: string) {
  const codes: string[] = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code: string) => `\u0000${codes.push(code) - 1}\u0000`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => safeUrl(url) ? `<a href="${url}">${label}</a>` : label);
  out = out.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>");
  out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<s>$1</s>");
  out = out.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, "$1<em>$2</em>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => `<code>${codes[Number(index)]}</code>`);
}

function listMarkdown(lines: string[]) {
  const items = lines.map(line => {
    const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)!;
    return { indent: match[1]!.replace(/\t/g, "  ").length, tag: /\d/.test(match[2]!) ? "ol" : "ul", text: match[3]! };
  });
  let html = "";
  const stack: { indent: number; tag: string }[] = [];
  for (const item of items) {
    while (stack.length > 1 && item.indent < stack[stack.length - 1]!.indent) html += `</li></${stack.pop()!.tag}>`;
    const top = stack[stack.length - 1];
    if (!top || item.indent > top.indent) { html += `<${item.tag}><li>`; stack.push({ indent: item.indent, tag: item.tag }); }
    else if (top.tag !== item.tag) { html += `</li></${top.tag}><${item.tag}><li>`; top.tag = item.tag; }
    else html += "</li><li>";
    html += inlineMarkdown(item.text);
  }
  while (stack.length) html += `</li></${stack.pop()!.tag}>`;
  return html;
}

/** Converts Markdown to the editor's HTML: headings (three levels), lists, quotes, fenced code, rules, and inline marks. */
export function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`); paragraph.length = 0; } };
  const isItem = (line: string) => /^\s*([-*+]|\d+[.)])\s+/.test(line);
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index]!)) code.push(lines[index++]!);
      index++;
      out.push(`<pre>${escapeHtml(code.join("\n")) || "<br>"}</pre>`);
      continue;
    }
    if (!line.trim()) { flush(); index++; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { flush(); const level = Math.min(3, heading[1]!.length); out.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`); index++; continue; }
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) { flush(); out.push("<hr>"); index++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index]!)) quote.push(lines[index++]!.replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${quote.map(inlineMarkdown).join("<br>")}</blockquote>`);
      continue;
    }
    if (isItem(line)) {
      flush();
      const items: string[] = [];
      while (index < lines.length && isItem(lines[index]!)) items.push(lines[index++]!);
      out.push(listMarkdown(items));
      continue;
    }
    paragraph.push(line.trim());
    index++;
  }
  flush();
  return out.join("") || "<p><br></p>";
}

function wrapMark(inner: string, mark: string) {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return match[2] ? `${match[1]}${mark}${match[2]}${mark}${match[3]}` : inner;
}

function inlineToMarkdown(node: Node): string {
  let out = "";
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) { out += (child as Text).data.replace(ZWSP, ""); return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const element = child as HTMLElement;
    switch (element.nodeName) {
      case "BR": out += "\n"; break;
      case "STRONG": case "B": out += wrapMark(inlineToMarkdown(element), "**"); break;
      case "EM": case "I": out += wrapMark(inlineToMarkdown(element), "_"); break;
      case "S": case "STRIKE": case "DEL": out += wrapMark(inlineToMarkdown(element), "~~"); break;
      case "CODE": out += `\`${(element.textContent ?? "").replace(ZWSP, "")}\``; break;
      case "A": out += `[${inlineToMarkdown(element)}](${element.getAttribute("href") ?? ""})`; break;
      case "UL": case "OL": break;
      default: out += inlineToMarkdown(element);
    }
  });
  return out;
}

function listToMarkdown(list: Element, indent: string): string {
  let number = 1;
  return Array.from(list.children).filter(item => item.nodeName === "LI").map(item => {
    const marker = list.nodeName === "OL" ? `${number++}. ` : "- ";
    const nested = Array.from(item.children).filter(child => child.nodeName === "UL" || child.nodeName === "OL").map(child => listToMarkdown(child, indent + " ".repeat(marker.length)));
    return [`${indent}${marker}${inlineToMarkdown(item).trim()}`, ...nested].join("\n");
  }).join("\n");
}

function blockToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.replace(ZWSP, "").trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  switch (element.nodeName) {
    case "H1": return `# ${inlineToMarkdown(element).trim()}`;
    case "H2": return `## ${inlineToMarkdown(element).trim()}`;
    case "H3": return `### ${inlineToMarkdown(element).trim()}`;
    case "HR": return "---";
    case "PRE": return `\`\`\`\n${(element.textContent ?? "").replace(ZWSP, "").replace(/\n$/, "")}\n\`\`\``;
    case "UL": case "OL": return listToMarkdown(element, "");
    case "BLOCKQUOTE": {
      const blocks = Array.from(element.children).some(child => BLOCK_TAGS.has(child.nodeName));
      const body = blocks ? Array.from(element.childNodes).map(blockToMarkdown).filter(Boolean).join("\n\n") : inlineToMarkdown(element).trim();
      return body.split("\n").map(line => line ? `> ${line}` : ">").join("\n");
    }
    default: return inlineToMarkdown(element).trim();
  }
}

/** Converts editor HTML (or an element) to Markdown. */
export function htmlToMarkdown(input: string | HTMLElement) {
  const root = typeof input === "string" ? parseHtml(input) : input;
  return Array.from(root.childNodes).map(blockToMarkdown).filter(Boolean).join("\n\n");
}

function parseHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = document.createElement("div");
  root.appendChild(template.content);
  return root;
}

const insertAfter = (reference: Node, ...nodes: Node[]) => { let at = reference; nodes.forEach(node => { at.parentNode!.insertBefore(node, at.nextSibling); at = node; }); };
const insertBefore = (reference: Node, ...nodes: Node[]) => nodes.forEach(node => reference.parentNode!.insertBefore(node, reference));
const replaceNode = (old: Node, ...nodes: Node[]) => { insertBefore(old, ...nodes); old.parentNode!.removeChild(old); };
const appendNodes = (parent: Node, ...nodes: Node[]) => nodes.forEach(node => parent.appendChild(node));

const INLINE_MAP: Record<string, string> = { B: "strong", STRONG: "strong", I: "em", EM: "em", S: "s", STRIKE: "s", DEL: "s", CODE: "code", A: "a", BR: "br" };
const BLOCK_MAP: Record<string, string> = { P: "p", H1: "h1", H2: "h2", H3: "h3", H4: "h3", H5: "h3", H6: "h3", UL: "ul", OL: "ol", LI: "li", BLOCKQUOTE: "blockquote", PRE: "pre", HR: "hr" };
const DROP = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "IMG", "VIDEO", "AUDIO", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "HEAD"]);
const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "LI", "PRE", "BLOCKQUOTE", "DIV", "UL", "OL", "HR"]);

/** Keeps only the tags the editor understands and drops every attribute except safe link targets. Bold and italic spans from other editors become marks. */
export function sanitizeHtml(html: string) {
  const source = new DOMParser().parseFromString(html, "text/html").body;
  const out = document.createElement("div");
  const convert = (from: Node, into: Node) => {
    from.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) { into.appendChild(document.createTextNode((child as Text).data)); return; }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child as HTMLElement;
      if (DROP.has(element.nodeName)) return;
      const style = element.getAttribute("style") ?? "";
      let tag = INLINE_MAP[element.nodeName] ?? BLOCK_MAP[element.nodeName];
      if (element.nodeName === "B" && /font-weight:\s*(normal|[1-4]00)/.test(style)) tag = "";
      if (element.nodeName === "SPAN") tag = /font-weight:\s*(bold|[6-9]00)/.test(style) ? "strong" : /font-style:\s*italic/.test(style) ? "em" : /line-through/.test(style) ? "s" : "";
      if (!tag) { convert(element, into); return; }
      const next = document.createElement(tag);
      if (tag === "a") {
        const href = element.getAttribute("href") ?? "";
        if (!safeUrl(href)) { convert(element, into); return; }
        next.setAttribute("href", href);
      }
      if (tag === "pre") next.textContent = element.textContent ?? "";
      else if (tag !== "br" && tag !== "hr") convert(element, next);
      into.appendChild(next);
    });
  };
  convert(source, out);
  // Inline runs at the top level become paragraphs; whitespace between blocks disappears.
  const fixed = document.createElement("div");
  let run: HTMLElement | null = null;
  Array.from(out.childNodes).forEach(node => {
    const block = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.nodeName);
    if (block) { run = null; fixed.appendChild(node); return; }
    if (node.nodeType === Node.TEXT_NODE && !(node as Text).data.trim() && !run) return;
    if (!run) { run = document.createElement("p"); fixed.appendChild(run); }
    run.appendChild(node);
  });
  fixed.querySelectorAll("li > p").forEach(paragraph => replaceNode(paragraph, ...Array.from(paragraph.childNodes)));
  // The editor keeps typed whitespace, so formatting whitespace between blocks and list items has to go.
  [fixed, ...Array.from(fixed.querySelectorAll("ul, ol, blockquote, li"))].forEach(parent => Array.from(parent.childNodes).forEach(node => {
    if (isText(node) && !node.data.trim() && (parent === fixed || parent.nodeName === "UL" || parent.nodeName === "OL" || (node.previousSibling && BLOCK_TAGS.has(node.previousSibling.nodeName)) || (node.nextSibling && BLOCK_TAGS.has(node.nextSibling.nodeName)))) node.remove();
  }));
  return fixed.innerHTML;
}

/* ------------------------------------------------------------------------------------------------
 * DOM helpers. Positions are stored as character offsets where every block start and line break
 * counts as one character, so the caret survives any rewrite that keeps the text.
 * ---------------------------------------------------------------------------------------------- */

const COUNTED = new Set(["P", "H1", "H2", "H3", "LI", "PRE", "BLOCKQUOTE", "DIV"]);
const isElement = (node: Node | null): node is HTMLElement => !!node && node.nodeType === Node.ELEMENT_NODE;
const isText = (node: Node | null): node is Text => !!node && node.nodeType === Node.TEXT_NODE;

function pointToOffset(root: Node, container: Node, offset: number) {
  let count = 0, found = -1;
  const visit = (node: Node) => {
    if (found >= 0) return;
    if (isText(node)) { if (node === container) found = count + offset; else count += node.data.length; return; }
    if (!isElement(node)) return;
    if (node !== root && COUNTED.has(node.nodeName)) count += 1;
    if (node.nodeName === "BR" || node.nodeName === "HR") count += 1;
    const children = node.childNodes;
    for (let index = 0; index < children.length; index++) {
      if (node === container && index === offset) { found = count; return; }
      visit(children[index]!);
      if (found >= 0) return;
    }
    if (node === container) found = count;
  };
  visit(root);
  return found < 0 ? count : found;
}

function offsetToPoint(root: Node, target: number): [Node, number] {
  let count = 0;
  let result: [Node, number] | null = null;
  const visit = (node: Node) => {
    if (result) return;
    if (isText(node)) {
      if (target <= count + node.data.length) { result = [node, Math.max(0, target - count)]; return; }
      count += node.data.length;
      return;
    }
    if (!isElement(node)) return;
    if (node !== root && COUNTED.has(node.nodeName)) count += 1;
    if (node.nodeName === "BR" || node.nodeName === "HR") {
      if (count === target && node.parentNode) { result = [node.parentNode, Array.prototype.indexOf.call(node.parentNode.childNodes, node)]; return; }
      count += 1;
      return;
    }
    node.childNodes.forEach(visit);
    if (!result && count === target && node !== root && COUNTED.has(node.nodeName)) result = [node, node.childNodes.length];
  };
  visit(root);
  if (result) return result;
  const last = root.lastChild;
  return last && isElement(last) && last.nodeName !== "HR" ? [last, last.childNodes.length] : [root, root.childNodes.length];
}

type Offsets = { start: number; end: number };

function readOffsets(root: HTMLElement): Offsets | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return { start: pointToOffset(root, range.startContainer, range.startOffset), end: pointToOffset(root, range.endContainer, range.endOffset) };
}

function writeOffsets(root: HTMLElement, offsets: Offsets | null) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (!offsets) { range.selectNodeContents(root.lastElementChild ?? root); range.collapse(false); }
  else {
    const [startNode, startOffset] = offsetToPoint(root, offsets.start);
    const [endNode, endOffset] = offsets.end === offsets.start ? [startNode, startOffset] : offsetToPoint(root, offsets.end);
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The visible band of the nearest scrolling or clipping ancestor, so floating layers flip before they get cut off. */
function clipBand(element: HTMLElement) {
  let top = 0, bottom = window.innerHeight;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowY !== "visible" || style.overflowX !== "visible") {
      const rect = node.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
  }
  return { top, bottom };
}

function placeCaret(node: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeAtStart(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) placeCaret(first, 0); else placeCaret(element, 0);
}

/** The nearest block around a node: a paragraph, heading, list item, quote, or code block. */
function blockAt(root: HTMLElement, node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (isElement(current) && COUNTED.has(current.nodeName)) return current;
    current = current.parentNode;
  }
  return null;
}

const visibleText = (element: Node) => (element.textContent ?? "").replace(ZWSP, "");

function ensureFilled(element: HTMLElement) {
  if (element.nodeName === "HR") return;
  if (!visibleText(element) && !element.querySelector("br, hr, ul, ol")) element.appendChild(document.createElement("br"));
}

function textBefore(block: HTMLElement, range: Range) {
  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().replace(ZWSP, "").replace(/\u00a0/g, " ");
}

function atBlockStart(block: HTMLElement, range: Range) {
  if (!range.collapsed) return false;
  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(range.startContainer, range.startOffset);
  return !before.toString().replace(ZWSP, "") && !before.cloneContents().querySelector("br, hr");
}

function moveChildren(from: Node, to: Node) {
  while (from.firstChild) to.appendChild(from.firstChild);
}

/** Plain text of a block, with line breaks for `<br>`, for moving content into a code block. */
function plainText(element: HTMLElement) {
  let out = "";
  const walk = (node: Node) => node.childNodes.forEach(child => {
    if (isText(child)) out += child.data.replace(ZWSP, "");
    else if (child.nodeName === "BR") out += "\n";
    else walk(child);
  });
  walk(element);
  return out.replace(/\n$/, "");
}

function linesToNodes(text: string) {
  const nodes: Node[] = [];
  text.replace(/\n$/, "").split("\n").forEach((line, index) => {
    if (index) nodes.push(document.createElement("br"));
    if (line) nodes.push(document.createTextNode(line));
  });
  return nodes;
}

function mergeAdjacentLists(list: HTMLElement) {
  const next = list.nextElementSibling;
  if (next && next.nodeName === list.nodeName) { moveChildren(next, list); next.remove(); }
  const previous = list.previousElementSibling;
  if (previous && previous.nodeName === list.nodeName) { moveChildren(list, previous); list.remove(); return previous as HTMLElement; }
  return list;
}

/** Moves a list item one level out. A top level item leaves the list and becomes a paragraph between its halves. */
function outdent(item: HTMLElement): HTMLElement {
  const list = item.parentElement!;
  const parentItem = list.parentElement;
  const following: Node[] = [];
  for (let node = item.nextSibling; node; node = node.nextSibling) following.push(node);
  if (parentItem?.nodeName === "LI") {
    if (following.length) {
      const sub = document.createElement(list.nodeName.toLowerCase());
      following.forEach(node => sub.appendChild(node));
      item.appendChild(sub);
    }
    insertAfter(parentItem, item);
    if (!list.children.length) list.remove();
    return item;
  }
  const paragraph = document.createElement("p");
  const nested: Node[] = [];
  Array.from(item.childNodes).forEach(child => { if (child.nodeName === "UL" || child.nodeName === "OL") nested.push(child); else paragraph.appendChild(child); });
  ensureFilled(paragraph);
  const tail = following.length || nested.length ? document.createElement(list.nodeName.toLowerCase()) : null;
  if (tail) {
    nested.forEach(sub => sub.childNodes.length && Array.from(sub.childNodes).forEach(node => tail.appendChild(node)));
    following.forEach(node => tail.appendChild(node));
  }
  insertAfter(list, paragraph);
  if (tail) insertAfter(paragraph, tail);
  item.remove();
  if (!list.children.length) list.remove();
  return paragraph;
}

function indent(item: HTMLElement) {
  const previous = item.previousElementSibling as HTMLElement | null;
  if (!previous || previous.nodeName !== "LI") return false;
  const listTag = item.parentElement!.nodeName;
  let sub = previous.lastElementChild as HTMLElement | null;
  if (!sub || (sub.nodeName !== "UL" && sub.nodeName !== "OL")) { sub = document.createElement(listTag.toLowerCase()); previous.appendChild(sub); }
  sub.appendChild(item);
  return true;
}

/** Turns one block into another type, keeping its content. Choosing the type a block already has turns it back into a paragraph. */
function convertBlock(block: HTMLElement, type: Exclude<BlockType, "hr">): HTMLElement {
  if (block.nodeName === "LI") {
    const list = block.parentElement!;
    if (type === "ul" || type === "ol") {
      if (list.nodeName.toLowerCase() === type) return outdent(block);
      const swapped = document.createElement(type);
      moveChildren(list, swapped);
      replaceNode(list, swapped);
      return block;
    }
    const paragraph = outdent(block);
    return paragraph.nodeName === "P" && type !== "p" ? convertBlock(paragraph, type) : paragraph;
  }
  if (type === "ul" || type === "ol") {
    const item = document.createElement("li");
    if (block.nodeName === "PRE") appendNodes(item, ...linesToNodes(block.textContent ?? "")); else moveChildren(block, item);
    ensureFilled(item);
    const list = document.createElement(type);
    list.appendChild(item);
    replaceNode(block, list);
    mergeAdjacentLists(list);
    return item;
  }
  const tag = block.nodeName.toLowerCase() === type ? "p" : type;
  const next = document.createElement(tag);
  if (tag === "pre") next.textContent = plainText(block);
  else if (block.nodeName === "PRE") appendNodes(next, ...linesToNodes(block.textContent ?? ""));
  else moveChildren(block, next);
  ensureFilled(next);
  replaceNode(block, next);
  return next;
}

/** Makes sure a paragraph follows a block the caret cannot type after, such as a rule or a code block at the end. */
function paragraphAfter(block: Element) {
  const next = block.nextElementSibling;
  if (next && next.nodeName === "P") return next as HTMLElement;
  const paragraph = document.createElement("p");
  paragraph.appendChild(document.createElement("br"));
  insertAfter(block, paragraph);
  return paragraph;
}

/** Repairs what browsers leave behind: styled spans from merges, stray inline content at the top level, and an empty root. */
function tidy(root: HTMLElement) {
  const loose = Array.from(root.childNodes).some(node => (isText(node) && node.data.trim()) || (isElement(node) && !BLOCK_TAGS.has(node.nodeName)));
  const dirty = loose || !root.firstChild || root.querySelector("span, font, [style], div, b, i, strike");
  if (!dirty) return;
  const offsets = readOffsets(root);
  root.querySelectorAll("[style]").forEach(element => {
    const style = element.getAttribute("style") ?? "";
    if (element.nodeName === "SPAN" && /font-weight:\s*(bold|[6-9]00)/.test(style)) replaceNode(element, Object.assign(document.createElement("strong"), { innerHTML: element.innerHTML }));
    else element.removeAttribute("style");
  });
  const rename = (selector: string, tag: string) => root.querySelectorAll(selector).forEach(element => {
    const next = document.createElement(tag);
    moveChildren(element, next);
    replaceNode(element, next);
  });
  rename("b", "strong");
  rename("i", "em");
  rename("strike", "s");
  rename(":scope > div", "p");
  root.querySelectorAll("span, font, div").forEach(element => replaceNode(element, ...Array.from(element.childNodes)));
  let run: HTMLElement | null = null;
  Array.from(root.childNodes).forEach(node => {
    if (isElement(node) && BLOCK_TAGS.has(node.nodeName)) { run = null; return; }
    if (isText(node) && !node.data.trim() && !run) { node.remove(); return; }
    if (!run) { run = document.createElement("p"); insertBefore(node, run); }
    run.appendChild(node);
  });
  if (!root.firstChild) root.innerHTML = "<p><br></p>";
  if (root.contains(document.activeElement) || document.activeElement === root) writeOffsets(root, offsets);
}

/** A clean copy for output: canonical tags, no attributes but links, no invisible helpers, no trailing empty lines. */
function cleanClone(root: HTMLElement) {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("*").forEach(element => {
    Array.from(element.attributes).forEach(attribute => { if (!(element.nodeName === "A" && attribute.name === "href")) element.removeAttribute(attribute.name); });
  });
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const empty: Text[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    node.data = node.data.replace(ZWSP, "");
    if (!node.data) empty.push(node);
  }
  empty.forEach(node => node.remove());
  clone.querySelectorAll("p, h1, h2, h3, li, blockquote").forEach(block => {
    const last = block.lastChild;
    if (last?.nodeName === "BR" && visibleText(block)) last.remove();
  });
  clone.querySelectorAll("pre").forEach(pre => { pre.textContent = (pre.textContent ?? "").replace(/\n$/, ""); });
  while (clone.lastElementChild && clone.lastElementChild.nodeName !== "HR" && !visibleText(clone.lastElementChild) && clone.children.length > 1) clone.lastElementChild.remove();
  return clone;
}

function plainOutput(clone: HTMLElement) {
  return Array.from(clone.querySelectorAll("p, h1, h2, h3, li, blockquote, pre")).filter(block => !block.querySelector("p, li")).map(block => (block.textContent ?? "").trim()).filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * Component
 * ---------------------------------------------------------------------------------------------- */

export interface RichTextValue {
  html: string;
  markdown: string;
  text: string;
  empty: boolean;
}

export interface RichTextEditorHandle {
  focus: () => void;
  getHTML: () => string;
  getMarkdown: () => string;
  getText: () => string;
  setHTML: (html: string) => void;
  setMarkdown: (markdown: string) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  element: HTMLDivElement | null;
}

export interface RichTextEditorProps {
  /** Controlled HTML. The editor only rewrites its content when this differs from what it last emitted. */
  value?: string;
  defaultValue?: string;
  /** Initial content as Markdown, used when no HTML value is given. */
  defaultMarkdown?: string;
  onChange?: (value: RichTextValue) => void;
  /** Reports whether undo and redo are available, for your own toolbar. */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  placeholder?: string;
  /** The hint on an empty line while typing. */
  blockHint?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

type Formats = { bold: boolean; italic: boolean; strike: boolean; code: boolean; link: string | null; block: string };
type SlashItem = { type: BlockType; label: string; hint: string; keywords: string; icon: ReactNode };
type Slash = { node: Text; offset: number; query: string; x: number; y: number; above: boolean; max: number };
type Snapshot = { html: string; selection: Offsets | null; kind: "type" | "command"; at: number };

const icon = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const SLASH_ITEMS: SlashItem[] = [
  { type: "p", label: "Text", hint: "", keywords: "paragraph plain body", icon: <Pilcrow {...icon} /> },
  { type: "h1", label: "Heading 1", hint: "#", keywords: "title h1 large", icon: <Heading1 {...icon} /> },
  { type: "h2", label: "Heading 2", hint: "##", keywords: "subtitle h2 section", icon: <Heading2 {...icon} /> },
  { type: "h3", label: "Heading 3", hint: "###", keywords: "h3 small", icon: <Heading3 {...icon} /> },
  { type: "ul", label: "Bulleted list", hint: "-", keywords: "bullet unordered ul points", icon: <List {...icon} /> },
  { type: "ol", label: "Numbered list", hint: "1.", keywords: "ordered ol steps numbers", icon: <ListOrdered {...icon} /> },
  { type: "blockquote", label: "Quote", hint: ">", keywords: "blockquote citation callout", icon: <Quote {...icon} /> },
  { type: "pre", label: "Code block", hint: "```", keywords: "pre snippet monospace", icon: <SquareCode {...icon} /> },
  { type: "hr", label: "Divider", hint: "---", keywords: "rule hr line separator", icon: <Minus {...icon} /> },
];

const { spring, duration, ease, blur } = motionTokens;
const enter = [...ease.enter] as [number, number, number, number];
const standard = [...ease.standard] as [number, number, number, number];
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
};
const MORPH = physical(spring.morph.visualDuration, .12), GLIDE = physical(.3, .08), GROW = physical(spring.smooth.visualDuration, 0);
const TRAVEL = 18;

const faceVariants: Variants = {
  hidden: (direction: number) => ({ opacity: 0, x: direction * TRAVEL, filter: `blur(${blur.subtle}px)` }),
  shown: { opacity: 1, x: 0, filter: "blur(0px)", transition: { x: MORPH, opacity: { duration: .2, ease: enter, delay: .03 }, filter: { duration: .2, ease: enter, delay: .03 } } },
  gone: (direction: number) => ({ opacity: 0, x: direction * -TRAVEL, filter: `blur(${blur.subtle}px)`, transition: { x: MORPH, opacity: { duration: .12, ease: standard }, filter: { duration: .12, ease: standard } } }),
};
const fadeVariants: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: .14 } }, gone: { opacity: 0, transition: { duration: .1 } } };

/** A toolbar face reports its natural size while current, so the shared surface can spring to it. */
function Face({ direction, reduced, onSize, children }: { direction: number; reduced: boolean; onSize: (width: number, height: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !present) return;
    const report = () => onSize(node.offsetWidth, node.offsetHeight);
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onSize, present]);
  return <motion.div ref={ref} className={styles.face} custom={direction} variants={reduced ? fadeVariants : faceVariants} initial="hidden" animate="shown" exit="gone" inert={!present || undefined}>{children}</motion.div>;
}

function ToolButton({ label, pressed, shortcut, onPress, children }: { label: string; pressed: boolean; shortcut?: string; onPress: () => void; children: ReactNode }) {
  return <button type="button" className={styles.tool} aria-label={label} aria-pressed={pressed} title={shortcut ? `${label} (${shortcut})` : label} onMouseDown={event => event.preventDefault()} onClick={onPress}>{children}</button>;
}

/**
 * A light rich text editor on contentEditable. Markdown shortcuts as you type, a floating selection toolbar that morphs into a link field,
 * a slash menu for blocks, its own undo history, and HTML plus Markdown output. No dependencies beyond Motion and icons.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor({
  value, defaultValue, defaultMarkdown, onChange, onHistoryChange, placeholder = "Start writing", blockHint = "Type / for blocks",
  readOnly = false, autoFocus = false, "aria-label": ariaLabel = "Editor", className, style,
}, ref) {
  const reduced = !!useReducedMotion();
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const dragging = useRef(false);
  const lastInput = useRef("");
  const lastEmitted = useRef<string | null>(null);
  const history = useRef<{ stack: Snapshot[]; index: number }>({ stack: [], index: -1 });
  const callbacks = useRef({ onChange, onHistoryChange });
  useEffect(() => { callbacks.current = { onChange, onHistoryChange }; }, [onChange, onHistoryChange]);

  const [empty, setEmpty] = useState(true);
  const [formats, setFormats] = useState<Formats>({ bold: false, italic: false, strike: false, code: false, link: null, block: "p" });
  const [bar, setBar] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const [face, setFace] = useState<"format" | "link">("format");
  const [linkDraft, setLinkDraft] = useState("");
  const [slash, setSlash] = useState<Slash | null>(null);
  const [slashActive, setSlashActive] = useState(0);
  const [announce, setAnnounce] = useState("");
  const faceRef = useRef(face);
  const slashRef = useRef(slash);
  const savedRange = useRef<Range | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const hinted = useRef<HTMLElement | null>(null);
  useEffect(() => { faceRef.current = face; }, [face]);
  useEffect(() => { slashRef.current = slash; }, [slash]);

  /* Output and history. */
  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const clone = cleanClone(editor);
    const html = clone.innerHTML;
    const text = plainOutput(clone);
    const isEmpty = !text && !clone.querySelector("hr");
    lastEmitted.current = html;
    setEmpty(isEmpty);
    callbacks.current.onChange?.({ html, markdown: htmlToMarkdown(clone), text, empty: isEmpty });
  }, []);

  const reportHistory = useCallback(() => {
    const { stack, index } = history.current;
    callbacks.current.onHistoryChange?.({ canUndo: index > 0, canRedo: index < stack.length - 1 });
  }, []);

  const record = useCallback((kind: Snapshot["kind"], boundary = false) => {
    const editor = editorRef.current;
    if (!editor) return;
    const snap: Snapshot = { html: editor.innerHTML.replace(/ data-hint=""/g, ""), selection: readOffsets(editor), kind, at: Date.now() };
    const state = history.current;
    const top = state.stack[state.index];
    if (top && top.html === snap.html) { top.selection = snap.selection; return; }
    if (kind === "type" && top?.kind === "type" && state.index > 0 && snap.at - top.at < 1000 && !boundary) {
      state.stack[state.index] = { ...snap, at: top.at };
    } else {
      state.stack = state.stack.slice(0, state.index + 1);
      state.stack.push(snap);
      if (state.stack.length > 300) state.stack.shift();
      state.index = state.stack.length - 1;
    }
    reportHistory();
  }, [reportHistory]);

  const restore = useCallback((snap: Snapshot) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = snap.html;
    hinted.current = null;
    editor.focus({ preventScroll: true });
    writeOffsets(editor, snap.selection);
    emit();
    reportHistory();
  }, [emit, reportHistory]);

  const undo = useCallback(() => {
    const state = history.current;
    if (state.index <= 0) return;
    state.index -= 1;
    setSlash(null);
    restore(state.stack[state.index]!);
    setAnnounce("Undone");
  }, [restore]);
  const redo = useCallback(() => {
    const state = history.current;
    if (state.index >= state.stack.length - 1) return;
    state.index += 1;
    setSlash(null);
    restore(state.stack[state.index]!);
    setAnnounce("Redone");
  }, [restore]);

  /* Selection driven chrome: block hint, active formats, the slash query, and the toolbar. */
  const sync = useCallback(() => {
    const editor = editorRef.current, root = rootRef.current;
    if (!editor || !root || busy.current) return;
    const selection = window.getSelection();
    const inside = !!selection?.rangeCount && editor.contains(selection.anchorNode);
    const range = inside ? selection!.getRangeAt(0) : null;

    const block = range ? blockAt(editor, range.startContainer) : null;
    const hint = range?.collapsed && block && !visibleText(block) && block.nodeName !== "PRE" ? block : null;
    if (hinted.current !== hint) {
      hinted.current?.removeAttribute("data-hint");
      hint?.setAttribute("data-hint", "");
      hinted.current = hint;
    }

    if (!range) {
      if (faceRef.current !== "link") setBar(null);
      setSlash(null);
      return;
    }

    const start = isElement(range.startContainer) ? range.startContainer : range.startContainer.parentElement;
    const within = (selector: string) => { const found = start?.closest(selector); return !!found && editor.contains(found); };
    const anchor = start?.closest("a");
    const listItem = block?.nodeName === "LI" ? block.parentElement?.nodeName.toLowerCase() ?? "ul" : null;
    const next: Formats = {
      bold: within("strong, b"), italic: within("em, i"), strike: within("s, strike, del"),
      code: within("code") && !within("pre"),
      link: anchor && editor.contains(anchor) ? anchor.getAttribute("href") : null,
      block: listItem ?? block?.nodeName.toLowerCase() ?? "p",
    };
    setFormats(current => (Object.keys(next) as (keyof Formats)[]).every(key => current[key] === next[key]) ? current : next);

    const open = slashRef.current;
    if (open) {
      const valid = range.collapsed && range.startContainer === open.node && range.startOffset > open.offset && open.node.data[open.offset] === "/";
      const query = valid ? open.node.data.slice(open.offset + 1, range.startOffset) : "";
      if (!valid || query.length > 24 || /^\s/.test(query) || /\s\s/.test(query)) setSlash(null);
      else if (query !== open.query) setSlash({ ...open, query });
    }

    const inCode = !!start?.closest("pre");
    if (range.collapsed || dragging.current || inCode || slashRef.current || readOnly) {
      if (faceRef.current !== "link") setBar(null);
      return;
    }
    const rects = range.getClientRects();
    const rect = rects.length ? rects[0]! : range.getBoundingClientRect();
    const whole = range.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const below = rect.top - clipBand(root).top < 60;
    setBar({ x: whole.left + whole.width / 2 - box.left, y: below ? whole.bottom - box.top + 8 : rect.top - box.top - 8, below });
  }, [readOnly]);

  const run = useCallback((change: () => void) => {
    const editor = editorRef.current;
    if (!editor) return;
    busy.current = true;
    try { change(); tidy(editor); } finally { busy.current = false; }
    record("command");
    emit();
    sync();
  }, [emit, record, sync]);

  /* Content in and out. */
  const load = useCallback((html: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = sanitizeHtml(html) || "<p><br></p>";
    editor.querySelectorAll("p, h1, h2, h3, li, blockquote, pre").forEach(block => ensureFilled(block as HTMLElement));
    hinted.current = null;
  }, []);

  const initial = useRef({ value, defaultValue, defaultMarkdown, autoFocus });
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const start = initial.current;
    load(start.value ?? start.defaultValue ?? (start.defaultMarkdown !== undefined ? markdownToHtml(start.defaultMarkdown) : "<p><br></p>"));
    history.current = { stack: [{ html: editor.innerHTML, selection: null, kind: "command", at: 0 }], index: 0 };
    emit();
    reportHistory();
    if (start.autoFocus) { editor.focus(); writeOffsets(editor, null); }
  }, [emit, load, reportHistory]);

  useEffect(() => {
    if (value === undefined || value === lastEmitted.current) return;
    load(value);
    record("command");
    emit();
  }, [emit, load, record, value]);

  /* Markdown shortcuts, applied right after the character that completes them. */
  const shortcut = useCallback((data: string | null) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !data || !selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;
    const block = blockAt(editor, range.startContainer);
    if (!block || block.nodeName === "PRE") return false;
    const before = textBefore(block, range);
    const plainBlock = block.nodeName === "P" || block.nodeName === "DIV";

    if (data === " " && plainBlock && block.parentElement === editor) {
      const rule: [RegExp, Exclude<BlockType, "hr">][] = [[/^# $/, "h1"], [/^## $/, "h2"], [/^### $/, "h3"], [/^[-*+] $/, "ul"], [/^\d+[.)] $/, "ol"], [/^> $/, "blockquote"]];
      const match = rule.find(([pattern]) => pattern.test(before));
      if (match) {
        const prefix = document.createRange();
        prefix.setStart(block, 0);
        prefix.setEnd(range.startContainer, range.startOffset);
        prefix.deleteContents();
        const next = convertBlock(block, match[1]);
        placeAtStart(next);
        return true;
      }
    }
    if (data === "-" && plainBlock && block.parentElement === editor && before === "---" && visibleText(block) === "---") {
      const rule = document.createElement("hr");
      replaceNode(block, rule);
      placeAtStart(paragraphAfter(rule));
      return true;
    }
    if (data === "`" && plainBlock && block.parentElement === editor && before === "```" && visibleText(block) === "```") {
      block.textContent = "";
      const next = convertBlock(block, "pre");
      placeAtStart(next);
      return true;
    }
    const node = range.startContainer;
    if (!isText(node) || node.parentElement?.closest("code")) return false;
    const text = node.data.slice(0, range.startOffset);
    const inline: [RegExp, string][] = [
      [/(\*\*|__)([^*_\s](?:[^*_]*[^*_\s])?)\1$/, "strong"],
      [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s"],
      [/`([^`]+)`$/, "code"],
      [/(?:^|[^*\w])(\*([^*\s](?:[^*]*[^*\s])?)\*)$/, "em"],
      [/(?:^|[^_\w])(_([^_\s](?:[^_]*[^_\s])?)_)$/, "em"],
    ];
    for (const [pattern, tag] of inline) {
      const match = pattern.exec(text);
      if (!match) continue;
      const whole = tag === "em" ? match[1]! : match[0];
      const inner = tag === "em" ? match[2]! : tag === "code" ? match[1]! : tag === "s" ? match[1]! : match[2]!;
      const from = range.startOffset - whole.length;
      node.splitText(range.startOffset);
      const middle = node.splitText(from);
      const element = document.createElement(tag);
      element.textContent = inner;
      replaceNode(middle, element);
      // A zero width space after the mark keeps the next keystroke outside it; output strips it.
      const exit = document.createTextNode("\u200b");
      insertAfter(element, exit);
      placeCaret(exit, 1);
      return true;
    }
    return false;
  }, []);

  const openSlashIfTyped = useCallback((data: string | null) => {
    const editor = editorRef.current, root = rootRef.current;
    const selection = window.getSelection();
    if (data !== "/" || !editor || !root || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (!range.collapsed || !isText(node) || node.parentElement?.closest("pre, code")) return;
    const offset = range.startOffset - 1;
    if (node.data[offset] !== "/" || (offset > 0 && !/[\s\u00a0\u200b]/.test(node.data[offset - 1]!))) return;
    const mark = document.createRange();
    mark.setStart(node, offset);
    mark.setEnd(node, offset + 1);
    const rect = mark.getBoundingClientRect(), box = root.getBoundingClientRect();
    const band = clipBand(root);
    const above = band.bottom - rect.bottom < 330 && rect.top - band.top > band.bottom - rect.bottom;
    const room = above ? rect.top - band.top - 12 : band.bottom - rect.bottom - 12;
    setSlash({ node, offset, query: "", x: Math.max(0, Math.min(rect.left - box.left - 8, box.width - 244)), y: above ? rect.top - box.top - 6 : rect.bottom - box.top + 6, above, max: Math.max(150, room) });
    setSlashActive(0);
    setBar(null);
  }, []);

  const slashResults = useMemo(() => {
    const query = slash?.query.trim().toLowerCase() ?? "";
    if (!query) return SLASH_ITEMS;
    return SLASH_ITEMS.filter(item => `${item.label} ${item.keywords}`.toLowerCase().split(/\s+/).some(word => word.startsWith(query)) || item.label.toLowerCase().includes(query));
  }, [slash?.query]);
  const slashIndex = Math.min(slashActive, Math.max(0, slashResults.length - 1));
  const slashOpen = !!slash && slashResults.length > 0;

  const applyBlock = useCallback((type: BlockType, target?: HTMLElement | null) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const offsets = readOffsets(editor);
    const block = target ?? blockAt(editor, range.startContainer);
    if (!block) return;
    if (type === "hr") {
      const top = block.nodeName === "LI" ? block.closest("ul, ol")! : block;
      const rule = document.createElement("hr");
      if (!visibleText(block) && block.nodeName !== "LI") replaceNode(block, rule); else insertAfter(top, rule);
      placeAtStart(paragraphAfter(rule));
      return;
    }
    // Several selected blocks turn together; if every one already has the type, they all turn back into paragraphs.
    const blocks = range.collapsed ? [block] : Array.from(editor.querySelectorAll<HTMLElement>("p, h1, h2, h3, li, blockquote, pre")).filter(candidate => range.intersectsNode(candidate) && !candidate.querySelector("p, li"));
    const current = (candidate: HTMLElement) => candidate.nodeName === "LI" ? candidate.parentElement!.nodeName.toLowerCase() : candidate.nodeName.toLowerCase();
    const allSame = blocks.every(candidate => current(candidate) === type);
    blocks.forEach(candidate => {
      if (allSame) convertBlock(candidate, type);
      else if (current(candidate) !== type) convertBlock(candidate, type);
    });
    writeOffsets(editor, offsets);
    if (type === "pre") {
      const pre = blockAt(editor, window.getSelection()?.anchorNode ?? null);
      if (pre && !pre.nextElementSibling) paragraphAfter(pre);
    }
  }, []);

  const chooseSlash = (item: SlashItem | undefined) => {
    const open = slashRef.current;
    const editor = editorRef.current;
    if (!item || !open || !editor) return;
    const selection = window.getSelection();
    const caret = selection?.rangeCount && selection.getRangeAt(0).startContainer === open.node ? selection.getRangeAt(0).startOffset : open.offset + 1 + open.query.length;
    setSlash(null);
    run(() => {
      open.node.deleteData(open.offset, Math.max(1, caret - open.offset));
      const block = blockAt(editor, open.node);
      placeCaret(open.node, open.offset);
      if (block) { ensureFilled(block); applyBlock(item.type, block); }
    });
    setAnnounce(`${item.label} added`);
  };

  /* Inline marks and links. */
  const toggleMark = (mark: "bold" | "italic" | "strike" | "code") => run(() => {
    const editor = editorRef.current!;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (mark !== "code") { document.execCommand("styleWithCSS", false, "false"); document.execCommand(mark === "strike" ? "strikeThrough" : mark); return; }
    const startElement = isElement(range.startContainer) ? range.startContainer : range.startContainer.parentElement;
    const code = startElement?.closest("code");
    if (code && editor.contains(code) && !code.closest("pre")) {
      const text = document.createTextNode(code.textContent ?? "");
      replaceNode(code, text);
      const next = document.createRange();
      next.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(next);
      return;
    }
    if (range.collapsed || blockAt(editor, range.startContainer) !== blockAt(editor, range.endContainer)) return;
    const element = document.createElement("code");
    element.textContent = range.toString();
    range.deleteContents();
    range.insertNode(element);
    const next = document.createRange();
    next.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(next);
  });

  const openLink = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    let range = selection.getRangeAt(0);
    const startElement = isElement(range.startContainer) ? range.startContainer : range.startContainer.parentElement;
    const existing = startElement?.closest("a");
    if (existing && editor.contains(existing)) {
      range = document.createRange();
      range.selectNodeContents(existing);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (range.collapsed) return;
    savedRange.current = range.cloneRange();
    setLinkDraft(existing?.getAttribute("href") ?? "");
    setFace("link");
    faceRef.current = "link";
    sync();
    requestAnimationFrame(() => linkInputRef.current?.focus({ preventScroll: true }));
  };

  const closeLink = (focusEditor = true) => {
    setFace("format");
    faceRef.current = "format";
    const editor = editorRef.current, range = savedRange.current;
    savedRange.current = null;
    if (focusEditor && editor && range) {
      editor.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    sync();
  };

  const applyLink = (remove = false) => {
    const range = savedRange.current;
    const editor = editorRef.current;
    const url = normalizeUrl(linkDraft);
    if (!range || !editor) { closeLink(); return; }
    editor.focus({ preventScroll: true });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    run(() => {
      const startElement = isElement(range.startContainer) ? range.startContainer : range.startContainer.parentElement;
      const existing = startElement?.closest("a");
      if (remove || !url) {
        if (existing && editor.contains(existing)) replaceNode(existing, ...Array.from(existing.childNodes));
        else document.execCommand("unlink");
        return;
      }
      if (existing && editor.contains(existing) && range.toString() === existing.textContent) { existing.setAttribute("href", url); return; }
      if (blockAt(editor, range.startContainer) !== blockAt(editor, range.endContainer)) { document.execCommand("createLink", false, url); return; }
      const contents = range.extractContents();
      contents.querySelectorAll("a").forEach(anchor => replaceNode(anchor, ...Array.from(anchor.childNodes)));
      const anchor = document.createElement("a");
      anchor.setAttribute("href", url);
      anchor.appendChild(contents);
      range.insertNode(anchor);
      const after = document.createRange();
      after.setStartAfter(anchor);
      after.collapse(true);
      selection.removeAllRanges();
      selection.addRange(after);
    });
    savedRange.current = null;
    setFace("format");
    faceRef.current = "format";
    setBar(null);
    setAnnounce(remove || !url ? "Link removed" : "Link added");
  };

  /* Keyboard. Enter, Backspace at a block edge, and history go through beforeinput so mobile keyboards behave the same. */
  const enterKey = useCallback((soft: boolean) => {
    const editor = editorRef.current!;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    let range = selection.getRangeAt(0);
    if (!range.collapsed) { range.deleteContents(); range = selection.getRangeAt(0); }
    const block = blockAt(editor, range.startContainer);
    if (!block) return;

    if (block.nodeName === "PRE") {
      const full = block.textContent ?? "";
      const caret = textBefore(block, range).length;
      const head = full.slice(0, caret), tail = full.slice(caret);
      if (!tail.replace(/\n$/, "") && head.endsWith("\n") && !soft) {
        block.textContent = head.slice(0, -1) || "";
        ensureFilled(block);
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createElement("br"));
        insertAfter(block, paragraph);
        placeAtStart(paragraph);
        return;
      }
      block.textContent = head + "\n" + (tail || "\n");
      placeCaret(block.firstChild!, caret + 1);
      return;
    }

    if (soft) {
      const br = document.createElement("br");
      range.insertNode(br);
      if (!br.nextSibling || (isText(br.nextSibling) && !br.nextSibling.data && !br.nextSibling.nextSibling)) insertAfter(br, document.createElement("br"));
      const after = document.createRange();
      after.setStartAfter(br);
      after.collapse(true);
      selection.removeAllRanges();
      selection.addRange(after);
      return;
    }

    if (block.nodeName === "LI" && !visibleText(block) && !block.querySelector("ul, ol")) { placeAtStart(outdent(block)); return; }
    if (block.nodeName === "BLOCKQUOTE" && !visibleText(block)) { placeAtStart(convertBlock(block, "p")); return; }

    const tail = document.createRange();
    tail.setStart(range.startContainer, range.startOffset);
    tail.setEnd(block, block.childNodes.length);
    const atEnd = !tail.toString().replace(ZWSP, "") && !tail.cloneContents().querySelector("ul, ol");
    const heading = /^H[1-3]$/.test(block.nodeName);
    const fragment = tail.extractContents();
    const next = document.createElement(heading && atEnd ? "p" : block.nodeName.toLowerCase());
    if (!(heading && atEnd)) next.appendChild(fragment);
    // Formatting open at the caret carries into the new line only when there is text to carry.
    if (heading && atEnd) next.appendChild(document.createElement("br"));
    insertAfter(block, next);
    block.querySelectorAll(":scope > br:last-child").forEach(br => { if (visibleText(block)) br.remove(); });
    ensureFilled(block);
    ensureFilled(next);
    if (!visibleText(next)) next.querySelectorAll("strong, em, s, code, a").forEach(element => { if (!visibleText(element)) element.remove(); });
    ensureFilled(next);
    placeAtStart(next);
  }, []);

  const backspaceAtStart = useCallback(() => {
    const editor = editorRef.current!;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    const block = blockAt(editor, range.startContainer);
    if (!block || !atBlockStart(block, range)) return false;
    if (/^(H[1-3]|BLOCKQUOTE|PRE)$/.test(block.nodeName)) { placeAtStart(convertBlock(block, "p")); return true; }
    if (block.nodeName === "LI") { placeAtStart(outdent(block)); return true; }
    const previous = block.previousElementSibling;
    if (previous?.nodeName === "HR") { previous.remove(); return true; }
    if (!previous && !visibleText(block) && block.nextElementSibling) { const next = block.nextElementSibling as HTMLElement; block.remove(); placeAtStart(next); return true; }
    return false;
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onBeforeInput = (event: InputEvent) => {
      if (readOnly) return;
      switch (event.inputType) {
        case "historyUndo": event.preventDefault(); undo(); return;
        case "historyRedo": event.preventDefault(); redo(); return;
        case "insertParagraph":
        case "insertLineBreak":
          event.preventDefault();
          if (slashRef.current) return;
          run(() => enterKey(event.inputType === "insertLineBreak"));
          return;
        case "deleteContentBackward": {
          const selection = window.getSelection();
          if (!selection?.rangeCount || !selection.getRangeAt(0).collapsed) return;
          busy.current = true;
          let handled = false;
          try { handled = backspaceAtStart(); } finally { busy.current = false; }
          if (handled) { event.preventDefault(); tidy(editor); record("command"); emit(); sync(); }
          return;
        }
        case "insertText": {
          // Typing into an emptied editor lands in a paragraph, never loose at the root.
          const selection = window.getSelection();
          if (!selection?.rangeCount || blockAt(editor, selection.anchorNode) || editor.querySelector("p, h1, h2, h3, li, pre, blockquote")) return;
          event.preventDefault();
          const paragraph = document.createElement("p");
          const text = document.createTextNode(event.data ?? "");
          paragraph.appendChild(text);
          editor.replaceChildren(paragraph);
          placeCaret(text, text.length);
          record("type");
          emit();
          sync();
          return;
        }
        case "insertFromDrop": event.preventDefault(); return;
        case "formatUnderline": event.preventDefault(); return;
      }
    };
    editor.addEventListener("beforeinput", onBeforeInput);
    return () => editor.removeEventListener("beforeinput", onBeforeInput);
  }, [backspaceAtStart, emit, enterKey, readOnly, record, redo, run, sync, undo]);

  const onInput = (event: FormEvent<HTMLDivElement>) => {
    if (busy.current) return;
    const editor = editorRef.current!;
    const native = event.nativeEvent as InputEvent;
    if (native.isComposing) return;
    busy.current = true;
    let converted = false;
    try {
      tidy(editor);
      if (native.inputType === "insertText") converted = shortcut(native.data);
    } finally { busy.current = false; }
    if (converted) {
      tidy(editor);
      record("command");
      setAnnounce("Formatted");
    } else record("type", native.data === " " || native.inputType !== lastInput.current);
    lastInput.current = native.inputType;
    emit();
    if (!converted && native.inputType === "insertText") openSlashIfTyped(native.data);
    sync();
  };

  const focusToolbar = () => rootRef.current?.querySelector<HTMLElement>(`[data-toolbar="${uid}"] button`)?.focus();

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (slashOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSlashActive((slashIndex + (event.key === "ArrowDown" ? 1 : -1) + slashResults.length) % slashResults.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); chooseSlash(slashResults[slashIndex]); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSlash(null); return; }
    }
    if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && key === "y") { event.preventDefault(); redo(); return; }
    if (mod && !event.shiftKey && key === "b") { event.preventDefault(); toggleMark("bold"); return; }
    if (mod && !event.shiftKey && key === "i") { event.preventDefault(); toggleMark("italic"); return; }
    if (mod && event.shiftKey && key === "x") { event.preventDefault(); toggleMark("strike"); return; }
    if (mod && key === "e") { event.preventDefault(); toggleMark("code"); return; }
    if (mod && key === "k") { event.preventDefault(); openLink(); return; }
    if (mod && key === "u") { event.preventDefault(); return; }
    if (event.altKey && event.key === "F10" && bar) { event.preventDefault(); focusToolbar(); return; }
    if (event.key === "Tab") {
      const editor = editorRef.current!;
      const selection = window.getSelection();
      const block = selection?.rangeCount ? blockAt(editor, selection.anchorNode) : null;
      if (block?.nodeName === "LI") {
        event.preventDefault();
        run(() => {
          const offsets = readOffsets(editor);
          if (event.shiftKey) outdent(block); else indent(block);
          writeOffsets(editor, offsets);
        });
      } else if (block?.nodeName === "PRE" && !event.shiftKey) {
        event.preventDefault();
        run(() => {
          const range = selection!.getRangeAt(0);
          range.deleteContents();
          const spaces = document.createTextNode("  ");
          range.insertNode(spaces);
          placeCaret(spaces, 2);
          block.normalize();
        });
      }
    }
  };

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    event.preventDefault();
    const editor = editorRef.current!;
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    run(() => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const block = blockAt(editor, range.startContainer);
      const markdownish = /(^|\n)\s*(#{1,3}\s|[-*+]\s|\d+[.)]\s|>|```)|\*\*|`[^`]+`|\[[^\]]+\]\(/.test(text);
      const source = html ? sanitizeHtml(html) : markdownish || text.includes("\n\n") ? markdownToHtml(text) : "";
      const fragment = source ? parseHtml(source) : null;
      const single = fragment && fragment.children.length === 1 && fragment.firstElementChild!.nodeName === "P";
      // Plain text, code blocks, and list items take the text as it is; everything else keeps its structure.
      if (!fragment || !block || block.nodeName === "PRE" || (block.nodeName === "LI" && !single)) {
        const plain = block?.nodeName === "PRE" ? text : text.replace(/\s*\n\s*/g, " ");
        const node = document.createTextNode(plain);
        range.insertNode(node);
        placeCaret(node, node.length);
        return;
      }
      if (single) {
        const nodes = Array.from(fragment.firstElementChild!.childNodes);
        const last = nodes[nodes.length - 1];
        const holder = document.createDocumentFragment();
        nodes.forEach(node => holder.appendChild(node));
        range.insertNode(holder);
        if (last) { const after = document.createRange(); after.setStartAfter(last); after.collapse(true); selection.removeAllRanges(); selection.addRange(after); }
        return;
      }
      const tail = document.createRange();
      tail.setStart(range.startContainer, range.startOffset);
      tail.setEnd(block, block.childNodes.length);
      const rest = document.createElement(block.nodeName === "LI" ? "p" : block.nodeName.toLowerCase());
      rest.appendChild(tail.extractContents());
      const top = block.nodeName === "LI" ? block.closest("ul, ol")! : block;
      const blocks = Array.from(fragment.childNodes);
      let anchor: Element = top;
      blocks.forEach(node => { insertAfter(anchor, node); if (isElement(node)) anchor = node; });
      if (visibleText(rest) || rest.querySelector("br")) { insertAfter(anchor, rest); ensureFilled(rest); }
      if (!visibleText(block) && block.nodeName === "P") block.remove();
      const end = document.createRange();
      end.selectNodeContents(anchor);
      end.collapse(false);
      selection.removeAllRanges();
      selection.addRange(end);
    });
  };

  /* Selection events. */
  useEffect(() => {
    let frame = 0;
    const onChange = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(sync); };
    const onUp = () => { if (!dragging.current) return; dragging.current = false; onChange(); };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("pointerup", onUp);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("selectionchange", onChange); document.removeEventListener("pointerup", onUp); };
  }, [sync]);

  useEffect(() => {
    if (face !== "link") return;
    const down = (event: PointerEvent) => { if (!rootRef.current?.querySelector(`[data-toolbar="${uid}"]`)?.contains(event.target as Node)) { savedRange.current = null; setFace("format"); faceRef.current = "format"; setBar(null); } };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [face, uid]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    getHTML: () => editorRef.current ? cleanClone(editorRef.current).innerHTML : "",
    getMarkdown: () => editorRef.current ? htmlToMarkdown(cleanClone(editorRef.current)) : "",
    getText: () => editorRef.current ? plainOutput(cleanClone(editorRef.current)) : "",
    setHTML: html => { load(html); record("command"); emit(); },
    setMarkdown: markdown => { load(markdownToHtml(markdown)); record("command"); emit(); },
    clear: () => { load("<p><br></p>"); record("command"); emit(); },
    undo,
    redo,
    get element() { return editorRef.current; },
  }), [emit, load, record, redo, undo]);

  /* Toolbar geometry: one surface whose size springs between faces and whose position glides with the selection. */
  const tx = useMotionValue(0), ty = useMotionValue(0), tw = useMotionValue(0), th = useMotionValue(0);
  const shown = useRef(false);
  /* Until a face has reported its size the surface has nothing to show, so it stays hidden rather than flashing a 1px dot. */
  const toolbarVisibility = useTransform(tw, width => width > 0 ? "visible" : "hidden");
  const targetSize = useRef({ width: 0, height: 0 });
  const onFaceSize = useCallback((width: number, height: number) => {
    targetSize.current = { width, height };
    if (!shown.current || reduced || tw.get() === 0) { tw.jump(width); th.jump(height); return; }
    animate(tw, width, MORPH);
    animate(th, height, MORPH);
  }, [reduced, th, tw]);
  const toolbarOpen = !!bar && !readOnly;
  // A fresh toolbar is placed, not glided, and stays "fresh" until it has painted once, so a selection that settles in the same
  // frame cannot send it sliding in from its last spot or from the root's corner. Motion resets a remounted element's bound
  // values to what they held at render (Strict Mode does this on every open in development), so the placement is applied
  // again once mounting is done. Its size is left alone on close so the exit keeps its shape instead of collapsing.
  const placedFrame = useRef(0);
  const placement = useRef<{ x: number; y: number } | null>(null);
  const place = useCallback(() => {
    const at = placement.current;
    if (!at) return;
    const { width, height } = targetSize.current;
    if (tx.get() !== at.x) tx.jump(at.x);
    if (ty.get() !== at.y) ty.jump(at.y);
    if (width && tw.get() !== width) { tw.jump(width); th.jump(height); }
  }, [th, tw, tx, ty]);
  useLayoutEffect(() => {
    if (!bar) { shown.current = false; placement.current = null; cancelAnimationFrame(placedFrame.current); return; }
    const root = rootRef.current;
    const half = (targetSize.current.width || 280) / 2;
    const x = root ? Math.max(half + 4, Math.min(bar.x, root.offsetWidth - half - 4)) : bar.x;
    if (!shown.current || reduced) {
      placement.current = { x, y: bar.y };
      place();
      cancelAnimationFrame(placedFrame.current);
      placedFrame.current = requestAnimationFrame(() => { place(); shown.current = true; placement.current = null; });
      return;
    }
    animate(tx, x, GLIDE);
    animate(ty, bar.y, GLIDE);
  }, [bar, place, reduced, tx, ty]);
  useEffect(() => { if (bar) place(); }, [bar, place]);
  useEffect(() => () => cancelAnimationFrame(placedFrame.current), []);
  const direction = face === "link" ? 1 : -1;

  /* Slash menu geometry: the highlight glides between rows and the panel springs to its rows. */
  const listRef = useRef<HTMLUListElement>(null);
  const hy = useMotionValue(0), hh = useMotionValue(0), panelHeight = useMotionValue<number | "auto">("auto");
  const panelBody = useRef<HTMLDivElement>(null);
  const slashPanel = useRef<HTMLDivElement>(null);
  const slashMax = slash?.max ?? 320;
  const panelSized = useRef(false);
  const highlightPlaced = useRef(false);
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${slashIndex}"]`);
    if (!row) return;
    if (reduced || !highlightPlaced.current || hh.get() === 0) { hy.jump(row.offsetTop); hh.jump(row.offsetHeight); highlightPlaced.current = true; return; }
    animate(hy, row.offsetTop, GLIDE);
    animate(hh, row.offsetHeight, GLIDE);
    // A short panel scrolls to keep the active row in view.
    const panel = slashPanel.current;
    if (panel) {
      const top = row.offsetTop + 6, bottom = top + row.offsetHeight;
      if (top - 6 < panel.scrollTop) panel.scrollTop = top - 6;
      else if (bottom + 6 > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom + 6 - panel.clientHeight;
    }
  }, [hh, hy, reduced, slashIndex, slashResults, slashOpen]);
  useLayoutEffect(() => {
    // The highlight keeps its row while the menu fades out; the next open places it fresh.
    if (!slashOpen) { panelSized.current = false; highlightPlaced.current = false; return; }
    const body = panelBody.current;
    if (!body) return;
    const fit = () => {
      const target = Math.min(body.offsetHeight, slashMax);
      if (!panelSized.current || reduced) { panelHeight.jump(target); panelSized.current = true; return; }
      animate(panelHeight, target, GROW);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(body);
    return () => observer.disconnect();
  }, [hh, panelHeight, reduced, slashMax, slashOpen]);

  const onToolbarKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (face !== "format") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      buttons[(at + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editorRef.current?.focus();
      sync();
    }
  };

  const optionId = (index: number) => `${uid}-slash-${index}`;
  const cssVars = { "--placeholder": JSON.stringify(placeholder), "--hint": JSON.stringify(blockHint) } as CSSProperties;

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} style={style}>
    <div
      ref={editorRef}
      className={styles.editor}
      style={cssVars}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      aria-readonly={readOnly || undefined}
      aria-controls={slashOpen ? `${uid}-slash` : undefined}
      aria-activedescendant={slashOpen ? optionId(slashIndex) : undefined}
      data-empty={empty || undefined}
      spellCheck
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDrop={event => event.preventDefault()}
      onPointerDown={() => { dragging.current = true; }}
      onCompositionEnd={() => { record("type", true); emit(); }}
    />
    <span className={styles.srOnly} aria-live="polite">{announce}</span>

    <AnimatePresence>
      {toolbarOpen && <motion.div
        key="toolbar"
        data-toolbar={uid}
        role="toolbar"
        aria-label="Formatting"
        className={styles.toolbar}
        data-below={bar.below || undefined}
        style={{ left: tx, top: ty, width: tw, height: th, visibility: toolbarVisibility, transformOrigin: bar.below ? "50% 0" : "50% 100%" }}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .94, y: bar.below ? -4 : 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .96, transition: { duration: duration.exit * .8, ease: standard } }}
        transition={reduced ? { duration: duration.fast } : { ...spring.snappy, opacity: { duration: duration.fast, ease: enter } }}
        onKeyDown={onToolbarKey}
      >
        <AnimatePresence initial={false} custom={direction}>
          {face === "format" ? <Face key="format" direction={direction} reduced={reduced} onSize={onFaceSize}>
            <div className={styles.row}>
              <ToolButton label="Bold" pressed={formats.bold} shortcut="⌘B" onPress={() => toggleMark("bold")}><Bold {...icon} /></ToolButton>
              <ToolButton label="Italic" pressed={formats.italic} shortcut="⌘I" onPress={() => toggleMark("italic")}><Italic {...icon} /></ToolButton>
              <ToolButton label="Strikethrough" pressed={formats.strike} shortcut="⌘⇧X" onPress={() => toggleMark("strike")}><Strikethrough {...icon} /></ToolButton>
              <ToolButton label="Inline code" pressed={formats.code} shortcut="⌘E" onPress={() => toggleMark("code")}><Code {...icon} /></ToolButton>
              <ToolButton label={formats.link ? "Edit link" : "Link"} pressed={!!formats.link} shortcut="⌘K" onPress={openLink}><Link {...icon} /></ToolButton>
              <span className={styles.blockTools}>
              <span className={styles.divider} aria-hidden="true" />
              <ToolButton label="Heading 1" pressed={formats.block === "h1"} onPress={() => run(() => applyBlock("h1"))}><Heading1 {...icon} /></ToolButton>
              <ToolButton label="Heading 2" pressed={formats.block === "h2"} onPress={() => run(() => applyBlock("h2"))}><Heading2 {...icon} /></ToolButton>
              <ToolButton label="Quote" pressed={formats.block === "blockquote"} onPress={() => run(() => applyBlock("blockquote"))}><Quote {...icon} /></ToolButton>
              </span>
            </div>
          </Face> : <Face key="link" direction={direction} reduced={reduced} onSize={onFaceSize}>
            <form className={styles.linkRow} onSubmit={event => { event.preventDefault(); applyLink(); }}>
              <button type="button" className={styles.tool} aria-label="Back to formatting" onClick={() => closeLink()}><ArrowLeft {...icon} /></button>
              <input
                ref={linkInputRef}
                className={styles.linkInput}
                value={linkDraft}
                onChange={event => setLinkDraft(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeLink(); } }}
                placeholder="Paste or type a link"
                aria-label="Link address"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
              />
              {formats.link && <button type="button" className={styles.tool} aria-label="Remove link" onClick={() => applyLink(true)}><Unlink {...icon} /></button>}
              <button type="submit" className={styles.apply} aria-label="Apply link" data-ready={!!linkDraft.trim() || undefined}><Check size={16} strokeWidth={2} aria-hidden="true" /></button>
            </form>
          </Face>}
        </AnimatePresence>
      </motion.div>}
    </AnimatePresence>

    <AnimatePresence>
      {slashOpen && slash && <motion.div
        key={`${slash.offset}-${slash.y}`}
        ref={slashPanel}
        className={styles.slash}
        data-above={slash.above || undefined}
        style={{ left: slash.x, top: slash.y, height: panelHeight, maxHeight: slashMax, transformOrigin: slash.above ? "16px 100%" : "16px 0" }}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .96, y: slash.above ? 4 : -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .97, transition: { duration: duration.exit * .8, ease: standard } }}
        transition={reduced ? { duration: duration.fast } : { ...spring.snappy, opacity: { duration: duration.fast, ease: enter } }}
        onMouseDown={event => event.preventDefault()}
      >
        <div ref={panelBody} className={styles.slashBody}>
          <ul ref={listRef} id={`${uid}-slash`} role="listbox" aria-label="Blocks" className={styles.slashList}>
            <motion.li aria-hidden="true" className={styles.slashHighlight} style={{ y: hy, height: hh }} />
            {slashResults.map((item, index) => <li key={item.type} id={optionId(index)} role="option" aria-selected={index === slashIndex} data-index={index} className={styles.slashOption}
              onPointerMove={() => { if (index !== slashIndex) setSlashActive(index); }} onClick={() => chooseSlash(item)}>
              <span className={styles.slashIcon}>{item.icon}</span>
              <span className={styles.slashLabel}>{item.label}</span>
              {item.hint && <kbd className={styles.slashHint}>{item.hint}</kbd>}
            </li>)}
          </ul>
        </div>
      </motion.div>}
    </AnimatePresence>
  </div>;
});

export default RichTextEditor;
