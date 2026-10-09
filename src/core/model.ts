import { z } from "zod";
import { resolveIcon, searchIcons } from "../icons/index.js";

export const NodeSchema = z.object({
  id: z.string().describe("Unique node id, e.g. 'api'"),
  label: z
    .string()
    .optional()
    .describe("SHORT name, max ~3 words, e.g. 'Bedrock', 'Order Lambda'. Put extra text in `detail`."),
  detail: z
    .string()
    .optional()
    .describe("Optional small gray subtext under the label, e.g. 'DynamoDB, TTL 30d' (max ~2 short lines)"),
  icon: z
    .string()
    .optional()
    .describe(
      "Icon as 'provider:name', e.g. 'aws:lambda', 'gcp:gke', 'azure:functions'. Optional: when omitted the server infers one from the label (Bedrock, DynamoDB, Mongo, user, ...). Use list_icons to discover names.",
    ),
  shape: z
    .enum(["box", "pill", "diamond"])
    .optional()
    .describe("Shape for icon-less nodes (flow charts). box=process, pill=start/end, diamond=decision. Default box."),
  color: z.string().optional().describe("Fill color for icon-less nodes, e.g. '#FFE0B2'"),
});

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  style: z.enum(["solid", "dashed"]).optional(),
  bidirectional: z.boolean().optional().describe("Arrowheads on both ends"),
});

export const GroupSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  children: z
    .array(z.string())
    .describe("Node ids and/or other group ids contained in this group (VPC, region, subnet, ...)"),
  color: z.string().optional().describe("Border color, e.g. '#FF9900'"),
});

export const SpecSchema = z.object({
  title: z.string().optional(),
  provider: z
    .enum(["aws", "gcp", "azure"])
    .optional()
    .describe("Default cloud for icon inference. Inferred from explicit icons when omitted."),
  direction: z
    .enum(["LR", "TB"])
    .optional()
    .describe("Layout direction. Omit for auto (picks LR or TB, whichever gives a more readable aspect ratio)."),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema).default([]),
  groups: z.array(GroupSchema).default([]),
});

export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Spec = z.infer<typeof SpecSchema>;

export const UpdateSchema = z.object({
  title: z.string().optional(),
  direction: z.enum(["LR", "TB"]).optional(),
  add_nodes: z.array(NodeSchema).optional(),
  update_nodes: z
    .array(NodeSchema.partial().required({ id: true }))
    .optional()
    .describe("Partial node by id; only given fields change"),
  remove_nodes: z.array(z.string()).optional().describe("Also removes connected edges and group memberships"),
  add_edges: z.array(EdgeSchema).optional(),
  remove_edges: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  add_groups: z.array(GroupSchema).optional(),
  update_groups: z.array(GroupSchema.partial().required({ id: true })).optional(),
  remove_groups: z.array(z.string()).optional().describe("Removes the group box only; children stay"),
});
export type Update = z.infer<typeof UpdateSchema>;

export function applyUpdate(spec: Spec, u: Update): Spec {
  const s: Spec = structuredClone(spec);
  if (u.title !== undefined) s.title = u.title;
  if (u.direction) s.direction = u.direction;

  for (const id of u.remove_nodes ?? []) {
    s.nodes = s.nodes.filter((n) => n.id !== id);
    s.edges = s.edges.filter((e) => e.from !== id && e.to !== id);
    for (const g of s.groups) g.children = g.children.filter((c) => c !== id);
  }
  for (const id of u.remove_groups ?? []) {
    s.groups = s.groups.filter((g) => g.id !== id);
    for (const g of s.groups) g.children = g.children.filter((c) => c !== id);
  }
  for (const r of u.remove_edges ?? []) s.edges = s.edges.filter((e) => !(e.from === r.from && e.to === r.to));

  for (const n of u.update_nodes ?? []) {
    const cur = s.nodes.find((x) => x.id === n.id);
    if (!cur) throw new Error(`update_nodes: unknown node '${n.id}'`);
    Object.assign(cur, n);
  }
  for (const g of u.update_groups ?? []) {
    const cur = s.groups.find((x) => x.id === g.id);
    if (!cur) throw new Error(`update_groups: unknown group '${g.id}'`);
    Object.assign(cur, g);
  }
  s.nodes.push(...(u.add_nodes ?? []));
  s.groups.push(...(u.add_groups ?? []));
  for (const g of u.add_groups ?? []) adoptChildren(s, g.id, g.children, true);
  for (const g of u.update_groups ?? []) if (g.children) adoptChildren(s, g.id, g.children, false);
  s.edges.push(...(u.add_edges ?? []));
  return s;
}

/**
 * Re-parent children into group `gid`, so an update can wrap existing nodes in a new group.
 * A new group whose children all came from one parent group is nested inside that parent.
 */
function adoptChildren(s: Spec, gid: string, children: string[], isNew: boolean): void {
  const oldParents = new Set<string | undefined>();
  for (const c of children) {
    const old = s.groups.find((x) => x.id !== gid && x.children.includes(c));
    if (old) oldParents.add(old.id); // brand-new nodes have no old parent and don't block nesting
    if (old) old.children = old.children.filter((k) => k !== c);
  }
  if (isNew) {
    const [only] = oldParents;
    if (oldParents.size === 1) s.groups.find((x) => x.id === only)!.children.push(gid);
  }
}

/** Throws a descriptive Error (shown to the model) when the spec is unusable. */
export function validate(s: Spec): void {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const n of s.nodes) {
    if (ids.has(n.id)) errs.push(`duplicate id '${n.id}'`);
    ids.add(n.id);
    if (n.icon && !resolveIcon(n.icon)) {
      const [prov, nm] = n.icon.includes(":") ? n.icon.split(/:(.*)/s) : [undefined, n.icon];
      let hint: string[] = [];
      for (let len = nm.length; len >= 3 && !hint.length; len--)
        hint = searchIcons(nm.slice(0, len), prov, 8).map((i) => i.key);
      errs.push(
        `node '${n.id}': unknown icon '${n.icon}'.${hint.length ? " Did you mean: " + hint.join(", ") : " Use list_icons."}`,
      );
    }
  }
  for (const g of s.groups) {
    if (ids.has(g.id)) errs.push(`duplicate id '${g.id}' (groups share the id space with nodes)`);
    ids.add(g.id);
  }
  for (const e of s.edges) {
    for (const end of [e.from, e.to]) {
      if (!s.nodes.some((n) => n.id === end)) errs.push(`edge ${e.from}->${e.to}: '${end}' is not a node`);
    }
  }
  const parent = new Map<string, string>();
  for (const g of s.groups) {
    for (const c of g.children) {
      if (!ids.has(c)) errs.push(`group '${g.id}': unknown child '${c}'`);
      else if (parent.has(c)) errs.push(`'${c}' is in two groups ('${parent.get(c)}' and '${g.id}')`);
      else parent.set(c, g.id);
    }
  }
  for (const g of s.groups) {
    for (let p = parent.get(g.id), hops = 0; p; p = parent.get(p), hops++) {
      if (p === g.id || hops > s.groups.length) {
        errs.push(`group '${g.id}' is nested inside itself`);
        break;
      }
    }
  }
  if (errs.length) throw new Error("Invalid diagram:\n- " + errs.join("\n- "));
}
