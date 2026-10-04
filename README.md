# Vanduo Web Labs

Demo playground for the Vanduo ecosystem. Labs dogfoods **sibling vanduo-oss Labs repos** (`vwl-*`) via `link:../vwl-*` — it is **not** an engine source of truth and does **not** publish a `vwl-*` npm family.

Live demos: **https://labs.vanduo.dev**

## Sibling Labs repos (`vwl-*`)

Clone these beside Labs (same parent directory) so `link:../vwl-*` resolves:

| Repo | Role |
|------|------|
| [`vanduo-oss/vwl-cbun`](https://github.com/vanduo-oss/vwl-cbun) | Widgets: code-editor, draw, hex-grid, music-player (`#widgets/*`); Vite aliases into sibling `dist/` |
| [`vanduo-oss/vwl-hybrid-search`](https://github.com/vanduo-oss/vwl-hybrid-search) | Headless `HybridSearch` + search guardrails |
| [`vanduo-oss/vwl-ai-chat`](https://github.com/vanduo-oss/vwl-ai-chat) | Headless `AiChat` + LLM/tools guardrails + markdown |
| Labs-local `model-eval.js` | Model evaluation harness (CLI / standalone; not listed on the live site) |

The site injects bundled runtimes through `src/lib/chat-runtime.js` and the standalone search demo resolves the documentation manifest through `src/lib/docs-search.js`. Build the sibling packages before starting Labs. Hex Earth remains private and is consumed through `link:../vwl-hex-earth`.

Guardrails docs: [doc/vwl-guardrails.md](./doc/vwl-guardrails.md)

---

## vd-hex (VdHexGrid) — Graduated

Hex-grid now lives in Labs [`vwl-cbun`](https://github.com/vanduo-oss/vwl-cbun) (`#widgets/hex-grid`). It is **not** published under `@vanduo-oss/hex-grid` on npm (that package is unpublished).

---

## vwl-hybrid-search (demo)

In-browser hybrid search over **[vd3 docs](https://vd3.vanduo.dev/)** — fuzzy (Fuse.js) + semantic (Transformers.js). Labs UI: `VwlHybridSearchUI`.

See [doc/vwl-hybrid-search.md](./doc/vwl-hybrid-search.md).

```bash
pnpm index   # canonical local vd3-docs build → atomic dual-preset data/search-manifest.json
```

---

## vwl-ai-chat (demo)

In-browser AI chat (LiteRT Gemma default, WebLLM fallbacks) with FOSS guardrails. Labs UI: `VwlAiChatUI`.

See [doc/vwl-ai-chat.md](./doc/vwl-ai-chat.md).

```bash
pnpm models:fetch   # optional local .models/ mirror for faster dev
pnpm model-eval     # local CLI eval harness — see doc/vwl-model-eval.md
```

---

## Hex Earth

`#demos/hex-earth` opens the sibling demo across the available viewport with the Oola dock retained. Geography and canvas code stay in `vwl-hex-earth`; they load only when the route opens. Controls and Stats can be moved with the pointer or arrow keys on desktop. Phones use compact sheets and initially select the low tier. All tiers remain selectable; comparative benchmarks run only on request. Reset layout restores panel positions.

## vwl-ai-draw (in-repo / local)

Alpha — **not listed** on the live Labs site. AI-assisted SVG canvas: host-executed DrawPlans from Gemma 4 (E2B default) with a regex recipe fast-path, read-only question turns, and an optional flagged WebLLM Qwen3-0.6B fast planner. Standalone: `demo/ai-draw-demo.html`. Labs UI: `VwlAiDrawUI`.

See [doc/vwl-ai-draw.md](./doc/vwl-ai-draw.md).

```bash
pnpm model-eval:draw   # darwin/arm64: plan-validity + latency baseline per model
```

---

## vwl-model-eval (in-repo / local)

Alpha — **not listed** on the live Labs site (Tools nav removed). Local CLI + harness for scoring published models; report UI stays available via `demo/model-eval-harness.html` and `VwlModelEvalUI` for local use.

See [doc/vwl-model-eval.md](./doc/vwl-model-eval.md).

---

## Develop

Expect sibling checkouts:

```text
0_vanduo/
  labs/
  vwl-ai-chat/
  vwl-hybrid-search/
  vwl-cbun/
  vwl-hex-earth/
```

```bash
pnpm install
pnpm dev
```

- `http://localhost:3000/` — Labs site
- `http://localhost:3000/demo/hybrid-search-demo.html`
- `http://localhost:3000/demo/ai-chat-demo.html`
- `http://localhost:3000/demo/ai-draw-demo.html` — local only (not on live demos)
- `http://localhost:3000/demo/model-eval-harness.html` — local only

```bash
pnpm format:check && pnpm lint && pnpm test:unit && pnpm build
pnpm test:local    # optional: Gemma drawing requests on macOS arm64 / RUN_AI_DRAW_INFERENCE=1
```

Theme controls use `app.use(VanduoVue, { storagePrefix: 'vwl-' })` so preferences do not collide with vd3-docs on shared Pages origins. First visit shows a mandatory terms gate (AI Act transparency + experimental demos); decline opens a farewell screen.

## Support / Contributing

Maintained by vanduo-oss; external contributions are not accepted at this time. Security: [SECURITY.md](./SECURITY.md).

## Credits

Home page liquid atmosphere is inspired by Cameron Knight’s
[Interactive Liquid Gradient using Three.js](https://codepen.io/cameronknight/pen/ogxWmBP)
(CodePen). Labs ships a vanilla WebGL reimplementation bound to vd3 tokens.

## License

MIT — see [LICENSE](./LICENSE).
