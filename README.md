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
3. Punto: the supply panel shows each needed item in 3D, how many are needed and its reference value. Large − / + controls build the basket.
4. Cesta: review quantities, unit values, subtotals and the total equivalent value.
5. Método: *Entregar los suministros* (form → summary with place, date window and next steps) or *Aportar el valor en dinero* (summary → demo payment gateway).
6. Confirmación, with a reference code.

**Soy punto de acopio** (staff)
Log in, then use the same map and panels with one extra permission: **Alertar faltante** on any item. Alerts mark the item and the house as urgent, and donors see those items first.

> Demo credentials (prototype only, defined in `src/data/collectionPoints.js`): `ACOPIO-CENTRO` / `2024`
> (also `ACOPIO-NORTE`, `-OESTE`, `-ORIENTE`, `-SUR`, same PIN). Real deployments must validate on a server.

Alerts are kept in this browser's `localStorage`, so you can log in as a collection point, mark items, exit with *Cerrar sesión*, and see them as a donor. The payment step is a labelled demo: it collects no payment data and charges nothing.

`Esc` or the top-right button always goes back one step (inside the donor panel it steps back through the panel first).

## Emergency themes

Each session picks one at random: **sismo**, **incendio**, **tsunami**, **lluvias**. A theme changes the light and sky slightly, raises the priority of certain needs, and adds small cues: relief tents, a structural-check barrier, distant smoke, sandbags, puddles, light rain, a higher river. Nothing shows damage.

Use `?tema=lluvias` (or another id) to force one. Themes live in `src/data/themes.js`; cues are in `src/three/ThemeCues.js`.

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
  data/catalog.js            categories, supplies + reference values (COP)
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
  three/GuideCharacter.js    guide animation + walking
  three/procedural/guide.js  guide built from the model sheet
  ui/panels.js               zone card, donor panel (basket → method → confirm), collector panel
  ui/Progress.js             progress line with dots
```

## Assets

- `static/assets/houses/Casa1.glb` is the tile-roof house and `Casa2.glb` the two-story one (swapped in the update; the registry follows the new names).
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
