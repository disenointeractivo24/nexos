/**
 * NEXOS — inventario de los puntos de acopio en una hoja de Google.
 *
 * La hoja es a la vez la base de datos de la aplicación y un tablero que se
 * puede leer y editar a mano:
 *
 *   · "Resumen": una tabla insumo × punto de acopio, con colores.
 *   · Una pestaña por punto ("Centro", "Norte", "Oeste", "Oriente", "Sur"),
 *     con un insumo por fila.
 *
 * Solo la columna "Cantidad" se edita a mano. El estado, los colores, la fecha
 * y el resumen se recalculan solos, y la aplicación recoge el cambio en unos
 * segundos. La columna oculta "id" une cada fila con el insumo de la
 * aplicación, así que las filas se pueden reordenar sin romper nada.
 *
 * La aplicación no guarda ninguna credencial de Google: este script corre como
 * la persona dueña de la hoja y expone tres llamadas.
 *
 *   GET  ?action=read&point=<id>   → { ok, rows:[{ point,item,qty,cap,updatedAt,by }], queue }
 *   GET  ?action=all               → { ok, points:{ <id>: rows }, events }   (lo que ven los donantes)
 *   GET  ?action=aporte&code=<c>   → { ok, record } o { ok, transfer }   (seguimiento de un aporte)
 *   POST { action:'set', point, items:[{item,qty}], by }   (by:'donor' → Origen "Donación")
 *   POST { action:'donate', record }              un aporte nuevo (físico: Agendado; dinero: Recibido)
 *   POST { action:'receive', code, point }        el punto recibió un aporte físico → suma al inventario
 *   POST { action:'deliver', code, point }        las familias lo recogieron
 *   POST { action:'transfer', code, from, to, items }      un traslado sale del punto
 *   POST { action:'transferReceive', code, point }         y entra en el otro
 *
 * Los aportes y los traslados se anotan en las pestañas "Aportes" y "Traslados"
 * (se crean solas la primera vez que se usan).
 *
 * Cómo publicarlo:
 *   1. Extensiones → Apps Script. Pega este archivo y guarda.
 *   2. Arriba, elige la función "organizarHoja" y pulsa Ejecutar (una vez).
 *   3. Implementar → Administrar implementaciones → editar (lápiz) →
 *      Versión: "Nueva versión" → Implementar. La URL /exec no cambia.
 */

/* ---------------- catálogo ---------------- */

/** Mismo orden que el tablero de la aplicación. Los topes deben coincidir con src/data/inventory.js. */
var ITEMS = [
  { id: 'cans', label: 'Alimentos enlatados', category: 'Alimentos', unit: 'Lata', cap: 140 },
  { id: 'rice', label: 'Arroz', category: 'Alimentos', unit: 'Bolsa de 1 kg', cap: 112 },
  { id: 'milk', label: 'Leche', category: 'Alimentos', unit: 'Caja de 1 L', cap: 84 },
  { id: 'water', label: 'Agua', category: 'Agua', unit: 'Botella de 1,5 L', cap: 90 },
  { id: 'medicine', label: 'Medicinas', category: 'Medicinas', unit: 'Botiquín básico', cap: 21 },
  { id: 'soap', label: 'Jabón', category: 'Higiene', unit: 'Barra', cap: 113 },
  { id: 'hygieneKit', label: 'Kit de higiene', category: 'Higiene', unit: 'Kit', cap: 30 },
  { id: 'blanket', label: 'Cobija', category: 'Refugio', unit: 'Cobija', cap: 30 },
]

var POINTS = [
  { id: 'acopio-centro', tab: 'Centro', name: 'Punto de acopio Parque de San Fernando' },
  { id: 'acopio-norte', tab: 'Norte', name: 'Punto de acopio Parque La Flora' },
  { id: 'acopio-oeste', tab: 'Oeste', name: 'Punto de acopio Capilla de San Antonio' },
  { id: 'acopio-oriente', tab: 'Oriente', name: 'Punto de acopio Parque Longitudinal El Poblado' },
  { id: 'acopio-sur', tab: 'Sur', name: 'Punto de acopio Parroquia la Virgen Peregrina' },
]

/**
 * Mismos umbrales que la aplicación (src/data/inventory.js): crítico por debajo
 * del 30 % del tope, abastecido desde el 75 %. Las fórmulas los usan sin
 * decimales (cantidad × 10 < tope × 3), así funcionan en una hoja en español.
 */
function isCritical_(q, cap) { return q + '*10<' + cap + '*3' }
function isStocked_(q, cap) { return q + '*4>=' + cap + '*3' }
function stateFormula_(row) {
  var q = '$D' + row, cap = '$E' + row
  return '=IF(NOT(ISNUMBER(' + q + ')),"",IF(' + isCritical_(q, cap) + ',"Crítico",IF(NOT(' + isStocked_(q, cap) + '),"Estable","Abastecido")))'
}

/** De dónde vino el último cambio de una fila. */
var ORIGINS = ['App', 'Hoja', 'Donación', 'Traslado']

/**
 * Velocidad: cada llamada a Apps Script ya tarda cerca de un segundo en
 * arrancar, así que el script hace lo mínimo con la hoja. Las lecturas salen de
 * una copia en memoria (CacheService) que se renueva con cada cambio; una
 * edición a mano la borra al instante (onEdit), y por si acaso dura poco.
 */
var CACHE_SECONDS = 30
var LAYOUT_CHECK_SECONDS = 600

var SUMMARY_TAB = 'Resumen'
var LEGACY_TAB = 'inventario'
var LEGACY_KEPT = 'Datos anteriores'

/* Pestaña de cada punto: título en la fila 1, nota en la 2, títulos en la 3, insumos desde la 4. */
var HEAD_ROW = 3
var FIRST_ROW = 4
var HEADERS = ['Insumo', 'Categoría', 'Unidad', 'Cantidad', 'Tope', 'Estado', 'Actualizado', 'Origen', 'id']
var COL = { label: 1, category: 2, unit: 3, qty: 4, cap: 5, state: 6, at: 7, by: 8, id: 9 }
var WIDTH = HEADERS.length

/* Colores */
var NAVY = '#011E41'
var HEAD_BG = '#E8ECF1'
var RED_BG = '#F2D0D0'
var RED_FG = '#8A1F1F'
var GREEN_BG = '#D3EBDB'
var GREEN_FG = '#1E5B36'
var NOTE_FG = '#5F6368'
var DATE_FORMAT = 'd/m/yyyy h:mm'

/* ---------------- utilidades ---------------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function pointById_(id) {
  for (var i = 0; i < POINTS.length; i++) if (POINTS[i].id === String(id)) return POINTS[i]
  return null
}

function itemById_(id) {
  for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === String(id)) return ITEMS[i]
  return null
}

function clamp_(item, qty) {
  var n = Math.round(Number(qty) || 0)
  if (n < 0) n = 0
  if (n > item.cap) n = item.cap
  return n
}

/* ---------------- forma de la hoja ---------------- */

/**
 * Ordena la hoja: crea "Resumen" y una pestaña por punto, con títulos,
 * colores y fórmulas, y pasa a ellas lo que hubiera en la pestaña antigua
 * "inventario". Se puede ejecutar las veces que haga falta: conserva las
 * cantidades que ya estén en las pestañas de los puntos.
 */
function organizarHoja() {
  var lock = LockService.getScriptLock()
  lock.waitLock(30000)
  try {
    organize_()
  } finally {
    lock.releaseLock()
  }
}

function organize_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var legacy = readLegacy_(ss)

  for (var p = 0; p < POINTS.length; p++) {
    var point = POINTS[p]
    var kept = readZone_(ss.getSheetByName(point.tab)) || legacy[point.id] || {}
    buildZone_(ss, point, kept)
  }
  buildSummary_(ss)
  forget_()

  var old = ss.getSheetByName(LEGACY_TAB)
  if (old) {
    old.setName(ss.getSheetByName(LEGACY_KEPT) ? LEGACY_KEPT + ' ' + Date.now() : LEGACY_KEPT)
    old.hideSheet()
  }

  // el orden de las pestañas: Resumen y luego los puntos
  var order = [SUMMARY_TAB].concat(POINTS.map(function (pt) { return pt.tab }))
  for (var i = 0; i < order.length; i++) {
    ss.setActiveSheet(ss.getSheetByName(order[i]))
    ss.moveActiveSheet(i + 1)
  }
  ss.setActiveSheet(ss.getSheetByName(SUMMARY_TAB))

  // la hoja en blanco con la que nace un documento nuevo sobra
  var blank = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1')
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank)
  SpreadsheetApp.flush()
}

/** Si la hoja todavía no está ordenada, la ordena (la primera llamada de la aplicación lo hace sola). */
function ensure_() {
  var cache = CacheService.getScriptCache()
  if (cache.get('layout-ok')) return
  ensureLayout_()
  cache.put('layout-ok', '1', LAYOUT_CHECK_SECONDS)
}

function ensureLayout_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var ready = !!ss.getSheetByName(SUMMARY_TAB)
  for (var i = 0; ready && i < POINTS.length; i++) ready = !!ss.getSheetByName(POINTS[i].tab)
  if (ready) return
  organizarHoja()
}

/** La pestaña antigua: una fila por punto e insumo. → { punto: { insumo: { qty, at } } } */
function readLegacy_(ss) {
  var out = {}
  var sh = ss.getSheetByName(LEGACY_TAB)
  if (!sh || sh.getLastRow() < 2) return out
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues()
  for (var i = 0; i < values.length; i++) {
    var r = values[i]
    if (!r[0] || !r[1] || !itemById_(r[1])) continue
    var point = String(r[0])
    out[point] = out[point] || {}
    out[point][String(r[1])] = { qty: Number(r[2]) || 0, at: r[4] || null }
  }
  return out
}

/** Las cantidades de la pestaña de un punto, por id. null si la pestaña no existe. */
function readZone_(sh) {
  if (!sh) return null
  var out = {}
  var last = sh.getLastRow()
  if (last < FIRST_ROW) return out
  var values = sh.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, WIDTH).getValues()
  for (var i = 0; i < values.length; i++) {
    var r = values[i]
    var id = String(r[COL.id - 1] || '')
    if (!itemById_(id) || r[COL.qty - 1] === '' || r[COL.qty - 1] === null) continue
    out[id] = { qty: Number(r[COL.qty - 1]) || 0, at: r[COL.at - 1] || null, by: r[COL.by - 1] || '' }
  }
  return out
}

function buildZone_(ss, point, kept) {
  var sh = ss.getSheetByName(point.tab)
  if (sh) {
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (pr) { pr.remove() })
    sh.clear()
    sh.clearConditionalFormatRules()
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations().breakApart()
  } else {
    sh = ss.insertSheet(point.tab)
  }
  var n = ITEMS.length
  var last = FIRST_ROW + n - 1

  // título y nota
  sh.getRange(1, 1, 1, WIDTH - 1).merge()
    .setValue('Zona ' + point.tab + ' · ' + point.name)
    .setBackground(NAVY).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14)
    .setVerticalAlignment('middle')
  sh.setRowHeight(1, 36)
  sh.getRange(2, 1, 1, WIDTH - 1).merge()
    .setValue('Edita solo la columna Cantidad. El estado, los colores y el resumen se actualizan solos. Rojo: crítico (menos del 30 % del tope). Verde: abastecido (75 % o más).')
    .setFontColor(NOTE_FG).setFontStyle('italic').setFontSize(9).setWrap(true)
  sh.setRowHeight(2, 30)

  // títulos
  sh.getRange(HEAD_ROW, 1, 1, WIDTH).setValues([HEADERS])
    .setBackground(HEAD_BG).setFontColor(NAVY).setFontWeight('bold')
  sh.setRowHeight(HEAD_ROW, 28)

  // insumos: valores por un lado y fórmulas por otro (setFormulas no depende del idioma de la hoja)
  var rows = []
  var states = []
  for (var i = 0; i < n; i++) {
    var it = ITEMS[i]
    var k = kept[it.id]
    rows.push([
      it.label,
      it.category,
      it.unit,
      k ? clamp_(it, k.qty) : '',
      it.cap,
      '',
      k && k.at ? new Date(k.at) : '',
      k ? (ORIGINS.indexOf(k.by) >= 0 ? k.by : 'App') : '',
      it.id,
    ])
    states.push([stateFormula_(FIRST_ROW + i)])
  }
  var body = sh.getRange(FIRST_ROW, 1, n, WIDTH)
  body.setValues(rows)
  sh.getRange(FIRST_ROW, COL.state, n, 1).setFormulas(states)
  body.setVerticalAlignment('middle')
  sh.getRange(FIRST_ROW, COL.label, n, 1).setFontWeight('bold')
  sh.getRange(FIRST_ROW, COL.qty, n, 2).setHorizontalAlignment('center')
  sh.getRange(FIRST_ROW, COL.qty, n, 1).setFontWeight('bold').setFontSize(12)
  sh.getRange(FIRST_ROW, COL.state, n, 1).setHorizontalAlignment('center').setFontWeight('bold')
  sh.getRange(FIRST_ROW, COL.at, n, 1).setNumberFormat(DATE_FORMAT)
  for (var r = FIRST_ROW; r <= last; r++) sh.setRowHeight(r, 26)
  sh.getRange(HEAD_ROW, 1, n + 1, WIDTH - 1)
    .setBorder(true, true, true, true, true, true, '#C7CDD4', SpreadsheetApp.BorderStyle.SOLID)

  // solo números entre 0 y el tope en Cantidad
  for (var j = 0; j < n; j++) {
    sh.getRange(FIRST_ROW + j, COL.qty).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireNumberBetween(0, ITEMS[j].cap)
        .setAllowInvalid(false)
        .setHelpText('Un número entre 0 y ' + ITEMS[j].cap + '.')
        .build()
    )
  }

  // colores por estado, en toda la fila
  var area = sh.getRange(FIRST_ROW, 1, n, WIDTH - 1)
  var q = '$D' + FIRST_ROW, cap = '$E' + FIRST_ROW
  var red = '=AND(ISNUMBER(' + q + '),' + isCritical_(q, cap) + ')'
  var green = '=AND(ISNUMBER(' + q + '),' + isStocked_(q, cap) + ')'
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(red).setBackground(RED_BG).setFontColor(RED_FG).setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(green).setBackground(GREEN_BG).setFontColor(GREEN_FG).setRanges([area]).build(),
  ])

  // anchos, filas fijas y la columna técnica oculta
  var widths = [190, 110, 140, 95, 70, 110, 140, 80, 80]
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c])
  sh.setFrozenRows(HEAD_ROW)
  sh.hideColumns(COL.id)
  trimSheet_(sh, last, WIDTH)

  // un aviso (no un bloqueo) si alguien edita fuera de Cantidad
  var pr = sh.protect().setDescription('Solo la columna Cantidad se edita a mano')
  pr.setWarningOnly(true)
  pr.setUnprotectedRanges([sh.getRange(FIRST_ROW, COL.qty, n, 1)])
  return sh
}

function buildSummary_(ss) {
  var sh = ss.getSheetByName(SUMMARY_TAB)
  if (sh) {
    sh.clear()
    sh.clearConditionalFormatRules()
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart()
  } else {
    sh = ss.insertSheet(SUMMARY_TAB, 0)
  }
  var n = ITEMS.length
  var cols = 3 + POINTS.length
  var last = FIRST_ROW + n - 1

  sh.getRange(1, 1, 1, cols).merge()
    .setValue('Inventario de los puntos de acopio')
    .setBackground(NAVY).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14)
    .setVerticalAlignment('middle')
  sh.setRowHeight(1, 36)
  sh.getRange(2, 1, 1, cols).merge()
    .setValue('Cantidad de cada insumo en cada punto. Rojo: crítico (menos del 30 % del tope). Verde: abastecido (75 % o más). Para cambiar una cantidad, ve a la pestaña del punto.')
    .setFontColor(NOTE_FG).setFontStyle('italic').setFontSize(9).setWrap(true)
  sh.setRowHeight(2, 30)

  var head = ['Insumo', 'Categoría', 'Tope'].concat(POINTS.map(function (p) { return p.tab }))
  sh.getRange(HEAD_ROW, 1, 1, cols).setValues([head])
    .setBackground(HEAD_BG).setFontColor(NAVY).setFontWeight('bold').setHorizontalAlignment('center')
  sh.getRange(HEAD_ROW, 1, 1, 2).setHorizontalAlignment('left')
  sh.setRowHeight(HEAD_ROW, 28)

  var rows = []
  var looks = []
  for (var i = 0; i < n; i++) {
    var it = ITEMS[i]
    var row = FIRST_ROW + i
    rows.push([it.label, it.category, it.cap])
    var line = []
    for (var p = 0; p < POINTS.length; p++) {
      // por nombre de insumo, así sigue bien aunque alguien reordene las filas de un punto
      var ref = "'" + POINTS[p].tab + "'!$A$" + FIRST_ROW + ':$D$' + last
      line.push('=IFERROR(VLOOKUP($A' + row + ',' + ref + ',4,FALSE),"")')
    }
    looks.push(line)
  }
  sh.getRange(FIRST_ROW, 1, n, 3).setValues(rows)
  sh.getRange(FIRST_ROW, 4, n, POINTS.length).setFormulas(looks)
  sh.getRange(FIRST_ROW, 1, n, cols).setVerticalAlignment('middle')
  sh.getRange(FIRST_ROW, 1, n, 1).setFontWeight('bold')
  sh.getRange(FIRST_ROW, 3, n, cols - 2).setHorizontalAlignment('center')
  sh.getRange(FIRST_ROW, 4, n, POINTS.length).setFontWeight('bold').setFontSize(12)
  for (var r = FIRST_ROW; r <= last; r++) sh.setRowHeight(r, 26)

  // cuántos insumos críticos tiene cada punto
  var countRow = last + 1
  var count = []
  for (var c2 = 0; c2 < POINTS.length; c2++) {
    count.push("=COUNTIF('" + POINTS[c2].tab + "'!$F$" + FIRST_ROW + ':$F$' + last + ',"Crítico")')
  }
  sh.getRange(countRow, 1).setValue('Insumos en estado crítico')
  sh.getRange(countRow, 4, 1, POINTS.length).setFormulas([count])
  sh.getRange(countRow, 1, 1, cols).setBackground(HEAD_BG).setFontColor(NAVY).setFontWeight('bold')
  sh.getRange(countRow, 1, 1, 3).merge()
  sh.getRange(countRow, 4, 1, POINTS.length).setHorizontalAlignment('center')
  sh.setRowHeight(countRow, 28)

  sh.getRange(HEAD_ROW, 1, n + 2, cols)
    .setBorder(true, true, true, true, true, true, '#C7CDD4', SpreadsheetApp.BorderStyle.SOLID)

  var area = sh.getRange(FIRST_ROW, 4, n, POINTS.length)
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ISNUMBER(D' + FIRST_ROW + '),' + isCritical_('D' + FIRST_ROW, '$C' + FIRST_ROW) + ')')
      .setBackground(RED_BG).setFontColor(RED_FG).setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ISNUMBER(D' + FIRST_ROW + '),' + isStocked_('D' + FIRST_ROW, '$C' + FIRST_ROW) + ')')
      .setBackground(GREEN_BG).setFontColor(GREEN_FG).setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setFontColor(RED_FG).setRanges([sh.getRange(countRow, 4, 1, POINTS.length)]).build(),
  ])

  sh.setColumnWidth(1, 190)
  sh.setColumnWidth(2, 110)
  sh.setColumnWidth(3, 70)
  for (var c = 0; c < POINTS.length; c++) sh.setColumnWidth(4 + c, 95)
  sh.setFrozenRows(HEAD_ROW)
  trimSheet_(sh, countRow, cols)
  return sh
}

/** Quita las filas y columnas vacías de más, para que cada pestaña se vea como una tabla. */
function trimSheet_(sh, rows, cols) {
  var extraRows = sh.getMaxRows() - (rows + 2)
  if (extraRows > 0) sh.deleteRows(rows + 3, extraRows)
  var extraCols = sh.getMaxColumns() - cols
  if (extraCols > 0) sh.deleteColumns(cols + 1, extraCols)
}

/* ---------------- lectura y escritura ---------------- */

function zoneSheet_(point) {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  return ss.getSheetByName(point.tab)
}

/* ---------------- copia en memoria ---------------- */

function cacheKey_(point) {
  return 'rows:' + point.id
}

function remember_(point, rows) {
  try {
    CacheService.getScriptCache().put(cacheKey_(point), JSON.stringify(rows), CACHE_SECONDS)
  } catch (e) {}
}

/** Borra la copia de un punto (o de todos), para que la próxima lectura vaya a la hoja. */
function forget_(point) {
  try {
    var cache = CacheService.getScriptCache()
    if (point) cache.remove(cacheKey_(point))
    else cache.removeAll(POINTS.map(cacheKey_))
  } catch (e) {}
}

/** Las filas de un punto: de la memoria si están, de la hoja si no. */
function rowsFast_(point) {
  try {
    var hit = CacheService.getScriptCache().get(cacheKey_(point))
    if (hit) return JSON.parse(hit)
  } catch (e) {}
  var rows = rowsFor_(point)
  remember_(point, rows)
  return rows
}

/** Todos los puntos, pidiendo a la memoria todo de una vez. */
function allRowsFast_() {
  var hits = {}
  try {
    hits = CacheService.getScriptCache().getAll(POINTS.map(cacheKey_)) || {}
  } catch (e) {}
  var out = {}
  for (var i = 0; i < POINTS.length; i++) {
    var p = POINTS[i]
    var hit = hits[cacheKey_(p)]
    if (hit) out[p.id] = JSON.parse(hit)
    else {
      out[p.id] = rowsFor_(p)
      remember_(p, out[p.id])
    }
  }
  return out
}

/** Filas en el formato de la aplicación, desde los valores de la pestaña de un punto. */
function rowsFromBlock_(point, block) {
  var rows = []
  for (var i = 0; i < ITEMS.length; i++) {
    var it = ITEMS[i]
    for (var r = 0; r < block.length; r++) {
      var row = block[r]
      if (String(row[COL.id - 1]) !== it.id) continue
      var qty = row[COL.qty - 1]
      if (qty === '' || qty === null) continue
      var at = row[COL.at - 1]
      rows.push({
        point: point.id,
        item: it.id,
        qty: clamp_(it, qty),
        cap: it.cap,
        updatedAt: at ? new Date(at).toISOString() : null,
        by: row[COL.by - 1] || null,
      })
    }
  }
  return rows
}

function rowsFor_(point) {
  var sh = zoneSheet_(point)
  var data = readZone_(sh) || {}
  var rows = []
  for (var i = 0; i < ITEMS.length; i++) {
    var it = ITEMS[i]
    var d = data[it.id]
    if (!d) continue
    rows.push({
      point: point.id,
      item: it.id,
      qty: clamp_(it, d.qty),
      cap: it.cap,
      updatedAt: d.at ? new Date(d.at).toISOString() : null,
      by: d.by || null,
    })
  }
  return rows
}

/**
 * Escribe en bloque: una lectura y dos escrituras, cambien uno o todos los
 * insumos. Devuelve las filas tal como quedaron, sin volver a leer la hoja.
 */
function write_(point, items, origin) {
  var sh = zoneSheet_(point)
  var n = ITEMS.length
  var block = sh.getRange(FIRST_ROW, 1, n, WIDTH).getValues()
  var at = {}
  for (var r = 0; r < block.length; r++) at[String(block[r][COL.id - 1])] = r
  var now = new Date()
  var touched = false
  for (var i = 0; i < items.length; i++) {
    var it = itemById_(items[i].item)
    if (!it || at[it.id] === undefined) continue
    var row = block[at[it.id]]
    row[COL.qty - 1] = clamp_(it, items[i].qty)
    row[COL.at - 1] = now
    row[COL.by - 1] = origin
    touched = true
  }
  if (touched) {
    sh.getRange(FIRST_ROW, COL.qty, n, 1).setValues(block.map(function (row) { return [row[COL.qty - 1]] }))
    sh.getRange(FIRST_ROW, COL.at, n, 2).setValues(block.map(function (row) { return [row[COL.at - 1], row[COL.by - 1]] }))
  }
  return rowsFromBlock_(point, block)
}

/* ---------------- aportes y traslados ---------------- */

/**
 * Cada aporte y cada traslado queda como una fila, con su estado:
 *
 *   Aportes     Agendado → Recibido → Entregado   (en dinero: Recibido desde el principio)
 *   Traslados   En camino → Recibido
 *
 * Un aporte físico solo se suma al inventario del punto cuando el punto lo recibe
 * (escanea el QR o escribe el código). Un traslado sale del inventario del punto
 * que lo envía al enviarlo, y entra en el del otro cuando este lo recibe.
 *
 * Aquí no se guarda ningún dato personal (nombre, teléfono, correo): la URL /exec
 * es pública y cualquiera con un código puede ver el estado de ese aporte.
 */
var DONATIONS_TAB = 'Aportes'
var TRANSFERS_TAB = 'Traslados'
var DONATION_HEADERS = ['Código', 'Estado', 'Modo', 'Punto', 'Barrio', 'Insumos', 'Valor', 'Cita', 'Registrado', 'Recibido', 'Entregado', 'items']
var DCOL = { code: 1, state: 2, mode: 3, point: 4, barrio: 5, label: 6, value: 7, slot: 8, at: 9, received: 10, delivered: 11, items: 12 }
var TRANSFER_HEADERS = ['Código', 'Estado', 'Desde', 'Hacia', 'Insumos', 'Enviado', 'Recibido', 'items']
var TCOL = { code: 1, state: 2, from: 3, to: 4, label: 5, sent: 6, received: 7, items: 8 }
var DONATION_STATES = ['Agendado', 'Recibido', 'Entregado']
var TRANSFER_STATES = ['En camino', 'Recibido']
/** Lo que el mapa en vivo alcanza a mostrar: los últimos eventos, durante unos minutos. */
var EVENTS_KEEP = 40
var EVENTS_SECONDS = 900
/** Cuántas filas recientes lee el script para armar la lista de un punto. */
var RECENT_ROWS = 300

/** La pestaña de aportes o de traslados; la crea con su formato si no existe. */
function logSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sh = ss.getSheetByName(name)
  if (sh) return sh
  var donations = name === DONATIONS_TAB
  var headers = donations ? DONATION_HEADERS : TRANSFER_HEADERS
  sh = ss.insertSheet(name)
  sh.getRange(1, 1, 1, headers.length - 1).merge()
    .setValue(donations ? 'Aportes de los donantes' : 'Traslados entre puntos de acopio')
    .setBackground(NAVY).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14).setVerticalAlignment('middle')
  sh.setRowHeight(1, 36)
  sh.getRange(2, 1, 1, headers.length - 1).merge()
    .setValue(donations
      ? 'Una fila por aporte. La aplicación la escribe sola: un aporte físico queda Agendado y se suma al inventario cuando el punto lo recibe; en dinero entra Recibido. El punto marca Entregado cuando las familias lo recogen.'
      : 'Una fila por traslado. Sale del inventario del punto que lo envía al enviarlo, y entra en el del otro cuando este marca Recibido.')
    .setFontColor(NOTE_FG).setFontStyle('italic').setFontSize(9).setWrap(true)
  sh.setRowHeight(2, 30)
  sh.getRange(HEAD_ROW, 1, 1, headers.length).setValues([headers])
    .setBackground(HEAD_BG).setFontWeight('bold').setFontColor(NAVY)
  sh.setFrozenRows(HEAD_ROW)
  sh.hideColumns(headers.length)
  var dates = donations ? [DCOL.at, DCOL.received, DCOL.delivered] : [TCOL.sent, TCOL.received]
  for (var i = 0; i < dates.length; i++) sh.getRange(FIRST_ROW, dates[i], 1000, 1).setNumberFormat(DATE_FORMAT)
  if (donations) sh.getRange(FIRST_ROW, DCOL.value, 1000, 1).setNumberFormat('$#,##0')
  sh.setColumnWidth(donations ? DCOL.label : TCOL.label, 320)
  return sh
}

/** Busca una fila por su código. → { sh, row (número de fila), values } o null */
function findCode_(name, code) {
  var sh = logSheet_(name)
  var last = sh.getLastRow()
  if (last < FIRST_ROW) return null
  var width = name === DONATIONS_TAB ? DONATION_HEADERS.length : TRANSFER_HEADERS.length
  var found = sh.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, 1).createTextFinder(String(code)).matchEntireCell(true).findNext()
  if (!found) return null
  var row = found.getRow()
  return { sh: sh, row: row, values: sh.getRange(row, 1, 1, width).getValues()[0] }
}

/** Las filas más recientes de una pestaña (para las listas de un punto). */
function recentRows_(name) {
  var sh = logSheet_(name)
  var last = sh.getLastRow()
  if (last < FIRST_ROW) return []
  var first = Math.max(FIRST_ROW, last - RECENT_ROWS + 1)
  var width = name === DONATIONS_TAB ? DONATION_HEADERS.length : TRANSFER_HEADERS.length
  return sh.getRange(first, 1, last - first + 1, width).getValues()
}

/** { item: cantidad } limpio: solo insumos del catálogo y cantidades enteras positivas. */
function cleanItems_(items) {
  var out = {}
  for (var id in (items || {})) {
    var it = itemById_(id)
    var n = Math.round(Number(items[id]) || 0)
    if (it && n > 0) out[id] = Math.min(n, it.cap)
  }
  return out
}

function itemsLabel_(items) {
  var parts = []
  for (var i = 0; i < ITEMS.length; i++) {
    var it = ITEMS[i]
    if (items[it.id]) parts.push(items[it.id] + ' × ' + it.label)
  }
  return parts.join(', ')
}

function parseItems_(text) {
  try {
    return cleanItems_(JSON.parse(String(text || '{}')))
  } catch (e) {
    return {}
  }
}

function iso_(d) {
  return d ? new Date(d).toISOString() : null
}

function donationFromRow_(v) {
  return {
    code: String(v[DCOL.code - 1]),
    state: String(v[DCOL.state - 1]),
    mode: v[DCOL.mode - 1] === 'Dinero' ? 'money' : 'physical',
    point: String(v[DCOL.point - 1]),
    barrio: String(v[DCOL.barrio - 1]),
    items: parseItems_(v[DCOL.items - 1]),
    value: Number(v[DCOL.value - 1]) || 0,
    slot: String(v[DCOL.slot - 1] || ''),
    at: iso_(v[DCOL.at - 1]),
    receivedAt: iso_(v[DCOL.received - 1]),
    deliveredAt: iso_(v[DCOL.delivered - 1]),
  }
}

function transferFromRow_(v) {
  return {
    code: String(v[TCOL.code - 1]),
    state: String(v[TCOL.state - 1]),
    from: String(v[TCOL.from - 1]),
    to: String(v[TCOL.to - 1]),
    items: parseItems_(v[TCOL.items - 1]),
    at: iso_(v[TCOL.sent - 1]),
    receivedAt: iso_(v[TCOL.received - 1]),
  }
}

/** Lo que tiene un punto ahora: { item: cantidad } */
function stockOf_(point) {
  var out = {}
  var rows = rowsFor_(point)
  for (var i = 0; i < rows.length; i++) out[rows[i].item] = rows[i].qty
  return out
}

/** Suma (o resta, con cantidades negativas) al inventario de un punto. Devuelve sus filas. */
function addStock_(point, deltas, origin) {
  var now = stockOf_(point)
  var items = []
  for (var id in deltas) items.push({ item: id, qty: (now[id] || 0) + deltas[id] })
  var rows = write_(point, items, origin)
  remember_(point, rows)
  return rows
}

/** Anota un evento para el mapa en vivo de todos los dispositivos. */
function event_(kind, point, extra) {
  try {
    var cache = CacheService.getScriptCache()
    var list = JSON.parse(cache.get('events') || '[]')
    var e = { id: kind + ':' + (extra && extra.code ? extra.code : Date.now()), kind: kind, point: point.id, at: new Date().toISOString() }
    if (extra && extra.to) e.to = extra.to
    list.push(e)
    if (list.length > EVENTS_KEEP) list = list.slice(list.length - EVENTS_KEEP)
    cache.put('events', JSON.stringify(list), EVENTS_SECONDS)
  } catch (err) {}
}

function events_() {
  try {
    return JSON.parse(CacheService.getScriptCache().get('events') || '[]')
  } catch (e) {
    return []
  }
}

var CODE_RE = /^NX-[A-Z0-9]{4,8}$/

/** Un donante confirmó un aporte. Si el código ya existe, no se duplica. */
function donate_(body) {
  var r = body.record || {}
  var code = String(r.code || '').toUpperCase()
  if (!CODE_RE.test(code)) throw new Error('Código de aporte inválido')
  var point = pointById_(r.point)
  if (!point) throw new Error('Punto de acopio desconocido: ' + r.point)
  var items = cleanItems_(r.items)
  if (!Object.keys(items).length) throw new Error('El aporte no trae insumos')
  var existing = findCode_(DONATIONS_TAB, code)
  if (existing) return { record: donationFromRow_(existing.values) }

  var money = r.mode === 'money'
  var now = new Date()
  var sh = logSheet_(DONATIONS_TAB)
  var row = []
  row[DCOL.code - 1] = code
  row[DCOL.state - 1] = money ? 'Recibido' : 'Agendado'
  row[DCOL.mode - 1] = money ? 'Dinero' : 'Físico'
  row[DCOL.point - 1] = point.id
  row[DCOL.barrio - 1] = String(r.barrio || '').slice(0, 60)
  row[DCOL.label - 1] = itemsLabel_(items)
  row[DCOL.value - 1] = Math.max(0, Math.round(Number(r.value) || 0))
  row[DCOL.slot - 1] = String(r.slot || '').slice(0, 120)
  row[DCOL.at - 1] = now
  row[DCOL.received - 1] = money ? now : ''
  row[DCOL.delivered - 1] = ''
  row[DCOL.items - 1] = JSON.stringify(items)
  sh.appendRow(row)
  // en dinero, el equipo compra los insumos y quedan en el punto de una vez
  var rows = money ? addStock_(point, items, 'Donación') : null
  event_(money ? 'recibido' : 'aporte', point, { code: code })
  return { record: donationFromRow_(row), rows: rows }
}

/** El punto recibió un aporte físico (escaneó el QR o escribió el código). */
function receive_(body) {
  var code = String(body.code || '').toUpperCase().trim()
  var point = pointById_(body.point)
  if (!point) throw new Error('Punto de acopio desconocido: ' + body.point)
  var hit = findCode_(DONATIONS_TAB, code)
  if (!hit) throw new Error('No encontramos el aporte ' + code)
  var rec = donationFromRow_(hit.values)
  if (rec.point !== point.id) {
    var other = pointById_(rec.point)
    throw new Error('Este aporte es para ' + (other ? other.name : 'otro punto'))
  }
  if (rec.state !== 'Agendado') return { record: rec, already: true, rows: rowsFor_(point) }
  var now = new Date()
  hit.sh.getRange(hit.row, DCOL.state).setValue('Recibido')
  hit.sh.getRange(hit.row, DCOL.received).setValue(now)
  var rows = addStock_(point, rec.items, 'Donación')
  rec.state = 'Recibido'
  rec.receivedAt = now.toISOString()
  event_('recibido', point, { code: code })
  return { record: rec, rows: rows }
}

/** Las familias recogieron lo de un aporte. */
function deliver_(body) {
  var code = String(body.code || '').toUpperCase().trim()
  var point = pointById_(body.point)
  if (!point) throw new Error('Punto de acopio desconocido: ' + body.point)
  var hit = findCode_(DONATIONS_TAB, code)
  if (!hit) throw new Error('No encontramos el aporte ' + code)
  var rec = donationFromRow_(hit.values)
  if (rec.point !== point.id) throw new Error('Este aporte es de otro punto')
  if (rec.state === 'Entregado') return { record: rec, already: true }
  if (rec.state !== 'Recibido') throw new Error('Primero hay que recibir el aporte en el punto')
  var now = new Date()
  hit.sh.getRange(hit.row, DCOL.state).setValue('Entregado')
  hit.sh.getRange(hit.row, DCOL.delivered).setValue(now)
  rec.state = 'Entregado'
  rec.deliveredAt = now.toISOString()
  event_('entregado', point, { code: code })
  return { record: rec }
}

/** Un punto envía insumos a otro: salen de su inventario ya mismo, y quedan En camino. */
function transfer_(body) {
  var from = pointById_(body.from)
  var to = pointById_(body.to)
  if (!from || !to || from.id === to.id) throw new Error('Elige un punto de destino distinto')
  var want = cleanItems_(body.items)
  var have = stockOf_(from)
  var items = {}
  for (var id in want) if ((have[id] || 0) > 0) items[id] = Math.min(want[id], have[id])
  if (!Object.keys(items).length) throw new Error('No hay insumos para enviar')
  var code = String(body.code || '').toUpperCase()
  if (!/^TR-[A-Z0-9]{4,8}$/.test(code)) throw new Error('Código de traslado inválido')
  var existing = findCode_(TRANSFERS_TAB, code)
  if (existing) return { transfer: transferFromRow_(existing.values), rows: rowsFor_(from) }
  var minus = {}
  for (var k in items) minus[k] = -items[k]
  var rows = addStock_(from, minus, 'Traslado')
  var now = new Date()
  var row = []
  row[TCOL.code - 1] = code
  row[TCOL.state - 1] = 'En camino'
  row[TCOL.from - 1] = from.id
  row[TCOL.to - 1] = to.id
  row[TCOL.label - 1] = itemsLabel_(items)
  row[TCOL.sent - 1] = now
  row[TCOL.received - 1] = ''
  row[TCOL.items - 1] = JSON.stringify(items)
  logSheet_(TRANSFERS_TAB).appendRow(row)
  event_('traslado', from, { code: code, to: to.id })
  return { transfer: transferFromRow_(row), rows: rows }
}

/** El punto de destino recibió un traslado: entra a su inventario. */
function transferReceive_(body) {
  var code = String(body.code || '').toUpperCase().trim()
  var point = pointById_(body.point)
  if (!point) throw new Error('Punto de acopio desconocido: ' + body.point)
  var hit = findCode_(TRANSFERS_TAB, code)
  if (!hit) throw new Error('No encontramos el traslado ' + code)
  var t = transferFromRow_(hit.values)
  if (t.to !== point.id) throw new Error('Este traslado va para otro punto')
  if (t.state !== 'En camino') return { transfer: t, already: true, rows: rowsFor_(point) }
  var now = new Date()
  hit.sh.getRange(hit.row, TCOL.state).setValue('Recibido')
  hit.sh.getRange(hit.row, TCOL.received).setValue(now)
  var rows = addStock_(point, t.items, 'Traslado')
  t.state = 'Recibido'
  t.receivedAt = now.toISOString()
  event_('traslado-recibido', point, { code: code })
  return { transfer: t, rows: rows }
}

/** Consulta pública de un aporte o un traslado por su código. */
function lookup_(code) {
  code = String(code || '').toUpperCase().trim()
  if (/^TR-/.test(code)) {
    var t = findCode_(TRANSFERS_TAB, code)
    return t ? { transfer: transferFromRow_(t.values) } : null
  }
  var d = findCode_(DONATIONS_TAB, code)
  return d ? { record: donationFromRow_(d.values) } : null
}

/** Lo pendiente de un punto: aportes por recibir y por entregar, y traslados que llegan o salieron. */
function queue_(point) {
  var out = { scheduled: [], toDeliver: [], incoming: [], outgoing: [] }
  var ds = recentRows_(DONATIONS_TAB)
  for (var i = ds.length - 1; i >= 0; i--) {
    if (String(ds[i][DCOL.point - 1]) !== point.id) continue
    var st = String(ds[i][DCOL.state - 1])
    if (st === 'Agendado') out.scheduled.push(donationFromRow_(ds[i]))
    else if (st === 'Recibido') out.toDeliver.push(donationFromRow_(ds[i]))
  }
  var ts = recentRows_(TRANSFERS_TAB)
  for (var j = ts.length - 1; j >= 0; j--) {
    if (String(ts[j][TCOL.state - 1]) !== 'En camino') continue
    if (String(ts[j][TCOL.to - 1]) === point.id) out.incoming.push(transferFromRow_(ts[j]))
    else if (String(ts[j][TCOL.from - 1]) === point.id) out.outgoing.push(transferFromRow_(ts[j]))
  }
  return out
}

/** La lista de un punto, de la memoria si está (cada cambio de aportes o traslados la borra). */
function queueFast_(point) {
  var key = 'queue:' + point.id
  try {
    var hit = CacheService.getScriptCache().get(key)
    if (hit) return JSON.parse(hit)
  } catch (e) {}
  var q = queue_(point)
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(q), CACHE_SECONDS)
  } catch (e) {}
  return q
}

function forgetQueues_() {
  try {
    CacheService.getScriptCache().removeAll(POINTS.map(function (p) { return 'queue:' + p.id }))
  } catch (e) {}
}


function doGet(e) {
  try {
    ensure_()
    var action = (e && e.parameter && e.parameter.action) || 'read'
    if (action === 'all') return json_({ ok: true, points: allRowsFast_(), events: events_(), serverTime: new Date().toISOString() })
    if (action === 'aporte') {
      var found = lookup_(e.parameter.code)
      if (!found) return json_({ ok: false, notFound: true, error: 'No encontramos ese código' })
      found.ok = true
      found.serverTime = new Date().toISOString()
      return json_(found)
    }
    if (action !== 'read') return json_({ ok: false, error: 'Acción no soportada: ' + action })
    var point = pointById_(e.parameter.point)
    if (!point) return json_({ ok: false, error: 'Punto de acopio desconocido: ' + e.parameter.point })
    return json_({ ok: true, rows: rowsFast_(point), queue: queueFast_(point), serverTime: new Date().toISOString() })
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) })
  }
}

function doPost(e) {
  try {
    ensure_()
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) })
  }
  var lock = LockService.getScriptLock()
  try {
    // dos voluntarios pueden guardar al mismo tiempo; las escrituras van en fila
    lock.waitLock(20000)
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    var handlers = { donate: donate_, receive: receive_, deliver: deliver_, transfer: transfer_, transferReceive: transferReceive_ }
    if (handlers[body.action]) {
      var out = handlers[body.action](body)
      forgetQueues_()
      out.ok = true
      out.serverTime = new Date().toISOString()
      return json_(out)
    }
    if (body.action !== 'set') return json_({ ok: false, error: 'Acción no soportada: ' + body.action })
    var point = pointById_(body.point)
    if (!point) return json_({ ok: false, error: 'Punto de acopio desconocido: ' + body.point })
    var items = body.items || []
    if (body.item !== undefined) items = [{ item: body.item, qty: body.qty }]
    var rows = write_(point, items, body.by === 'donor' ? 'Donación' : 'App')
    // the other devices read this from memory on their next poll
    remember_(point, rows)
    return json_({ ok: true, rows: rows, serverTime: new Date().toISOString() })
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) })
  } finally {
    try {
      lock.releaseLock()
    } catch (e2) {}
  }
}

/**
 * Cuando alguien cambia una cantidad a mano en la pestaña de un punto, la
 * fila guarda cuándo y que vino de la hoja. (Disparador simple de Google.)
 */
function onEdit(e) {
  if (!e || !e.range) return
  var sh = e.range.getSheet()
  // a hand edit of a donation or a transfer: the points' lists are read again
  if (sh.getName() === DONATIONS_TAB || sh.getName() === TRANSFERS_TAB) return forgetQueues_()
  var zone = null
  for (var i = 0; i < POINTS.length; i++) if (POINTS[i].tab === sh.getName()) zone = POINTS[i]
  if (!zone) return
  // a hand edit: the app must read the sheet again, not its copy in memory
  forget_(zone)
  var r0 = e.range.getRow()
  var r1 = r0 + e.range.getNumRows() - 1
  var c0 = e.range.getColumn()
  var c1 = c0 + e.range.getNumColumns() - 1
  if (c0 > COL.qty || c1 < COL.qty) return
  var now = new Date()
  for (var r = Math.max(r0, FIRST_ROW); r <= r1; r++) {
    if (!sh.getRange(r, COL.id).getValue()) continue
    sh.getRange(r, COL.at, 1, 2).setValues([[now, 'Hoja']])
  }
}

/** El mensaje de un error, sin el "Error: " que le antepone Apps Script. */
function errorText_(err) {
  return String((err && err.message) || err).replace(/^Error:\s*/, '')
}
