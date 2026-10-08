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
 *   GET  ?action=read&point=<id>   → { ok, rows:[{ point,item,qty,cap,updatedAt,by }] }
 *   GET  ?action=all               → { ok, points:{ <id>: rows } }   (lo que ven los donantes)
 *   POST { action:'set', point, items:[{item,qty}], by }   (by:'donor' → Origen "Donación")
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
var ORIGINS = ['App', 'Hoja', 'Donación']

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

function write_(point, items, origin) {
  var sh = zoneSheet_(point)
  var last = sh.getLastRow()
  var ids = sh.getRange(FIRST_ROW, COL.id, Math.max(1, last - FIRST_ROW + 1), 1).getValues()
  var now = new Date()
  for (var i = 0; i < items.length; i++) {
    var it = itemById_(items[i].item)
    if (!it) continue
    var row = 0
    for (var r = 0; r < ids.length; r++) if (String(ids[r][0]) === it.id) row = FIRST_ROW + r
    if (!row) continue
    sh.getRange(row, COL.qty).setValue(clamp_(it, items[i].qty))
    sh.getRange(row, COL.at, 1, 2).setValues([[now, origin]])
  }
}

function doGet(e) {
  try {
    ensure_()
    var action = (e && e.parameter && e.parameter.action) || 'read'
    if (action === 'all') {
      var points = {}
      for (var i = 0; i < POINTS.length; i++) points[POINTS[i].id] = rowsFor_(POINTS[i])
      return json_({ ok: true, points: points, serverTime: new Date().toISOString() })
    }
    if (action !== 'read') return json_({ ok: false, error: 'Acción no soportada: ' + action })
    var point = pointById_(e.parameter.point)
    if (!point) return json_({ ok: false, error: 'Punto de acopio desconocido: ' + e.parameter.point })
    return json_({ ok: true, rows: rowsFor_(point), serverTime: new Date().toISOString() })
  } catch (err) {
    return json_({ ok: false, error: String(err) })
  }
}

function doPost(e) {
  try {
    ensure_()
  } catch (err) {
    return json_({ ok: false, error: String(err) })
  }
  var lock = LockService.getScriptLock()
  try {
    // dos voluntarios pueden guardar al mismo tiempo; las escrituras van en fila
    lock.waitLock(20000)
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    if (body.action !== 'set') return json_({ ok: false, error: 'Acción no soportada: ' + body.action })
    var point = pointById_(body.point)
    if (!point) return json_({ ok: false, error: 'Punto de acopio desconocido: ' + body.point })
    var items = body.items || []
    if (body.item !== undefined) items = [{ item: body.item, qty: body.qty }]
    write_(point, items, body.by === 'donor' ? 'Donación' : 'App')
    SpreadsheetApp.flush()
    return json_({ ok: true, rows: rowsFor_(point), serverTime: new Date().toISOString() })
  } catch (err) {
    return json_({ ok: false, error: String(err) })
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
  var isZone = false
  for (var i = 0; i < POINTS.length; i++) if (POINTS[i].tab === sh.getName()) isZone = true
  if (!isZone) return
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
