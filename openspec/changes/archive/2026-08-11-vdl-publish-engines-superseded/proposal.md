## Why

Product apps like ts-school need to consume Labs headless engines from a versioned package without copying sources. The former `@vanduo-oss/labs-vwl-neptune-search` name was unpublished and search-specific; engines now include AiChat + guardrails + Neptune.

## What Changes

- Publish surface is `@vanduo-oss/vwl-engines` with subpath exports for neptune, ai-chat, and guardrails.
- NeptuneSearch accepts injectable `loadFuse` / `loadTransformers` so hosts can bundle deps (CSP-friendly) instead of CDN-only.
- Add a non-vd3-docs corpus fixture proving schema is corpus-agnostic.
- Document headless-vs-Vue-demo consumption.

## Capabilities

### New Capabilities

- `vwl-engines-package`: Packagable headless exports and injectable Neptune dependency loaders.

### Modified Capabilities

- `vwl-neptune-search`: Support custom library loaders and arbitrary Neptune Document corpora.

## Impact

- Labs package rename (publishConfig public). Vue demo UI remains Labs-site-only.
- Downstream: ts-school pins `@vanduo-oss/vwl-engines` (file: until registry publish).


## SUPERSEDED

Superseded by split packages `@vanduo-oss/vwl-ai-chat` and `@vanduo-oss/vwl-hybrid-search` (published). Do not publish `@vanduo-oss/vwl-engines`.
