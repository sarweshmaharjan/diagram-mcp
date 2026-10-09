import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ICON_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "icons");

export interface IconEntry {
  provider: string; // aws | gcp | azure | generic | onprem | saas | k8s | general (Lucide glyphs on a colored tile)
  category: string; // compute, database, ...
  name: string; // lambda, s3, ...
  file: string;
  key: string; // provider:category/name
  tags?: string[]; // search keywords (general icons)
}

// ---- "general" icons: Lucide (ISC) glyphs drawn white on a colored rounded tile, to sit beside cloud icons ----
const TILE_COLORS: [RegExp, [string, string]][] = [
  [/(^|-)lock|shield|key|fingerprint|scan-face|bug|siren|ban|alert|triangle-alert|octagon/, ["#E5484D", "#B5262B"]],
  [
    /database|hard-drive|server|archive|container|layers|boxes|package|warehouse|folder|file|save|cylinder/,
    ["#3E63DD", "#2A44A8"],
  ],
  [/mail|message|bell|send|inbox|phone|megaphone|rss|radio|webhook|share|podcast|chat/, ["#D6409F", "#A32A78"]],
  [
    /bot|brain|sparkle|wand|cpu|atom|microchip|lightbulb|workflow|git|code|terminal|braces|binary|function/,
    ["#12A594", "#0B7568"],
  ],
  [/globe|cloud|wifi|network|router|link|route|cable|signal|satellite|earth|waypoints|plug/, ["#8E4EC6", "#6531A0"]],
  [/user|users|person|contact|baby|accessibility|smile|circle-user|id-card|handshake/, ["#5B6B7B", "#3F4C59"]],
  [
    /chart|gauge|trending|activity|bar|pie|line-chart|table|calculator|percent|dashboard|monitor/,
    ["#F08A24", "#C26410"],
  ],
  [/credit|wallet|banknote|dollar|receipt|coins|piggy|shopping|store|tag|badge/, ["#30A46C", "#1F7A4D"]],
  [/clock|timer|calendar|hourglass|alarm|watch|history|refresh|repeat|rotate/, ["#0091FF", "#0A6CC2"]],
];
const DEFAULT_TILE: [string, string] = ["#5B6B7B", "#3F4C59"];

const require_ = createRequire(import.meta.url);
let lucideDir: string | undefined;
try {
  lucideDir = path.join(path.dirname(require_.resolve("lucide-static/package.json")), "icons");
} catch {
  lucideDir = undefined; // optional dependency: general icons simply unavailable
}
let lucideTags: Record<string, string[]> = {};
try {
  lucideTags = JSON.parse(fs.readFileSync(path.join(lucideDir!, "..", "tags.json"), "utf8"));
} catch {
  // no tags: search falls back to names
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

let index: IconEntry[] | null = null;

export function allIcons(): IconEntry[] {
  if (index) return index;
  index = [];
  for (const provider of fs.readdirSync(ICON_ROOT)) {
    const pdir = path.join(ICON_ROOT, provider);
    if (!fs.statSync(pdir).isDirectory()) continue;
    for (const category of fs.readdirSync(pdir)) {
      const cdir = path.join(pdir, category);
      if (!fs.statSync(cdir).isDirectory()) continue;
      for (const f of fs.readdirSync(cdir)) {
        if (!f.endsWith(".png")) continue;
        const name = f.slice(0, -4);
        index.push({ provider, category, name, file: path.join(cdir, f), key: `${provider}:${category}/${name}` });
      }
    }
  }
  if (lucideDir) {
    for (const f of fs.readdirSync(lucideDir)) {
      if (!f.endsWith(".svg")) continue;
      const name = f.slice(0, -4);
      index.push({
        provider: "general",
        category: "general",
        name,
        file: path.join(lucideDir, f),
        key: `general:${name}`,
        tags: lucideTags[name],
      });
    }
  }
  return index;
}

// Common aliases so "aws:lambda" / "azure:functions" / "gcp:gke" work.
const ALIASES: Record<string, string> = {
  "aws:apigateway": "api-gateway",
  "aws:cloudfront": "cloudfront",
  "aws:users": "users",
  "gcp:gke": "gke",
  "gcp:pubsub": "pub-sub",
  "gcp:bigquery": "bigquery",
  "azure:aks": "kubernetes-services",
  "azure:functions": "function-apps",
  "azure:appservice": "app-services",
  "azure:cosmosdb": "cosmos-db",
  "azure:blob": "blob-storage",
  "azure:servicebus": "service-bus",
};

/**
 * Resolve "provider:name" or "provider:category/name" (or bare "name") to an icon.
 * Ranking: exact name > alias > name startsWith > name contains.
 */
export function resolveIcon(ref: string): IconEntry | undefined {
  const [maybeProvider, rest] = ref.includes(":") ? ref.split(/:(.*)/s) : [undefined, ref];
  const provider = maybeProvider?.toLowerCase();
  const pool = allIcons().filter((i) => !provider || i.provider === provider);
  if (rest.includes("/")) {
    const [cat, nm] = rest.split("/");
    return pool.find((i) => norm(i.category) === norm(cat) && norm(i.name) === norm(nm));
  }
  const q = norm(rest);
  const alias = provider && ALIASES[`${provider}:${q}`];
  const exact = pool.filter((i) => norm(i.name) === q);
  if (exact.length) return exact[0];
  if (alias) {
    const a = pool.find((i) => i.name === alias);
    if (a) return a;
  }
  return pool.find((i) => norm(i.name).startsWith(q)) ?? pool.find((i) => norm(i.name).includes(q));
}

export function searchIcons(query?: string, provider?: string, limit = 60): IconEntry[] {
  const q = query ? norm(query) : "";
  const pool = allIcons().filter((i) => !provider || i.provider === provider.toLowerCase());
  if (!q) return pool.slice(0, limit);
  // name hits first, then tag hits (general icons)
  const byName = pool.filter((i) => norm(i.key).includes(q));
  const byTag = pool.filter((i) => !byName.includes(i) && i.tags?.some((t) => norm(t).includes(q)));
  return [...byName, ...byTag].slice(0, limit);
}

const dataUriCache = new Map<string, string>();
function tileSvg(e: IconEntry): string {
  const raw = fs.readFileSync(e.file, "utf8");
  const inner = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  const [c1, c2] = TILE_COLORS.find(([re]) => re.test(e.name))?.[1] ?? DEFAULT_TILE;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
    `<rect width="120" height="120" rx="24" fill="url(#g)"/>` +
    `<g transform="translate(26 26) scale(2.83)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`
  );
}

export function iconDataUri(e: IconEntry): string {
  let u = dataUriCache.get(e.file);
  if (!u) {
    u =
      e.provider === "general"
        ? "data:image/svg+xml;base64," + Buffer.from(tileSvg(e)).toString("base64")
        : "data:image/png;base64," + fs.readFileSync(e.file).toString("base64");
    dataUriCache.set(e.file, u);
  }
  return u;
}

/** Icons of one provider, for inference. */
export const iconsOf = (provider: string) => allIcons().filter((i) => i.provider === provider);
