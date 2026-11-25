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
- **Estás dentro de la carpa.** La carpa del punto de acopio te rodea a ti y a tu mesa: se escala a partir del ancho de la mesa y nunca queda con el techo a menos de 55 cm por encima de tus ojos. Está girada: su letrero «Centro de Acopio» queda a tu espalda, para no tapar los carteles de la mesa. Se ocultan su escritorio y sus cajas apiladas, porque los reemplazan tu mesa y el estante. El camión, pequeño, se para a 1,2 m de ti, justo detrás del panel de recibir, del lado contrario al estante.
- **El estante está a tu derecha**, de lado y de frente a ti, junto al borde cercano de la mesa y 15 cm más lejos que antes, con las cajas entre la rodilla y el pecho. Si a la derecha hay una pared o un mueble, se pone a la izquierda (y te avisa). El camión y su panel siempre van del lado contrario al estante.
- **Órdenes, no personas.** Las familias no aparecen: llegan sus órdenes como burbujas arriba, sobre la mesa, cada una con la foto de la familia (con sus caras), fotos de lo que necesita con cuántos, y el tiempo que les queda. Primero la que estás atendiendo, que lleva la cuenta de lo que ya está en su caja; luego las urgentes. No hay otro resumen del pedido.
- **El panel de recibir está a la altura de tus ojos**, a 60 cm a tu lado, del lado del camión.
- **Un turno más abrumador.** Llegan 12 órdenes (3 urgentes), cada vez más seguido: de una cada 35 s al principio a una cada 15 s al final, con menos paciencia. El camión vuelve cada 30 s. Las burbujas van en filas de 4; si la fila se llena, la siguiente aparece encima.
- **Ves tus manos donde trabajas.** Las gafas miden la profundidad del cuarto, y lo que tocas con las manos (las cajas, la estantería y sus canastas, los insumos, la caja del pedido, los botones, el panel de recibir, y la mesa y sus tapetes debajo de ellos) se oculta donde algo real está delante. La mesa virtual está 2 cm por encima de la real, y ella y sus tapetes cuentan 5 cm más cerca, para no parpadear contra la mesa real. El piso, la carpa, los carteles, las burbujas y el camión nunca se transparentan. Cada objeto con oclusión tiene sus propios materiales, así no la pierde cuando otro que los compartía desaparece.
- **Nítido.** Oclusión `MinMaxSoftOcclusion` (bordes suaves que siguen el contorno de la mano, sin halo ni escalones), sin renderizado foveado y con un 20 % más de resolución que la de fábrica del visor. Lo impreso sobre las cajas se dibuja siempre después de ellas, así no parpadea.
- **Eliges a quién atender con el rayo.** Apunta a la burbuja de una orden y pellizca (o aprieta el gatillo): esa familia pasa al mostrador, y quien estaba vuelve a la fila guardando lo que ya tenía en su caja (apartado para ella; al volver a atenderla, su caja reaparece con eso y su burbuja muestra la cuenta). El rayo solo aparece al apuntar a una burbuja; lo demás se toma con la mano. Ya no está el botón verde de «Que pase el siguiente».
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
