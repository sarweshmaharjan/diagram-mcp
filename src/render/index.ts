import dagre from "@dagrejs/dagre";
import { Resvg } from "@resvg/resvg-js";
import { iconDataUri, resolveIcon } from "../icons/index.js";
import type { Spec } from "../core/model.js";

const FONT = "Helvetica, Arial, sans-serif";
const INK = "#232F3E";
const ICON = 60;
const GROUP_PAD = 14;
const GROUP_TOP = 30;
const TITLE_H = 44;
const MARGIN = 30;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function darken(hex: string, k = 0.28): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) =>
    Math.round(v * (1 - k))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const groupColor = (label: string, explicit?: string) =>
  explicit ??
  (/aws|lambda/i.test(label)
    ? "#ED7100"
    : /gcp|google/i.test(label)
      ? "#4285F4"
      : /azure/i.test(label)
        ? "#0078D4"
        : /vpc|network/i.test(label)
          ? "#8C4FFF"
          : /subnet|private/i.test(label)
            ? "#3F8624"
            : "#7D8B99");

const SHAPE_STYLE = {
  box: { fill: "#EAF2FB", stroke: "#6F9BC9" },
  pill: { fill: "#E3F4E8", stroke: "#5FAE78" },
  diamond: { fill: "#FFF4D6", stroke: "#D9A927" },
};

function wrap(label: string, max = 18): string[] {
  const out: string[] = [];
  for (const para of label.split(/\\n|\n/)) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      if (line && (line + " " + w).length > max) {
        out.push(line);
        line = w;
      } else line = line ? line + " " + w : w;
    }
    out.push(line);
  }
  return out;
}
const textW = (lines: string[], px = 13) => Math.max(...lines.map((l) => l.length)) * px * 0.56;

/** "2. query verdict" -> step badge "2" + text. Numbered steps also drive layout order. */
const STEP_RE = /^\s*(\d{1,2}|[A-Za-z])[.)]\s*(.*)$/;
export function parseStep(label?: string): { step?: string; text: string } {
  const m = label ? STEP_RE.exec(label) : null;
  return m ? { step: m[1], text: m[2] } : { text: label ?? "" };
}
const BADGE_R = 9;
const labelWidth = (label: string) => {
  const { step, text } = parseStep(label);
  return (text ? textW([text], 11.5) + 14 : 0) + (step ? BADGE_R * 2 + (text ? 2 : 4) : 0);
};

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

function build(spec: Spec, dir: "LR" | "TB"): { svg: string; W: number; H: number } {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  g.setGraph({ rankdir: dir, nodesep: 84, ranksep: 76, marginx: 0, marginy: 0, edgesep: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const realSize = new Map<string, { w: number; h: number }>();
  const lines = new Map<string, string[]>();
  const details = new Map<string, string[]>();
  for (const n of spec.nodes) {
    const ls = wrap(n.label ?? n.id);
    const ds = n.detail ? wrap(n.detail, 26).slice(0, 2) : [];
    lines.set(n.id, ls);
    details.set(n.id, ds);
    const tw = Math.max(textW(ls, 14), ds.length ? textW(ds, 11.5) : 0);
    const textH = ls.length * 17 + ds.length * 14 + (ds.length ? 2 : 0);
    let w: number, h: number;
    if (n.icon) {
      w = Math.max(ICON + 24, tw + 12);
      h = ICON + 10 + textH;
    } else if (n.shape === "diamond") {
      w = tw + 80;
      h = 64 + textH;
    } else {
      w = Math.max(120, tw + 40);
      h = textH + 26;
    }
    // reserve room inside a group box (dagre keeps sibling clusters apart, but knows nothing about our borders/labels)
    const inGroup = spec.groups.some((grp) => grp.children.includes(n.id));
    if (inGroup) realSize.set(n.id, { w, h });
    g.setNode(n.id, { width: w + (inGroup ? 2 * GROUP_PAD : 0), height: h + (inGroup ? GROUP_TOP + GROUP_PAD : 0) });
  }
  for (const grp of spec.groups) g.setNode(grp.id, {});
  for (const grp of spec.groups) for (const c of grp.children) g.setParent(c, grp.id);
  // several numbered calls out of one node (1,2,3...) -> place targets in step order, one rank apart
  const stepRank = new Map<number, number>();
  const byFrom = new Map<string, { i: number; n: number }[]>();
  spec.edges.forEach((e, i) => {
    const st = parseStep(e.label).step;
    if (st && /^\d+$/.test(st)) byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), { i, n: Number(st) }]);
  });
  for (const list of byFrom.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.n - b.n).forEach((x, k) => stepRank.set(x.i, k + 1));
  }
  spec.edges.forEach((e, i) => {
    const opts: Record<string, unknown> = {};
    if (e.label) Object.assign(opts, { label: e.label, width: labelWidth(e.label), height: 20, labelpos: "c" });
    if (stepRank.has(i)) opts.minlen = stepRank.get(i);
    g.setEdge(e.from, e.to, opts, String(i));
  });

  dagre.layout(g);

  // group boxes: dagre cluster box, inflated to make room for border + label
  const pos = (id: string): Placed => {
    const n = g.node(id);
    const real = realSize.get(id);
    // padded nodes: keep dagre's center, shift down so the extra top room is label space
    return real
      ? { x: n.x, y: n.y + (GROUP_TOP - GROUP_PAD) / 2, w: real.w, h: real.h }
      : { x: n.x, y: n.y, w: n.width, h: n.height };
  };
  const depth = (id: string): number => {
    let d = 0;
    for (let p = g.parent(id); p; p = g.parent(p)) d++;
    return d;
  };
  const groupsOuterFirst = [...spec.groups].sort((a, b) => depth(a.id) - depth(b.id));
  // inner groups need slightly smaller inflation so nested boxes stay visually nested
  const maxDepth = Math.max(0, ...spec.groups.map((x) => depth(x.id)));
  const inflate = (id: string) => {
    const k = maxDepth - depth(id); // 0 for deepest
    return { side: 2 + k * 10, top: 2 + k * 10 };
  };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (x1: number, y1: number, x2: number, y2: number) => {
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  };
  const groupBoxes = groupsOuterFirst.map((grp) => {
    const p = pos(grp.id);
    const f = inflate(grp.id);
    const box = { x: p.x - p.w / 2 - f.side, y: p.y - p.h / 2 - f.top, w: p.w + 2 * f.side, h: p.h + f.top + f.side };
    grow(box.x, box.y, box.x + box.w, box.y + box.h);
    return { grp, box };
  });
  for (const n of spec.nodes) {
    const p = pos(n.id);
    grow(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2);
  }
  const edgeData = spec.edges.map((e, i) => g.edge({ v: e.from, w: e.to, name: String(i) }));
  for (const ed of edgeData) for (const pt of ed.points ?? []) grow(pt.x, pt.y, pt.x, pt.y);

  const titleH = spec.title ? TITLE_H : 0;
  const ox = MARGIN - minX;
  const oy = MARGIN + titleH - minY;
  const W = Math.ceil(maxX - minX + 2 * MARGIN);
  const H = Math.ceil(maxY - minY + 2 * MARGIN + titleH);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.max(W, 200)}" height="${H}" viewBox="0 0 ${Math.max(W, 200)} ${H}" font-family="${FONT}">`,
  );
  out.push(
    `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#6B7C8F"/></marker><marker id="arr-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="#6B7C8F"/></marker></defs>`,
  );
  out.push(`<rect width="100%" height="100%" fill="#FFFFFF"/>`);
  out.push(
    `<filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#1B2B3C" flood-opacity="0.14"/></filter>`,
  );
  if (spec.title)
    out.push(
      `<text x="${MARGIN}" y="${MARGIN + 14}" font-size="20" font-weight="bold" fill="${INK}">${esc(spec.title)}</text>`,
    );

  for (const { grp, box } of groupsOuterFirst.length ? groupBoxes : []) {
    const color = groupColor(grp.label ?? grp.id, grp.color);
    out.push(
      `<rect x="${box.x + ox}" y="${box.y + oy}" width="${box.w}" height="${box.h}" rx="12" fill="${color}" fill-opacity="0.05" stroke="${color}" stroke-width="1.5" stroke-dasharray="7 4"/>`,
    );
    out.push(
      `<text x="${box.x + ox + 14}" y="${box.y + oy + 21}" font-size="13.5" font-weight="bold" fill="${darken(color, 0.15)}">${esc(grp.label ?? grp.id)}</text>`,
    );
  }

  const edgeLabels: string[] = []; // drawn after nodes so a label is never hidden behind one
  spec.edges.forEach((e, i) => {
    const ed = edgeData[i];
    const pts = (ed.points ?? []).map((p: { x: number; y: number }) => ({ x: p.x + ox, y: p.y + oy }));
    if (pts.length < 2) return;
    if (dir === "LR") {
      // dagre ends edges on the node box (icon + caption); in LR pull side endpoints up to the icon itself
      const clamp = (pt: { x: number; y: number }, id: string) => {
        const nd = spec.nodes.find((x) => x.id === id);
        if (!nd?.icon) return;
        const q = pos(id);
        const topY = q.y - q.h / 2 + oy;
        pt.y = Math.min(Math.max(pt.y, topY + 10), topY + ICON - 10);
      };
      clamp(pts[0], e.from);
      clamp(pts[pts.length - 1], e.to);
    }
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k].x + pts[k + 1].x) / 2,
        my = (pts[k].y + pts[k + 1].y) / 2;
      d += ` Q${pts[k].x},${pts[k].y} ${k === pts.length - 2 ? pts[k + 1].x : mx},${k === pts.length - 2 ? pts[k + 1].y : my}`;
    }
    if (pts.length === 2) d += ` L${pts[1].x},${pts[1].y}`;
    const dash = e.style === "dashed" ? ` stroke-dasharray="6 4"` : "";
    out.push(
      `<path d="${d}" fill="none" stroke="#6B7C8F" stroke-width="1.8"${dash} marker-end="url(#arr)"${e.bidirectional ? ` marker-start="url(#arr-start)"` : ""}/>`,
    );
    if (e.label && ed.x !== undefined) {
      const { step, text } = parseStep(e.label);
      const lw = labelWidth(e.label);
      const x0 = ed.x + ox - lw / 2,
        y = ed.y + oy;
      let t = `<rect x="${x0}" y="${y - 10}" width="${lw}" height="20" rx="10" fill="#FFFFFF" stroke="#CBD3DB"/>`;
      if (step)
        t += `<circle cx="${x0 + BADGE_R + 1}" cy="${y}" r="${BADGE_R}" fill="${INK}"/><text x="${x0 + BADGE_R + 1}" y="${y + 3.7}" font-size="10.5" font-weight="bold" text-anchor="middle" fill="#FFFFFF">${esc(step)}</text>`;
      if (text)
        t += `<text x="${x0 + (step ? BADGE_R * 2 + 2 : 0) + (lw - (step ? BADGE_R * 2 + 2 : 0)) / 2}" y="${y + 4}" font-size="11.5" text-anchor="middle" fill="#3C4B5B">${esc(text)}</text>`;
      edgeLabels.push(t);
    }
  });

  for (const n of spec.nodes) {
    const p = pos(n.id);
    const cx = p.x + ox,
      top = p.y - p.h / 2 + oy,
      left = p.x - p.w / 2 + ox;
    const ls = lines.get(n.id)!;
    const ds = details.get(n.id)!;
    const tspans = (arr: string[], startY: number, lh: number) =>
      arr.map((l, k) => `<tspan x="${cx}" y="${startY + k * lh}">${esc(l)}</tspan>`).join("");
    const textBlock = (y0: number) => {
      let t = `<text font-size="14" font-weight="600" text-anchor="middle" fill="${INK}">${tspans(ls, y0, 17)}</text>`;
      if (ds.length)
        t += `<text font-size="11.5" text-anchor="middle" fill="#6B7A8A">${tspans(ds, y0 + ls.length * 17 + 1, 14)}</text>`;
      return t;
    };
    if (n.icon) {
      const ic = resolveIcon(n.icon)!;
      out.push(
        `<image x="${cx - ICON / 2}" y="${top}" width="${ICON}" height="${ICON}" xlink:href="${iconDataUri(ic)}"/>`,
      );
      out.push(textBlock(top + ICON + 22));
    } else {
      const st = SHAPE_STYLE[n.shape ?? "box"];
      const fill = n.color ?? st.fill;
      const stroke = n.color ? darken(n.color) : st.stroke;
      if (n.shape === "diamond") {
        out.push(
          `<polygon points="${cx},${top} ${left + p.w},${p.y + oy} ${cx},${top + p.h} ${left},${p.y + oy}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" filter="url(#sh)"/>`,
        );
      } else {
        const rx = n.shape === "pill" ? p.h / 2 : 10;
        out.push(
          `<rect x="${left}" y="${top}" width="${p.w}" height="${p.h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" filter="url(#sh)"/>`,
        );
      }
      const textH = ls.length * 17 + ds.length * 14 + (ds.length ? 2 : 0);
      out.push(textBlock(p.y + oy - textH / 2 + 13));
    }
  }
  out.push(...edgeLabels);
  out.push("</svg>");
  return { svg: out.join("\n"), W, H };
}

/** Explicit direction wins; otherwise lay out both ways and keep the one closest to a 3:2 canvas. */
export function renderSvg(spec: Spec): string {
  if (spec.direction) return build(spec, spec.direction).svg;
  const score = (r: { W: number; H: number }) => Math.abs(Math.log(r.W / r.H / 1.5));
  const lr = build(spec, "LR"),
    tb = build(spec, "TB");
  return (score(tb) < score(lr) ? tb : lr).svg;
}

export function renderPng(spec: Spec): Buffer {
  const svg = renderSvg(spec);
  const r = new Resvg(svg, {
    fitTo: { mode: "zoom", value: 2 },
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
  });
  return Buffer.from(r.render().asPng());
}

/** Canvas size each direction would produce (used by the reviewer to catch ribbons and towers). */
export function layoutSizes(spec: Spec): { LR: { W: number; H: number }; TB: { W: number; H: number } } {
  const lr = build(spec, "LR"),
    tb = build(spec, "TB");
  return { LR: { W: lr.W, H: lr.H }, TB: { W: tb.W, H: tb.H } };
}
