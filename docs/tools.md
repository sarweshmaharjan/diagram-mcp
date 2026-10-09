# Tool reference

Every tool that touches a project also accepts `output_dir` (absolute project path, see [Output folder](configuration.md#output-folder)). Every reply ends with a `log_id`.

## The spec

`create_diagram` takes a spec, and `update_diagram` and `draw_diagram` produce one.

```jsonc
{
  "title": "Serverless Orders API",
  "direction": "LR", // "LR" or "TB"; omit for automatic
  "provider": "aws", // default cloud for icon inference; omit to infer
  "nodes": [
    { "id": "api", "label": "API Gateway", "icon": "aws:api-gateway" },
    { "id": "fn", "label": "Orders API", "detail": "Node 20", "icon": "aws:lambda" },
    { "id": "ok", "label": "Valid?", "shape": "diamond" }, // icon-less nodes are flowchart shapes
  ],
  "edges": [
    { "from": "api", "to": "fn", "label": "1. invoke" }, // "1." becomes a numbered badge and sets the order
    { "from": "fn", "to": "api", "style": "dashed" }, // returns and loops: dashed or bidirectional
    { "from": "fn", "to": "ok", "bidirectional": true },
  ],
  "groups": [{ "id": "aws", "label": "AWS Cloud", "children": ["api", "fn"] }],
}
```

| Field            | Notes                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `node.icon`      | `provider:name` or `provider:category/name`. Optional: missing icons are inferred from the label.    |
| `node.label`     | 1 to 3 words. Longer text is split into label and `detail`.                                          |
| `node.shape`     | `box` (default), `pill` (start/end) or `diamond` (decision), for icon-less nodes.                    |
| `node.color`     | Fill color for icon-less nodes, for example `#FFCDD2`.                                               |
| `edge.label`     | `1.`, `2.`, `A.` prefixes render as badges. Numbered calls out of one node are placed in step order. |
| `group.children` | Node ids and other group ids. A node belongs to at most one group. Groups can nest.                  |

Icon providers: `aws`, `gcp`, `azure`, `k8s`, `saas`, `onprem`, `generic`, and `general` (everyday glyphs on a colored tile).

## Tools

### `create_diagram`

Spec fields above plus `name` (file name and `diagram_id`, defaults to the title). Creating with a name that already exists **replaces** that diagram. The reply includes notes about problems worth fixing (icon-less nodes, dense diagram, nothing returning from a called node).

### `update_diagram`

`diagram_id` plus any of: `title`, `direction`, `add_nodes`, `update_nodes` (partial, by id), `remove_nodes`, `add_edges`, `remove_edges` (`{from, to}`), `add_groups`, `update_groups`, `remove_groups`. Wrapping existing nodes in a new group works, and nests the group if the nodes shared a parent.

### `draw_diagram`

| Parameter        | Meaning                                           |
| ---------------- | ------------------------------------------------- |
| `request`        | What to draw, in plain language                   |
| `name`           | Stable name for a new diagram                     |
| `diagram_id`     | Existing diagram to change according to `request` |
| `direction`      | Force `LR` or `TB`                                |
| `provider`       | Preferred cloud for icons                         |
| `max_iterations` | Review passes, 1 to 5 (default 5)                 |

Requires a local LLM, see [Plain-language mode](configuration.md#plain-language-mode-llm).

### `get_diagram`, `delete_diagram`, `list_diagrams`

Take `diagram_id` (not for list) and return the spec and PNG, delete both files, or list diagrams newest first.

### `list_icons`

`provider`, `query` (substring of the name, or a tag for general icons), `limit`. Returns lines like `aws:lambda  (compute)`.

### `get_log`

`log_id` (or `latest`). Returns the full record of that call: input, folder chosen and why, inferred icons, review passes, reply, error.
