# NEXOS AR: un turno en el punto de acopio

Experiencia de realidad aumentada para Meta Quest 3: la persona es responsable de un centro de acopio en Cali durante un turno. Es un proyecto aparte de la web (IWSDK necesita otra versión de Three) y reutiliza sus modelos, datos e inventario.

```bash
npm install --prefix ar
npm run dev --prefix ar                # https://localhost:8081, para abrir desde el visor o con el emulador
npm run dev --prefix ar -- --mode http # http://localhost:8081, para probar en este computador
npm test --prefix ar                   # las reglas del turno, sin 3D
```

## Con el visor

Solo manos, sin controles. Al entrar, el visor marca las mesas que reconoce del cuarto: mira la tuya y pellízcala (si no reconoce ninguna, toca con un dedo dos esquinas opuestas de tu mesa y quédate quieto un momento en cada una). La primera caja está sobre la mesa; las demás, en pilas en el piso a tu derecha y en otras superficies del cuarto. Pasa el dedo por la cinta (o pellizca rápido la caja) para abrirla: adentro está lo que trae. Todo se guarda en las cajas de colores que te rodean por la derecha, cada una en su soporte. Lo que sueltas cae y se queda quieto; si se pierde, vuelve a su sitio. Una caja vacía se tira para desecharla. Las personas hacen fila a tu izquierda y pasan de a una a la ventanilla, en la punta izquierda de la mesa; cada pedido trae una caja verde y una orden impresa. Arma la caja, ciérrala juntando las dos aletas, pégale la orden encima y entrégala en la ventanilla. Mira el dorso de tu muñeca, como un reloj, para ver qué falta (no la palma: con la palma y un pellizco el visor abre su propio menú y recentra la vista). Se toma lo que está entre el pulgar y el índice (un punto verde entre los dedos avisa que hay algo al alcance); apuntando a algo lejano y pellizcando, viene a tu mano.
Funciones de IWSDK que usa: UIKitML (`public/ui/*.uikitml`), reconocimiento de planos y mallas, raycast al entorno, física Havok, acceso a la cámara (luz del cuarto), oclusión por profundidad y agarre con las manos.

## Sin visor

En el botón **Probar en el computador**: haz clic en una caja para abrirla, mantén presionado para llevar algo (con la rueda o R lo giras), arrastra el fondo para mirar, W A S D para caminar y T para ver la lista de tareas.
## Inventario

Trabaja sobre el punto `demo-ar`, que no ven quienes donan y no cuenta en el Resumen. En desarrollo se queda en este navegador. Publicado, usa la pestaña **Demo AR** de la hoja: para crearla, pega `tools/google-sheets/Codigo.gs` en Apps Script, ejecuta `organizarHoja` y publica una nueva versión. Con `?hoja=local` no toca ninguna hoja.
