# Design
Use the existing safe Markdown renderer before rebasing its emitted anchor destinations. Local `/doc/*.md` links target generated HTML counterparts; raw Markdown, JSON and license files remain available. A shared renderer serves inline docs and standalone static pages without scripts. Build/dev source maps expose only explicitly selected attribution files; no sibling filesystem browsing is introduced.

Documentation pages have a minimal responsive stylesheet and restrictive CSP. Validation traverses linked local pages and checks real destinations and anchors, rejecting SPA fallback documents. External URLs are checked separately so CI does not depend on live third-party services.
