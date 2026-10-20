MOCHI Landscape Fix
==================

Upload these files into your existing `games/MOCHI/` folder:
- index.html
- style.css
- game.js
- manifest.json

What changed:
- Removed the rotate-phone overlay/message.
- Added a manifest with `display: standalone` and `orientation: landscape`.
- Added a best-effort landscape orientation lock after the first user gesture.
- Kept the landscape-friendly layout and game controls.

For automatic landscape rotation most reliably, install the page as a PWA from Chrome (Add to Home screen / Install app) and launch it from its icon. Android/browser support varies; ordinary browser tabs may refuse orientation lock. If the browser refuses it, rotate the phone manually.

This remains Phase A local gameplay; the second character is a decorative bot, not online multiplayer.
