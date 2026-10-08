# Modelos 3D de NEXOS en FBX

Los 42 modelos que la experiencia construye con código, exportados a FBX para editarlos en Blender, Maya u otro programa.
Tienen la misma forma, medidas, colores y texturas que en la experiencia.

- **Solo quads.** Cada FBX se volvió a importar y se contaron sus polígonos. Hay 0 triángulos y 0 n-gonos (ver `informe.txt`).
- **Geometría limpia.** Las mallas están soldadas, sin vértices sueltos ni caras degeneradas. Las tapas de cilindros, y las puntas de esferas y conos, se cierran con una rejilla de quads (como el *Grid Fill* de Blender) en vez de un abanico de triángulos.
- **Piezas separadas y con nombre.** Cada pieza es un objeto, y los grupos de la experiencia son *empties* con el mismo nombre. En el guía y el vecino se conservan los pivotes para animar: `body`, `head`, `armL`, `armR`, `legL`, `legR`.
- **Unidades y ejes.** Metros, Y arriba en el FBX (Z arriba al abrirlo en Blender). El frente de cada modelo mira hacia el espectador: −Y en Blender.
- **Texturas.** Van incrustadas en cada FBX y además están en `texturas/`. Son las etiquetas (ARROZ, AGUA, LECHE…), las cruces y los letreros.
- **Vista previa.** `vista_previa.png` muestra los 42 modelos en el orden de la lista de abajo.

## Contenido

| Carpeta | Modelos |
| --- | --- |
| `personajes/` | guia, vecino |
| `insumos/` | agua, alimentos_enlatados, arroz, cobija, jabon, kit_de_higiene, leche, medicinas |
| `punto_de_acopio/` | caja_de_insumos, punto_de_acopio |
| `vegetacion/` | arbol, arbusto, palmera |
| `barrio/` | arco_cancha, banca, bicicleta, caneca, capilla, escalon_capilla, matera, muro_bajo, puente_peatonal, quiosco |
| `ciudad/` | casa_mapa, cristo_rey, estadio, la_ermita, punto_de_ayuda_mapa, torre_de_cali, torre_mapa, tres_cruces |
| `emergencias/` | barrera_revision, carpa_de_socorro, conos, estibas, punto_de_agua, punto_de_encuentro, sacos_de_arena, tanques_de_agua, tendedero |

Las casas del barrio y el poste de luz no están aquí: son los GLB que ya tenías (`static/assets/`).

## Diferencias con lo que se ve en pantalla

Son mínimas y vienen de pasar a solo quads:

- **Tronco del árbol:** pasa de 7 a 8 lados. Un aro de lados impares no se puede cerrar solo con quads.
- **Copas de árbol y arbustos:** en la experiencia son icoesferas, que solo tienen triángulos. Aquí son esferas de quads con la misma posición, tamaño y deformación.
- **Tronco de la palmera:** en la experiencia está abierto en los extremos; aquí está cerrado.
- **Tamaños:**
  - El guía mide 1,6 m, como en la experiencia.
  - Los insumos están a la escala con la que la experiencia los carga: su lado más largo mide 1,7. En el mostrador se muestran a 0,5 m.
  - El Cristo Rey está a escala 1, y el mapa lo agranda 1,6 veces.
- **Paquete del vecino** (`paquete`/`parcel`): se exporta visible. En la experiencia solo aparece cuando recoge su parte.

## Volver a exportar

Si cambias los modelos en el código, se regeneran con los pasos de `tools/export-models/README.md`.
