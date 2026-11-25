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

- **Colocar la mesa, en dos gestos.** (1) Cada mano tiene siempre un rayo con una diana donde toca una superficie; apunta a tu mesa: la superficie que el visor detectó se marca con una sombra semitransparente; pellizca para elegirla. La sombra queda fija y anclada a la mesa y los rayos desaparecen. (2) Pellizca con las dos manos en el borde de la mesa y sepáralas: el área gris se dibuja mientras las mueves, tan ancha como la separación (mínimo 35 cm) y hacia atrás hasta donde llega la mesa. Al soltar, la mesa virtual del punto de acopio se crea dentro de esa área, a la altura de la superficie, y todo se escala a su ancho.
- **Se ve tu cuarto.** La carpa no se muestra, así no se pierde la profundidad del espacio. El camión es mucho más pequeño.
- **El estante está a tu derecha**, de lado y de frente a ti, junto al borde cercano de la mesa y 15 cm más lejos que antes, con las cajas entre la rodilla y el pecho. Si a la derecha hay una pared o un mueble, se pone a la izquierda (y te avisa). El camión y su panel siempre van del lado contrario al estante.
- **Órdenes, no personas.** Las familias no aparecen: llegan sus órdenes como burbujas arriba, sobre la mesa, cada una con la foto de la familia (con sus caras), fotos de lo que necesita con cuántos, y el tiempo que les queda. Primero la que estás atendiendo, que lleva la cuenta de lo que ya está en su caja; luego las urgentes. No hay otro resumen del pedido.
- **El panel de recibir está a la altura de tus ojos**, a 60 cm a tu lado, del lado del camión.
- **Lo que falta flota sobre la caja del pedido**: cada insumo que aún falta, transparente, girando alrededor de la caja; desaparece al ponerlo.
- **Al entregar, la caja no se mueve**: se cierra, se le pone la cinta y hace un pop hasta desaparecer.
- **Todas las cajas tienen el mismo tamaño**, también la del pedido del tutorial.
- **La mesa azul solo está ocupada si de verdad queda algo** en la caja abierta; si es así, el aviso dice qué queda y lo devuelve a la caja.
- **Los carteles se leen**: no se encogen con el punto (que se ajusta al ancho de tu mesa); tienen su tamaño real, un poco más grande.
- **Los rayos de las manos solo aparecen cuando hacen falta**: al elegir la mesa, y después solo cuando apuntas a un botón o a algo que puedes tomar.
- Sin mesa en el escaneo, usa una virtual del tamaño de una mesa común y la coloca donde no choque con paredes ni muebles. Conviene haber escaneado el cuarto en las gafas (Ajustes › Espacio físico).

## Sin visor

En el botón **Probar en el computador**: mantén presionado un insumo o una caja para llevarlo, arrastra el fondo para mirar, W A S D para caminar, Q y E para girar y T para ver la lista de tareas. En el visor, la lista sale con A o X. Los botones de abajo cambian entre la vista de la persona, desde arriba y desde afuera.

## Inventario

Trabaja sobre el punto `demo-ar`, que no ven quienes donan y no cuenta en el Resumen. En desarrollo se queda en este navegador. Publicado, usa la pestaña **Demo AR** de la hoja: para crearla, pega `tools/google-sheets/Codigo.gs` en Apps Script, ejecuta `organizarHoja` y publica una nueva versión. Con `?hoja=local` no toca ninguna hoja.
