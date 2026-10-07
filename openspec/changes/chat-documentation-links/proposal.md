# Why
Documentation links resolve from the app root, reopening the SPA instead of reports. Current chat instructions also contradict checked previews and customizable conversations.

# What Changes
Resolve safe documentation links against their source document, render linked Markdown as static readable pages in development and production, and ship source notices/provenance from their existing authoritative files. Consolidate current usage instructions and identify historical validation snapshots. Check the complete linked documentation graph and external destinations.

# Capabilities
## New Capabilities
- `documentation-navigation`: safe, source-relative documentation links and readable report pages.

# Impact
Labs documentation, rendering and static assets only. No chat runtime changes, dependency upgrades or deployment. Existing source Markdown and historical measurements remain available.
