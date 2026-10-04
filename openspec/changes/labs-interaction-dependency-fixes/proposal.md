## Why
Code selection is invisible with vd3 1.7.5 theme tokens; microphone failure messages do not explain unavailable devices in embedded browsers. The dependency report identified remaining linked-package tooling advisories.

## What Changes
- Fix code-editor selection colors in the linked vwl-cbun source and rebuild it.
- Explain microphone absence, denial and busy devices while preserving cancellation and drafts.
- Bulk-update compatible dependencies and lockfiles in the user-authorized linked packages, retaining install security policies.

## Capabilities
### New Capabilities
- `interaction-fixes`: Visible editor selection and recoverable microphone errors.

## Impact
Labs speech internals/tests/docs and linked package manifests, lockfiles and code-editor stylesheet. vd3 APIs remain unchanged. The user explicitly extended the prior Labs dependency review to bulk updates of linked packages.
