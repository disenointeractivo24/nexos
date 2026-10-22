# Fuentes 3D

Los modelos originales y sus texturas de Substance, una carpeta por modelo.
**La aplicación no carga nada de aquí**: carga los GLB terminados de
`static/assets/`, que ya llevan las texturas adentro. Esta carpeta está fuera
de `static/` a propósito, para que no se copie al sitio publicado.

| Carpeta | Original | Se convierte en |
| --- | --- | --- |
| `casa-teja/` | `Casa1_prueba.fbx` (y `Casa1.glb`, la versión sin texturas) | `static/assets/houses/casa-teja.glb` |
| `casa-techo-ondulado/` | `Casa2.glb` | `static/assets/houses/casa-techo-ondulado.glb` |
| `casa-dos-pisos/` | `Casa3.glb` | `static/assets/houses/casa-dos-pisos.glb` |
| `casa-estrato-2/` | `Casa estrato 2.glb` | `static/assets/houses/casa-estrato-2.glb` |
| `casa-estrato-3/` | `Casa estrato 3.glb` (sus texturas ya no están en el proyecto) | `static/assets/houses/casa-estrato-3.glb` |
| `casa-estrato-4/` | `Casa estrato 4.glb` (llegó como «Casa estrato 21») | `static/assets/houses/casa-estrato-4.glb` |
| `casa-estrato-5/` | `Casa estrato 5.glb` | `static/assets/houses/casa-estrato-5.glb` |
| `casa-techo-plano/` | `Casa4.glb` (sin texturas; ya no se usa en los barrios) | — |
| `obstaculo/` | `Obstaculo.glb` | `static/assets/props/obstaculo.glb` |
| `guia/` | `muñequito.blend` (y `muñequito.glb`, la exportación sin huesos) | `static/assets/characters/guia.glb` |

## Texturas

Cada `texturas/` tiene lo que exporta Substance Painter, con el nombre
`<prefijo>_<material>_<Mapa>.png|.jpg`. Se usan **BaseColor**, **Normal** y
**Roughness** (aunque sea de un solo valor: de ahí sale el brillo del material).

Se borraron los mapas que no aportan nada: **Height** (glTF no lo usa),
**Metallic** y **Emissive** totalmente negros (es lo mismo que no tenerlos).

## Convertir o actualizar un modelo

Con Blender instalado, desde la carpeta `starter/`:

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/fbx_to_glb.py -- "fuentes_3d/casa-estrato-4/Casa estrato 4.glb" "fuentes_3d/casa-estrato-4/texturas" "static/assets/houses/casa-estrato-4.glb" "Casa estrato 4"
```

El último dato es el prefijo de las texturas (lo que va antes de
`_<material>_`). El script pega cada textura a su material por nombre, une las
piezas que comparten material y escribe el GLB.

## Una casa nueva

1. Crea `fuentes_3d/casa-<nombre>/` con el modelo y su carpeta `texturas/`.
2. Conviértela con el comando de arriba hacia `static/assets/houses/casa-<nombre>.glb`.
3. Regístrala en `src/data/assets.js`:
   - `front`: el lado del modelo donde está la puerta (`-z`, `+x`…).
   - `scale`: `DOOR / <alto de la puerta en el modelo>`, para que la puerta mida 2,1 m.
4. Agrégala a `HOUSE_MODELS` (mismo archivo) y a los barrios en `src/data/zones.js`
   (`MODELS` para las casas principales, `FILLER_MODELS` para las de contexto).
5. Si el material de sus ventanas tiene otro nombre, agrégalo a `WINDOW_MATERIAL`
   en `src/three/nightWindows.js` para que se iluminen de noche.

## El guía (muñequito)

`guia/muñequito.blend` es el muñequito con su rig de títere: cada parte (piernas,
torso, brazos, cabeza con casco y el morral) es una pieza rígida que cuelga de una
curva que hace de articulación. `tools/exportar_guia.py` lo exporta a
`static/assets/characters/guia.glb` sin cambiarle nada:

- toma lo que está visible en el archivo (lo oculto son versiones viejas);
- cambia cada curva por un punto vacío en el mismo lugar, con el nombre que la
  aplicación mueve: `body` (cadera y torso), `head`, `armL`, `armR`, `legL` y
  `legR`. Los reconoce por su posición, así que renombrar las curvas no importa;
- si junto al `.blend` está la versión texturizada (`muñequito_texturas.fbx` y la
  carpeta `texturas/`, de Substance Painter), usa sus piezas y sus texturas. En ese
  FBX las piezas que comparten material están unidas (toda la piel es «Body»), así
  que el script las separa otra vez y cuelga cada una de su articulación;
- da color a las piezas que aún no tienen: piel crema y casco naranja;
- exporta con los modificadores aplicados. El `.blend` no se modifica.

Después de cambiar el muñequito en Blender, desde `starter/`:

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup "fuentes_3d/guia/muñequito.blend" --python tools/exportar_guia.py -- static/assets/characters/guia.glb
```

Las texturas se llaman `muñequito_texturas_<material>_<Mapa>.jpg` (Body, CASCO,
Backpack, Correas y bolsillos, Cierre). Solo se usa el BaseColor, con la superficie
mate: el muñequito se ve tal como está pintado, sin brillos. Los demás mapas se ignoran. Si se vuelven a exportar desde Substance,
basta con reemplazar los archivos de `texturas/` (y el FBX si cambió la malla) y
volver a correr el comando.

La cara (ojos, boca) y sus expresiones las dibuja la aplicación sobre la cabeza
(`src/three/guideFace.js`); la cruz del casco viene pintada en su textura.

`guia/muñequito-v1-sin-rig.blend` es la primera versión, sin rig.

## Props de la calle

`props/<Nombre>/` tiene cada prop tal como sale de Substance Painter: el modelo en
`GLB/` y las texturas `<prefijo>_<material>_<Mapa>.jpg`. `tools/exportar_props.py`
les pone el BaseColor (mate, sin los demás mapas), los asienta en el suelo y escribe
`static/assets/props/<nombre>.glb`. Desde `starter/`:

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/exportar_props.py -- fuentes_3d/props static/assets/props
```

Están registrados en `src/data/assets.js` (bin, cone, hydrant, electric-box,
phone-booth, bus-stop, utility-pole) y los ubica `#streetLife` en
`src/three/NeighborhoodScene.js`, al borde de las calles y mirando hacia ellas.

## Edificios (Torre de Cali, estadio, punto de acopio)

`edificios/<Nombre>/` tiene cada edificio como sale de Substance (modelo en `GLB/` y
texturas). Se exportan con el mismo script de los props, hacia `static/assets/buildings/`:

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/exportar_props.py -- fuentes_3d/edificios static/assets/buildings
```

- `torre-de-cali.glb` y `estadio.glb` reemplazan los dibujados en el mapa de Cali
  (`useLandmarkModels` en `src/three/CityOverview.js`; tamaño en `src/data/assets.js`).
- `punto-de-acopio.glb` es el puesto del barrio (lo que el donante deja va sobre su
  escritorio) y el de la vista del punto de acopio (`setStand` en `src/three/Depot.js`,
  donde su escritorio, estantería y cajas se ocultan para mostrar el inventario en vivo).

## Vecinos (NPC)

`npcs/` tiene los modelos de los vecinos para texturizar, uno por edad:
`npc_adulto.fbx`, `npc_adolescente.fbx`, `npc_nino.fbx` y `npc_mayor.fbx`, cada uno
con una vista previa `.png`.

Todos son el cuerpo del guía, con su misma geometría y su mismo rig (`body`, `head`,
`armL`, `armR`, `legL` y `legR`), sin casco ni maletín. Lo añadido va en piezas
aparte, cada una colgada de su articulación:

- ropa: camiseta (torso y mangas), pantalón (cadera y perneras) y zapatos. Son capas
  de tela que siguen la forma del cuerpo, con corte recto y grosor. La piel queda
  debajo;
- pelo: una sola malla limpia en quads, con sus propias UV;
- orejas.

Hay cinco materiales, que en Substance son cinco conjuntos de textura: `Piel`,
`Camiseta`, `Pantalon`, `Zapatos` y `Pelo`.

| Edad | Tamaño | Ropa | Pelo |
|---|---|---|---|
| adulto | 100 % | manga corta, pantalón largo | corto con flequillo |
| adolescente | 87 % | manga corta, pantalón largo | flequillo largo con copete |
| niño | 62 %, cabeza un poco más grande | manga corta, pantaloneta | corte de tazón |
| mayor | 100 % | manga larga, pantalón largo | canoso, calvo arriba; el pelo rodea la nuca |

La postura encorvada y el paso lento de los mayores los pone la aplicación, no el
modelo. La aplicación ya viste a los vecinos con estos mismos cortes, pintados con
colores. Cuando estén las texturas, se cambian por estos modelos.

Para regenerarlos después de cambiar el guía, desde `starter/`:

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/exportar_npcs.py -- static/assets/characters/guia.glb fuentes_3d/npcs
```

## Modelos livianos para el celular

`tools/optimizar_glb.py` cambia a JPEG las texturas PNG que vienen dentro de un `.glb`
(las que no usan transparencia). La geometría y los materiales no se tocan: solo las
imágenes. Las casas «dos pisos», «techo ondulado» y «teja» pasaron de 4–6 MB a ~1 MB cada
una sin diferencia visible. Conviene correrlo cada vez que se exporte un modelo nuevo con
texturas PNG. Desde `starter/`:

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/optimizar_glb.py -- static/assets/houses/casa-teja.glb
```

### Forma de la ciudad

`mapa_cali/Zonificacion-SITM-MIO.svg` es el mapa de zonas del MIO. Sus contornos están copiados en
`src/data/caliMap.js` (cada zona del MIO con la zona de la aplicación a la que pertenece: norte =
Menga y Calima, centro = Centro y Prado, oriente = Aguablanca y Ciudad Córdoba, sur = Valle del Lilí
y Guadalupe, oeste = Cañaveralejo). El mapa de la aplicación los dibuja en una cuadrícula y suaviza
los bordes, así que la ciudad tiene la forma de Cali sin copiarla al detalle. Si cambia el SVG, hay
que volver a copiar los contornos de cada `<path>` en ese archivo.

### Edificios de la ciudad e iglesia de San Antonio

- `edificios/ciudad/Edificio 1|2|3/` (GLB + Texturas) dan `static/assets/buildings/edificio-1|2|3.glb`:
  los edificios del mapa de Cali, agrupados en conjuntos residenciales (una manzana entera con
  varias copias del mismo edificio; `complexLayout` y `TOWER_MODELS` en `src/three/CityOverview.js`).
- `iglesia-san-antonio/IGLESIA/` (GLB + TEXTURAS) da `static/assets/buildings/iglesia-san-antonio.glb`:
  la iglesia en la cima del barrio San Antonio, con la entrada y la escalera hacia la calle. Su
  colina de césped no se usa (el barrio tiene su propia loma).

Se generan con `tools/fbx_to_glb.py`, como las casas. Ojo con las rutas largas: Windows no
abre archivos de más de 260 caracteres, y entonces la textura no se encuentra (por eso la
carpeta se llama solo `ciudad`). Desde `starter/`:

```
"C:Program FilesBlender FoundationBlender 5.0lender.exe" -b --factory-startup --python tools/fbx_to_glb.py -- "fuentes_3d/edificios/ciudad/Edificio 1/GLB/Edificio 1.glb" "fuentes_3d/edificios/ciudad/Edificio 1/Texturas" static/assets/buildings/edificio-1.glb "Edificio 1"
"C:Program FilesBlender FoundationBlender 5.0lender.exe" -b --factory-startup --python tools/fbx_to_glb.py -- fuentes_3d/iglesia-san-antonio/IGLESIA/GLB/iglesia.glb fuentes_3d/iglesia-san-antonio/IGLESIA/TEXTURAS static/assets/buildings/iglesia-san-antonio.glb IGLESIA2
```

### Vías de la ciudad

`mapa_cali/Map_of_Cali.svg` es un mapa de OpenStreetMap con las vías de Cali y Yumbo.
`tools/vias_cali.mjs` lo superpone al mapa del MIO, deja una sola línea por corredor (las
calzadas de una avenida van juntas), separa las calles al menos media cuadra y escribe
`src/data/caliRoads.js`: las avenidas (vías troncales y primarias) y las calles principales
(secundarias y terciarias). Entre ellas, cada zona arma sus manzanas con su propia orientación,
como corren las calles de Cali allí (`ZONE_GRID` en `src/three/CityOverview.js`). Desde `starter/`:

```
node tools/vias_cali.mjs fuentes_3d/mapa_cali/Map_of_Cali.svg src/data/caliRoads.js
```

### Casas del mapa de Cali

El mapa de Cali usa las mismas casas de los barrios, en una versión liviana: cerca de mil casas
vistas desde arriba no necesitan cada detalle. `tools/casas_mapa.py` toma cada casa de
`static/assets/houses/`, le deja unos 450 triángulos (mismo contorno y mismas texturas, a 256 px)
y la escribe en `static/assets/houses/mapa/`. Cada zona usa las casas que le van: las sencillas
en el oriente y las más grandes en el norte y el oeste (`MAP_HOUSES` en `src/three/CityOverview.js`).
Cada vez que cambie una casa del barrio hay que volver a correrlo, desde `starter/`:

```
"C:Program FilesBlender FoundationBlender 5.0lender.exe" -b --factory-startup --python tools/casas_mapa.py -- static/assets/houses static/assets/houses/mapa
```

### Texturas de los vecinos

Las texturas pintadas en Substance van en `npcs/Textures/`, una carpeta por juego:
`NPC1`, `NPC2`… (ropa para los jóvenes), `Niño` (solo el pantalón: la pantaloneta del niño)
y `Abuelo` (el mayor). Se pintaron sobre `npcs/npc1.glb` (el joven) y `npcs/abuelo.glb` (el
mayor), que son los mismos modelos con UV propias; los `.fbx` solo le dicen al script a qué
articulación va cada pieza. El adulto, el adolescente y el niño usan el mismo peinado; el niño
lleva la pantaloneta de `npc_nino.fbx` y, debajo, las piernas en el tono de la piel (esa parte
de la textura quedó sin pintar, porque iba bajo el pantalón largo). Cada carpeta
`NPC<n>` da dos modelos (`npc-joven-<n>` y `npc-nino-<n>`) y la aplicación los alterna.

Para regenerarlos, desde `starter/`:

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/exportar_npcs_texturas.py -- fuentes_3d/npcs static/assets/characters
```

Basta con añadir otra carpeta `NPC3` (con los mismos nombres de material) para tener otro
juego de ropa; luego hay que sumarlo en `src/data/assets.js` y en `src/three/neighbour.js`.

### Apertura (pantalla de carga)

La apertura es un video del guía, no 3D en vivo. Así corre fluido en cualquier equipo, con o
sin tarjeta gráfica, mientras la página carga por detrás. Son dos clips en `static/assets/ui/`:

- `apertura-intro.mp4`: en el punto de acopio, primer plano de la cara del guía mirando la caja
  que carga; levanta la vista y sonríe, la cámara se aleja en arco mientras lleva la caja al
  estante más cercano y la desliza en el de abajo (sin soltarla en el aire), y luego se da
  vuelta y saluda (ahí entra el logo, `LOGO_AT` en `boot.js`). Nada salta: todo entra y sale
  con curvas suaves y los movimientos de cámara se encadenan sin detenerse.
- `apertura-loop.mp4`: el guía respirando, mientras siga cargando.

`src/boot.js` los reproduce y abre la app cuando termina la apertura y todo está cargado.

Se filman con el código del propio guía (`GuideCharacter`, su cara y sus gestos). La
coreografía, la cámara y las curvas están en `tools/apertura/apertura.js`. Para regenerarlos,
desde `starter/`:

1. `npm run dev` y abrir `http://localhost:5173/?ligero=0` en una ventana de 1600 × 900 (los
   cuadros salen del propio lienzo de la página), hasta que salga la portada.
2. `node tools/apertura/recibir.mjs cuadros_apertura`
3. En la consola del navegador:
   `eval(await fetch('http://127.0.0.1:5199/apertura.js').then(r => r.text()))`
   Con `window.__aperturaPreview = [0, 1.4, 3, 6.2]` antes, solo arma una hoja de muestra
   (`window.__aperturaSheet`) sin enviar cuadros.
4. Codificar los dos clips (H.264, que reproduce cualquier navegador):

```
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/apertura/codificar.py -- cuadros_apertura intro_ static/assets/ui/apertura-intro.mp4 60
"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools/apertura/codificar.py -- cuadros_apertura loop_ static/assets/ui/apertura-loop.mp4 60
```

La carpeta `cuadros_apertura` se puede borrar después.
