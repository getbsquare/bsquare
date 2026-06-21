# Chart spec

A host action (or a `render_chart` tool) returns:

```json
{ "type": "bar" | "line",
  "title": "string (optional)",
  "data": [ { "x": "string|number", "y": "number" } ] }
```

The widget also accepts this shape wrapped as:

- `{ "spec": <shape above> }` — explicit spec wrapper
- `{ "type": "chart", "spec": <shape above> }` — tagged spec
- `{ "ui": { "type": "chart", "spec": <shape above> } }` — UI block wrapper
