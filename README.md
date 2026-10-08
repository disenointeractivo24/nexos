# NEXOS — Red de ayuda en tiempo real

A guided 3D experience for humanitarian aid in Cali: city → zone → neighborhood → aid point → support basket.
Built with Three.js + GSAP on Vite (no framework).

```bash
npm install
npm run dev
```

## Two roles

**Quiero donar** (public)
1. Ciudad: aerial descent through the clouds, then five zones. The map allows a small, limited orbit; *Centrar mapa* puts it back.
2. Barrio: each zone opens its own neighborhood. The guide walks for you (click-and-go).
3. Punto: the supply panel shows each needed item in 3D, how many are needed, its reference value and how many of it fill a box. Large − / + controls build the basket.
4. Cesta: review quantities, unit values, subtotals, the total equivalent value and how much of a box the basket actually fills.
5. Método: *Entregar los suministros* (form → summary with place, date window and next steps) or *Aportar el valor en dinero* (summary → demo payment gateway).
6. Confirmación, with a reference code.

**Soy punto de acopio** (staff)
Log in and the map belongs to one zone: yours. Every other zone is veiled, and
tapping one says so. Tapping your own opens the **inventory board** straight
away — a collection point never walks down into a barrio.

The board lists every supply with what the point holds against the cap it aims
for, as **crítico**, **estable** or **abastecido**. Each card has − / + for
single units and − caja / + caja for a whole box. Whatever falls under the
critical line is what donors are shown first in that zone, so shortages are no
longer flagged by hand.

> Demo credentials (prototype only, defined in `src/data/collectionPoints.js`):
> `ACOPIO-CENTRO`, `-NORTE`, `-SUR`, `-ORIENTE`, `-OESTE`, all with PIN `2024`.
> Real deployments must validate on a server.

### The inventory is a Google Sheet

The board reads and writes a Google Sheet through a Google Apps Script web app,
so two volunteers on two devices see the same numbers within a few seconds. The
browser never holds a Google credential. Setup is four steps, in
[`tools/google-sheets/README.md`](tools/google-sheets/README.md); the endpoint
goes in `.env` as `VITE_SHEETS_URL` (see `.env.example`), or in `?hoja=<url>`
for a quick demo.

Without an endpoint everything still works against this browser's storage, and
the board says which of the two it is running on.

The payment step is a labelled demo: it collects no payment data and charges nothing.

`Esc` or the top-right button always goes back one step (inside the donor panel it steps back through the panel first).

## Emergency themes

Each session picks one at random, with **sismo** twice as likely as **incendio** or **lluvias**. A theme changes the light and sky slightly, raises the priority of certain needs, and adds small cues: relief tents, a structural-check barrier, distant smoke, sandbags, puddles, light rain, a higher river. Nothing shows damage.

Use `?tema=lluvias` (or another id) to force one. Themes live in `src/data/themes.js`; cues are in `src/three/ThemeCues.js`.

## How many fit in a box

A box is 40 × 30 × 30 cm. Only part of it is usable — things do not tessellate —
and a box someone has to carry is capped by weight long before it runs out of
space. Every supply carries the litres and kilos of one unit as it is actually
packed, and `perBox` in `src/data/catalog.js` takes whichever limit bites first:

| Supply | Per box | Limited by |
| --- | --- | --- |
| Alimentos enlatados | 35 | weight |
| Jabón | 113 | space |
| Arroz | 14 | weight |
| Leche | 14 | weight |
| Agua | 9 | weight |
| Medicinas | 7 | space |
| Kit de higiene | 5 | space |
| Cobija | 2 | space |

That number is what the donor panel shows on each tile, what decides when a box
appears on the counter instead of loose units, and what the collection point's
stock caps are written in.

## Neighborhoods

`src/data/layouts.js` defines five distinct places with the same rules:

| Zone | Barrio | Layout |
| --- | --- | --- |
| Centro | San Fernando | houses around a small plaza |
| Norte | La Flora | palm avenue with a central promenade, roads and crossings, kiosk |
| Oeste | San Antonio | winding stone lane with low walls, up to a chapel on a hill |
| Oriente | El Poblado | canal with a footbridge, sports court |
| Sur | El Ingenio | houses around a park with a pond |

Each layout holds the walkable street graph, the house slots, painted surfaces, the landmark, lamps and planting density.

## Project structure

```
src/
  app/App.js                 flow / roles / state machine, camera framing, input, limited orbit
  app/session.js             role, login, alerts (localStorage), basket drafts
  data/assets.js             ASSET REGISTRY (GLB paths, procedural fallbacks, paint rules)
  data/catalog.js            categories, supplies + reference values (COP), size/weight → perBox
  data/inventory.js          stock caps per supply and the crítico/estable/abastecido line
  app/inventoryStore.js      live inventory: Google Sheet + polling, local fallback
  data/zones.js              zones, theme-aware needs, barrio generator
  data/layouts.js            the five neighborhood layouts
  data/themes.js             emergency themes
  data/collectionPoints.js   collection points + demo credentials
  three/Stage.js             renderer, layered lighting, sky with sun glow, theme mood
  three/stylize.js           stylized shading: soft base occlusion, warm rim, foliage sway, water
  three/AssetLoader.js       GLB loading, normalisation, winding/normal repair, merging, caching
  three/CityOverview.js      abstract Cali, built in small async steps
  three/NeighborhoodScene.js generic builder for any layout (+ cache)
  three/ThemeCues.js         emergency cues, rain
  three/props.js             barrio furniture, map landmarks, supply box (shared with the FBX export)
  three/GuideCharacter.js    guide animation + walking
  three/procedural/guide.js  guide built from the model sheet
  ui/panels.js               zone card, donor panel (basket → method → confirm), inventory board
  ui/Progress.js             progress line with dots
```

## Models as FBX

`modelos_fbx/` holds every procedural model as a quad-only FBX (see its `LEEME.md`). To regenerate them after changing the code, follow `tools/export-models/README.md`.

## Assets

- `static/assets/houses/Casa1.glb` is the tile-roof house and `Casa2.glb` the two-story one (swapped in the update; the registry follows the new names).
- Casa1, Casa2, Casa3 and the obstacle (road barrier of the earthquake theme) use their Substance textures (`static/textures/…`), embedded into `*_prueba.glb` with `tools/fbx_to_glb.py` (it takes an FBX or a GLB plus the texture prefix). In the latest files Casa2 is the corrugated-roof house and Casa3 the two-story one.
- On load the asset loader:
  - flips triangle winding for mirrored (negative-scale) nodes;
  - re-orients meshes that are still clearly inside-out;
  - renders thin parts (glass, doors, grilles) double-sided.
  
  In dev mode the console lists any mesh it re-oriented.
- The guide is procedural, built from the model sheet. To use a GLB, set `model` for `guide` in `src/data/assets.js`. Clips named `idle` and `walk` are used automatically.

## Loading

There is no blocking loader. The clouds and the role choice appear right away, and the city, house models, guide and shader compilation finish in the background while the person reads. If the descent starts before the city is ready, the camera holds inside the clouds until it is. Choosing a zone builds that barrio ahead of time, so entering it is instant.

## Dev notes

- `?timer` drives frames with a timer instead of `requestAnimationFrame`. It's only for embedded or hidden previews that pause rAF.
- `prefers-reduced-motion` shortens camera moves and removes ambient motion.
