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
