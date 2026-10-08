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
4. La URL `/exec` va en `starter/.env`:

   ```
   VITE_SHEETS_URL=https://script.google.com/macros/s/XXXXXXXX/exec
   ```

   Reinicia `npm run dev` después de cambiarla. Para probar sin tocar el
   `.env`, abre la aplicación con `?hoja=<URL>` al final de la dirección.

## Qué lee y escribe la aplicación

- El tablero de un punto lee y escribe su pestaña.
- Los donantes leen todos los puntos a la vez. Lo que se le muestra a un
  donante es exactamente la hoja: «Se necesitan» es tope − cantidad, insumo por
  insumo; el nivel de la zona y los «Faltan» del mapa salen del estado de sus
  insumos; y «Urgente» es lo que está en crítico.
- Cuando un donante confirma un aporte, se suma a la cantidad del punto
  (Origen: `Donación`), así que el tablero del punto, la hoja y el siguiente
  donante lo ven a la vez.

## Tiempo real

La aplicación consulta la hoja cada 7 segundos y envía cada cambio en cuanto se
deja de pulsar. Dos personas en dispositivos distintos convergen en unos
segundos. Apps Script pone en fila las escrituras con `LockService`, así que dos
guardados al mismo tiempo no se pisan.

Sin `VITE_SHEETS_URL` la aplicación funciona igual, guardando el inventario en
el navegador. El tablero solo avisa si la conexión con la hoja falla dos veces
seguidas.

## Límites

Es el patrón sin servidor de Apps Script, pensado para un prototipo y para un
puñado de puntos de acopio. Hay cuotas diarias de ejecución y la URL `/exec` es
pública: cualquiera que la tenga puede leer y escribir el inventario. Para un
despliegue real hay que poner una clave por punto y validarla en el script, o
mover esto a un servidor propio.
