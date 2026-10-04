## Context

See proposal.md. VwlAiChatUI owns chat and SpeechSession; VwlChatSpeech owns read-aloud preferences. Settings must not remount that controller when the viewport changes.

## Goals / Non-Goals

Goals: independent messages/settings scrolling, visible composer and status, accessible narrow drawer, no session churn.
Non-goals: inference changes, new voice defaults, Compare/Evaluate redesign or public engine APIs.

## Decisions

- Keep one mounted panel and speech component. Teleport only settings markup into the panel's stable target; keep dictation controls in the composer. Unlike conditional drawer slots, hidden mounted content preserves voice selection and does not dispose speech.
- Use workspace ResizeObserver width for the 960px breakpoint, desktop-local open state and narrow-local drawer state. Panel is 320px; narrow presentation is fixed with backdrop, inert main content, keyboard focus containment/restoration and Escape dismissal. Suspend its focus handler for the nested clear-storage modal.
- Measure available visual viewport below the workspace and update on viewport resize and host changes. Preserve size once the workspace scrolls above the viewport so documentation below remains reachable. Message flex children use min-height:0. Composer resizing is bounded.
- Model and voice detailed state stay in the panel; critical state/error presentation remains in the main column. Preserve existing speech/chat controller cancellation watchers.

## Risks / Trade-offs

- Drawer hiding could dispose settings → v-show plus stable Teleport destination, never conditional speech mounting.
- Nested modal focus conflicts → suspend drawer keyboard containment while storage confirmation is open.
- Keyboard/short viewport reduces available height → visualViewport sizing and bounded composer with a small-window page-scroll fallback.

## Migration Plan

Labs-only source update and production build; no persistent schema or API migration. Revert workspace UI changes to roll back.
