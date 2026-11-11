# NEXOS AR: un turno en el punto de acopio

Experiencia de realidad aumentada para Meta Quest 3: la persona es responsable de un centro de acopio en Cali durante un turno. Es un proyecto aparte de la web (IWSDK necesita otra versión de Three) y reutiliza sus modelos, datos e inventario.

```bash
npm install --prefix ar
npm run dev --prefix ar                # https://localhost:8081, para abrir desde el visor o con el emulador
npm run dev --prefix ar -- --mode http # http://localhost:8081, para probar en este computador
npm test --prefix ar                   # las reglas del turno, sin 3D
```

## Con el visor

Solo manos, sin controles. Al entrar, el visor marca las mesas que reconoce del cuarto: mira la tuya y pellízcala (si no hay ninguna, se pone una mesa virtual a la altura de tus manos). Las cajas donadas ya están en pilas en el piso, a los lados y de tu lado de la mesa, y en otras superficies del cuarto. Pasa el dedo por la cinta (o pellizca rápido la caja) para abrirla. Lo de comer y el agua van al estante de la izquierda; medicinas, higiene y abrigo, al de la derecha. Gira la muñeca hacia tus ojos para ver qué falta. Para entregar, pásale la caja verde a la familia por encima de la mesa.

Funciones de IWSDK que usa: UIKitML (`public/ui/*.uikitml`), reconocimiento de planos y mallas, raycast al entorno, física Havok, acceso a la cámara (luz del cuarto), oclusión por profundidad y agarre con las manos.

## Sin visor

En el botón **Probar en el computador**: haz clic en una caja para abrirla, mantén presionado para llevar algo (con la rueda o R lo giras), arrastra el fondo para mirar, W A S D para caminar y T para ver la lista de tareas.
## Inventario

Trabaja sobre el punto `demo-ar`, que no ven quienes donan y no cuenta en el Resumen. En desarrollo se queda en este navegador. Publicado, usa la pestaña **Demo AR** de la hoja: para crearla, pega `tools/google-sheets/Codigo.gs` en Apps Script, ejecuta `organizarHoja` y publica una nueva versión. Con `?hoja=local` no toca ninguna hoja.
