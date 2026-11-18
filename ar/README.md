# NEXOS AR: un turno en el punto de acopio

Experiencia de realidad aumentada para Meta Quest 3: la persona es responsable de un centro de acopio en Cali durante un turno. Es un proyecto aparte de la web (IWSDK necesita otra versión de Three) y reutiliza sus modelos, datos e inventario.

```bash
npm install --prefix ar
npm run dev --prefix ar                # https://localhost:8081, para abrir desde el visor o con el emulador
npm run dev --prefix ar -- --mode http # http://localhost:8081, para probar en este computador
npm test --prefix ar                   # las reglas del turno, sin 3D
```

## Esta versión (rama `ar2`, publicada en `/ar2/`)

Parte de `/ar/`, a escala de la mesa real:

- **Tu mesa es el mostrador.** Al presionar, la app busca en el escaneo del cuarto la mesa que tienes delante (la que miras) y pone encima una mesa virtual de su mismo tamaño y altura. Todo el punto se reduce para caber en ella: los tapetes, el botón y las cajas quedan sobre tu mesa.
- **Se ve tu cuarto.** La carpa no se muestra, así no se pierde la profundidad del espacio. El camión es mucho más pequeño.
- **El estante está a tu derecha y a la mano**, pegado al extremo de la mesa, con las cajas entre la rodilla y el pecho. Si a la derecha hay una pared o un mueble, se pone a la izquierda (y te avisa). El camión y su panel siempre van del lado contrario al estante.
- **Órdenes, no personas.** Las familias no aparecen: llegan sus órdenes, en fila sobre la mesa, cada una con una foto de la familia, fotos de lo que necesita con cuántos, y el tiempo que les queda (la urgente primero).
- Sin mesa en el escaneo, usa una virtual del tamaño de una mesa común y la coloca donde no choque con paredes ni muebles. Conviene haber escaneado el cuarto en las gafas (Ajustes › Espacio físico).

## Sin visor

En el botón **Probar en el computador**: mantén presionado un insumo o una caja para llevarlo, arrastra el fondo para mirar, W A S D para caminar, Q y E para girar y T para ver la lista de tareas. En el visor, la lista sale con A o X. Los botones de abajo cambian entre la vista de la persona, desde arriba y desde afuera.

## Inventario

Trabaja sobre el punto `demo-ar`, que no ven quienes donan y no cuenta en el Resumen. En desarrollo se queda en este navegador. Publicado, usa la pestaña **Demo AR** de la hoja: para crearla, pega `tools/google-sheets/Codigo.gs` en Apps Script, ejecuta `organizarHoja` y publica una nueva versión. Con `?hoja=local` no toca ninguna hoja.
