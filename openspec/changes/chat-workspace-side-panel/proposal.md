## Why

Speech settings and stacked model controls consume the chat's constrained height, leaving little room for messages. Users need a conversation-first workspace with controls beside it.

## What Changes

- Fill the available viewport with a message column and independently scrolling, collapsible 320px right controls panel.
- Use an accessible right drawer below 960px of workspace width.
- Keep dictation beside the composer and compact conversation controls/status in the header.
- Keep speech settings/session state mounted when hiding controls or resizing; preserve all speech lifecycle behavior.
- Compact AI Chat's route and standalone hosts, leaving documentation below.

## Capabilities

### New Capabilities

- `chat-workspace`: Responsive chat workspace with separate settings and stable speech ownership.

### Modified Capabilities

None.

## Impact

Labs Vue shell, demo hosts, speech control presentation and layout tests. Public AiChat and @vanduo-oss/vd3 APIs, inference workers and dependency versions remain unchanged.
