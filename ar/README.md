# NEXOS AR: un turno en el punto de acopio

Experiencia de realidad aumentada para Meta Quest 3: la persona es responsable de un centro de acopio en Cali durante un turno. Es un proyecto aparte de la web (IWSDK necesita otra versión de Three) y reutiliza sus modelos, datos e inventario.

```bash
npm install --prefix ar
npm run dev --prefix ar                # https://localhost:8081, para abrir desde el visor o con el emulador
npm run dev --prefix ar -- --mode http # http://localhost:8081, para probar en este computador
npm test --prefix ar                   # las reglas del turno, de las zonas y del anclaje, sin 3D
```

Esta carpeta, en la rama `ar1`, se publica en `/ar1/` (la de `main` sigue en `/ar/`).

## Zonas: dónde puede ir cada cosa

La aplicación no lee el límite (guardian) que la persona dibujó en las gafas, y el escaneo del cuarto no sabe qué mesas son suyas. Por eso el área se define en la aplicación, relativa a la mesa elegida, y se guarda en este navegador:

- **Área** (rojo): todo lo que está en el piso (estanterías, pilas, personas y sus caminos) queda entero dentro.
- **Mesas** (verde): las cajas solo se ponen sobre ellas, cada una entera sobre su mesa. Dos mesas juntas se marcan por separado.
- **Estanterías** (amarillo): solo sobre el piso de esa zona.

La primera vez, o con `?calibrar` en la dirección, después de elegir la mesa: (1) toca dos esquinas de cada mesa extra para cajas, o pellízcala; (2) señala el suelo y pellizca dos esquinas del área; (3) lo mismo para la zona de estanterías. En cada paso, un pellizco con las dos manos a la vez acepta lo dibujado. Si algo no cabe, el tablero lo dice y nada se pone en otro lugar; su botón vuelve a dibujar las zonas.

## Depuración

`?debug` (o la tecla G en el computador) dibuja el área, las mesas, las superficies que dio el visor (con su id y etiqueta), el piso ocupado, dónde se puso cada cosa, y un panel con lo que tiene cada mano, el estado real de la profundidad (concedida, datos en este cuadro, materiales ocultando) y del anclaje. Lo mismo en la consola: `nexosAR.report()`.

## Con el visor

Solo manos, sin controles. Al entrar, el visor marca las mesas que reconoce del cuarto: mira la tuya y pellízcala (o toca con un dedo dos esquinas opuestas de tu mesa y quédate quieto un momento en cada una). Las cajas están sobre las mesas de tus zonas; si no caben, en pilas en el piso del área. Pasa el dedo por la cinta (o pellizca rápido la caja) para abrirla: adentro está lo que trae. Todo se guarda en las cajas de colores de la zona de estanterías, cada una en su soporte. Lo que sueltas cae y se queda quieto; si se pierde, vuelve a su sitio. Una caja vacía se tira para desecharla. Las personas hacen fila a tu izquierda y pasan de a una a la ventanilla, en la punta izquierda de la mesa; cada pedido trae una caja verde y una orden impresa. Arma la caja, ciérrala juntando las dos aletas, pégale la orden encima y entrégala en la ventanilla. Mira el dorso de tu muñeca, como un reloj, para ver qué falta (no la palma: con la palma y un pellizco el visor abre su propio menú y recentra la vista). Se toma lo que está entre el pulgar y el índice (un punto verde entre los dedos avisa que hay algo al alcance); apuntando a algo lejano y pellizcando, viene a tu mano.
Funciones de IWSDK que usa: UIKitML (`public/ui/*.uikitml`), reconocimiento de planos y mallas, anclas (el turno se queda en su sitio aunque el visor recentre la vista), raycast al entorno, física Havok, acceso a la cámara (luz del cuarto) y oclusión por profundidad (cajas, insumos, estanterías y personas). El agarre con las manos es propio (`#handGrab` en `src/shift.js`), una cosa por mano; el agarre del SDK está apagado. Si la sesión termina, lo que estaba en la mano se suelta; al volver, se pellizca otra vez la mesa y el turno vuelve a ella, sin duplicarse.

## Sin visor

En el botón **Probar en el computador**: haz clic en una caja para abrirla, mantén presionado para llevar algo (con la rueda o R lo giras), arrastra el fondo para mirar, W A S D para caminar y T para ver la lista de tareas.
## Inventario

Trabaja sobre el punto `demo-ar`, que no ven quienes donan y no cuenta en el Resumen. En desarrollo se queda en este navegador. Publicado, usa la pestaña **Demo AR** de la hoja: para crearla, pega `tools/google-sheets/Codigo.gs` en Apps Script, ejecuta `organizarHoja` y publica una nueva versión. Con `?hoja=local` no toca ninguna hoja.
