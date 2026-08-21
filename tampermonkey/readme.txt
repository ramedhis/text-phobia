text-phobia — Tampermonkey userscript
======================================

Takes the fear-radius letter physics from this repo's canvas tool and
applies it to real text on any webpage you're browsing. Includes a small
floating panel to tune the physics live.

It does NOT run automatically on pages you visit — you turn it on
per-tab from the Tampermonkey menu, and turn it off the same way.

How to use:
1. Install the "Tampermonkey" browser extension (Chrome, Firefox,
   Edge, etc).
2. Click the Tampermonkey icon -> Dashboard -> "+" (Create a new script).
   This opens a new script page.
3. Drag and drop the `text-phobia.user.js` file from the `tampermonkey`
   folder into that page, then click Install.
4. Open any webpage you want to try it on (e.g. a Wikipedia article).
5. Click the Tampermonkey icon in your toolbar -> "Toggle text-phobia".
6. Move your mouse over the page text and watch it flee.
7. A floating panel appears where you can adjust the numbers yourself
   and move your mouse around to see the effects.
8. Enjoy!

Features:
- Drag the panel's sliders to change the physics live. 
- Click "Hide" to collapse the panel into a small draggable button; click
  that button again to bring the panel back.
- Click "Stop" in the panel (or "Toggle text-phobia" from the extension
  menu again) to turn it off. Reloading the page also fully resets everything.

Notes:
- Skips scripts, inputs, code blocks, and editable areas, so it
  won't break page functionality.
- Only characters near your cursor are simulated, so it stays smooth
  even on long pages.
- Nothing is saved or sent anywhere — it's all local to your browser tab.
- IT MIGHT BE LAGGING.