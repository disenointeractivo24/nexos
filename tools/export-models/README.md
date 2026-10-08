# Exportar los modelos a FBX (solo quads)

Regenera `modelos_fbx/` a partir del mismo código que dibuja la experiencia. Así lo exportado siempre coincide con lo que se ve.

Se hace en tres pasos, desde la carpeta `starter/`.

1. **Servidor y receptor.** Arranca el servidor de desarrollo (`npm run dev`). En otra terminal, arranca el receptor:

   ```bash
   node tools/export-models/receive.mjs
   ```

2. **Construir y convertir.** Abre http://localhost:5173/export-models.html.
   - La página construye los 42 modelos con las mismas funciones de la experiencia y convierte cada pieza a quads (`src/tools/quadMesh.js`).
   - Envía el resultado y las texturas al receptor, que los guarda en `tools/export-models/out/`.
   - Con `?solo=guia` exporta un solo modelo.
   - Esta página es solo de desarrollo: no entra en el `npm run build`.

3. **FBX con Blender.** Ejecuta Blender en segundo plano (4.2 o posterior):

   ```bash
   "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/export-models/build_fbx.py -- tools/export-models/out modelos_fbx
   ```

   - Construye las mallas, los materiales y las texturas.
   - Exporta un FBX por modelo.
   - Vuelve a importar cada FBX para comprobar que todo son quads y escribe `modelos_fbx/informe.txt`.
   - Genera `modelos_fbx/vista_previa.png`.

## Dónde están los modelos en el código

| Modelos | Archivo |
| --- | --- |
| Guía | `src/three/procedural/guide.js` |
| Vecino | `src/three/procedural/villager.js` |
| Insumos | `src/three/procedural/supplies.js` |
| Vegetación | `src/three/procedural/nature.js` |
| Punto de acopio | `src/three/CollectionPoint.js` |
| Mobiliario del barrio, monumentos del mapa y caja de insumos | `src/three/props.js` |
| Elementos de emergencia | `src/three/ThemeCues.js` |

Para agregar un modelo nuevo a la exportación, súmalo a la lista `MODELS` de `src/tools/exportModels.js`.

## Cómo se convierte a quads

- **Primitivas:** las de three.js son rejillas en las que cada celda son dos triángulos seguidos. Se vuelven a unir en el quad original, conservando los vértices exactos.
- **Abanicos de triángulos** (tapas de cilindros y círculos, polos de esferas, puntas de conos y tornos): se quitan y su aro se rellena con quads. El relleno es una rejilla interior más un anillo, plano en las tapas o en forma de cúpula hacia el polo, para no cambiar la silueta.
- **Extrusiones:** se rehacen como prismas con tapas de quads.

Un aro necesita un número par de vértices para cerrarse solo con quads. Si una pieza nueva falla con *"cannot quad-fill a ring of N vertices"*, dale un número par de segmentos.
