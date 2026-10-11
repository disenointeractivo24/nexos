# Inventario en una hoja de Google

El tablero de cada punto de acopio y lo que ven los donantes salen de una sola
hoja de cálculo de Google. La hoja es la base de datos y, a la vez, un tablero
que se puede leer y editar a mano. El navegador nunca guarda una credencial de
Google.

## Cómo queda la hoja

- **Resumen**: una tabla con un insumo por fila y un punto de acopio por
  columna (Centro, Norte, Oeste, Oriente, Sur), y al final cuántos insumos
  críticos tiene cada punto.
- **Una pestaña por punto** (Centro, Norte, Oeste, Oriente, Sur):

  | Insumo | Categoría | Unidad | Cantidad | Tope | Estado | Actualizado | Origen |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Alimentos enlatados | Alimentos | Lata | 0 | 140 | Crítico | 7/10/2026 22:07 | App |
  | Arroz | Alimentos | Bolsa de 1 kg | 105 | 112 | Abastecido | 7/10/2026 22:06 | App |

Las filas se pintan de **rojo** cuando el insumo está en crítico (menos del 30 %
del tope) y de **verde** cuando está abastecido (75 % o más). Son los mismos
umbrales que usa la aplicación.

Solo se edita a mano la columna **Cantidad**. El estado, los colores, la fecha
y el resumen se recalculan solos, y la aplicación recoge el cambio en unos
segundos. La columna **Origen** dice de dónde vino el último cambio: `App` (el
tablero del punto), `Hoja` (alguien la editó a mano) o `Donación` (un donante
confirmó un aporte). Una columna oculta, `id`, une cada fila con el insumo de
la aplicación, así que las filas se pueden reordenar sin romper nada.

- **Aportes**: una fila por aporte de un donante, con su código (`NX-…`), su
  estado, el punto, lo que trae, el valor y la franja en que lo llevará.

  | Estado | Qué significa |
  | --- | --- |
  | Agendado | Un aporte para llevar en persona. Todavía **no** cuenta en el inventario. |
  | Recibido | El punto lo recibió: escaneó su QR o escribió el código. Ahí se suma al inventario. Un aporte en dinero entra ya Recibido, porque el equipo compra los insumos. |
  | Entregado | Las familias lo recogieron. El punto lo marca en su tablero. |
  | Cancelado | El donante ya no lo lleva y lo canceló desde «Sigue tu aporte». El punto deja de esperarlo. |

  Si el punto se equivoca, puede **deshacer** desde el aviso que aparece: un aporte
  recibido vuelve a Agendado (y sale del inventario), uno entregado vuelve a Recibido.

- **Traslados**: una fila por envío de un punto a otro (`TR-…`). Sale del
  inventario del punto que lo envía en cuanto se envía, queda **En camino**, y
  entra en el inventario del otro punto cuando este lo marca **Recibido**. Mientras
  sigue en camino, el punto que lo envió puede anularlo (**Cancelado**) y los
  insumos vuelven a su inventario.

Estas dos pestañas se crean solas la primera vez que se usan, y la aplicación
las escribe sola. No se guarda ningún dato personal (ni nombre ni teléfono):
cualquiera que tenga un código puede ver el estado de ese aporte, y nada más.

## Instalarlo o actualizarlo

1. Abre la hoja y entra a **Extensiones → Apps Script**. Borra lo que haya, pega
   todo `Codigo.gs` y guarda.
2. Arriba, en la lista de funciones, elige **organizarHoja** y pulsa
   **Ejecutar**. La primera vez pide permisos: acéptalos. Esto crea las
   pestañas con su formato y pasa a ellas los datos de la pestaña antigua
   `inventario`, que queda oculta como «Datos anteriores». Se puede volver a
   ejecutar cuando quieras: conserva las cantidades.
3. **Implementar → Administrar implementaciones →** lápiz (editar) **→ Versión:
   Nueva versión → Implementar**. Así la URL `/exec` no cambia.
   (Si es la primera vez: Implementar → Nueva implementación → Aplicación web,
   *Ejecutar como*: Yo, *Quién tiene acceso*: Cualquier usuario.)
4. La URL `/exec` va en dos archivos de `starter/`:

   - `.env` — la usa `npm run dev` en tu computador (no se sube a GitHub).
   - `.env.production` — la usa el sitio publicado en GitHub Pages. Este sí se
     sube: sin él, la versión publicada no sabría dónde está la hoja.

   ```
   VITE_SHEETS_URL=https://script.google.com/macros/s/XXXXXXXX/exec
   ```

   Reinicia `npm run dev` después de cambiarla. Para probar sin tocar el
   `.env`, abre la aplicación con `?hoja=<URL>` al final de la dirección.

   Mientras actualices el script con «Administrar implementaciones → Nueva
   versión», la URL no cambia y no hay que tocar nada más.

### Al actualizar a la versión con aportes y traslados

Basta con los pasos 1 y 3: pegar el `Codigo.gs` nuevo y publicar una **nueva
versión** de la implementación existente. La URL no cambia y no hay que tocar los
`.env`. No hace falta volver a ejecutar `organizarHoja`: las pestañas
«Aportes» y «Traslados» aparecen con el primer aporte.

Si la aplicación nueva llega a usarse antes de actualizar el script, nada se
rompe: los aportes se suman al inventario como antes. Solo falta el seguimiento,
y quien busque su código verá que todavía no está activo.

## Qué lee y escribe la aplicación

- El tablero de un punto lee y escribe su pestaña.
- Los donantes leen todos los puntos a la vez. Lo que se le muestra a un
  donante es exactamente la hoja: «Se necesitan» es tope − cantidad, insumo por
  insumo; el nivel de la zona y los «Faltan» del mapa salen del estado de sus
  insumos; y «Urgente» es lo que está en crítico.
- Cuando un donante confirma un aporte, queda en «Aportes». Si es en dinero, se
  suma de una vez a la cantidad del punto (Origen: `Donación`). Si lo lleva en
  persona, se suma cuando el punto lo recibe. Así el tablero del punto, la hoja y
  el siguiente donante lo ven a la vez.
- Un traslado resta del punto que lo envía y suma al que lo recibe (Origen:
  `Traslado`).
- La lectura de un punto trae también su lista de pendientes: aportes por
  recibir y por entregar, y traslados que le llegan o que envió.
- La lectura de todos los puntos trae los últimos aportes y traslados, para el
  mapa en vivo.
- `?action=aporte&code=NX-…` devuelve el estado de un aporte. Es lo que abre el
  QR de cada aporte.

## Tiempo real

La aplicación consulta la hoja cada 7 segundos y envía cada cambio en cuanto se
deja de pulsar. Dos personas en dispositivos distintos convergen en unos
segundos. Apps Script pone en fila las escrituras con `LockService`, así que dos
guardados al mismo tiempo no se pisan.

Ningún cambio se pierde:

- Si no hay conexión, el cambio se guarda en el navegador (como pendiente) y se
  envía en cuanto la hoja responde, incluso si la pestaña se cerró y se abrió
  otro día.
- Al cerrar la pestaña con algo pendiente, se envía en ese momento
  (`sendBeacon`).
- Si mientras tanto alguien cambió ese insumo en la hoja o en otro dispositivo,
  gana el cambio más reciente.
- Con la pestaña en segundo plano la aplicación consulta la hoja cada minuto en
  vez de cada 7 segundos (Apps Script tiene cuotas diarias), y se pone al día
  al volver.

Sin `VITE_SHEETS_URL` la aplicación funciona igual, guardando el inventario en
el navegador. El tablero solo avisa si la conexión con la hoja falla dos veces
seguidas.

## Límites

Es el patrón sin servidor de Apps Script, pensado para un prototipo y para un
puñado de puntos de acopio. Hay cuotas diarias de ejecución y la URL `/exec` es
pública: cualquiera que la tenga puede leer y escribir el inventario. Para un
despliegue real hay que poner una clave por punto y validarla en el script, o
mover esto a un servidor propio.
