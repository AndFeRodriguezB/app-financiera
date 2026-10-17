/**
 * RepositorioMovimientos.gs
 * Responsabilidad única: toda la lectura/escritura de la hoja "Movimientos"
 * (que reemplaza a "LOGS"). Es el único archivo del proyecto que conoce el
 * nombre de sus columnas y su orden físico.
 *
 * Estructura:
 *   ID_Movimiento | Fecha | ID_Usuario | ID_Usuario_Pagador | ID_Cuenta |
 *   Tipo_Gasto | ID_Categoria | ID_Subcategoria | Valor | Descripcion
 *
 * Un movimiento almacena IDs, nunca nombres. Los nombres se resuelven contra
 * los catálogos en la capa API, solo para presentación.
 * TODOS los IDs son ENTEROS positivos (1, 2, 3, ...). Lo que llegue como texto
 * (p. ej. el value de un <select>) se convierte con aEnteroId_() antes de validar
 * y escribir; en la hoja siempre quedan números.
 *
 * Modelo devuelto (el mismo que se recibe al insertar/actualizar):
 *   { id, fecha ('AAAA-MM-DD'), idUsuario, idUsuarioPagador, idCuenta,
 *     tipoGasto ('Propio'|'Compartido'), idCategoria, idSubcategoria (int | null
 *     si el movimiento no tiene subcategoría), valor (número), descripcion }
 *
 * Decisiones heredadas del repositorio anterior (LOGS) que se conservan:
 *  - FECHA como texto plano "AAAA-MM-DD": la celda se fuerza a formato "@"
 *    ANTES de escribir, para que Sheets no la reinterprete según el locale.
 *  - Historial paginado: más reciente primero (fecha desc, luego ID desc).
 *
 * Mejoras de esta fase:
 *  - Columnas por NOMBRE de encabezado (no por posición) y una sola lectura
 *    getDataRange().getValues() por operación.
 *  - IDs de movimiento generados bajo LockService y sin reutilización, aun si
 *    se elimina el último registro. Se lee solo la columna de IDs.
 *  - Escritura en bloque (insertarMovimientosEnBloque_) para la migración.
 *
 * La lectura de LOGS (estructura antigua) vive ahora en Migracion.js.
 */

const HOJA_MOVIMIENTOS_ = 'Movimientos';

const ESQUEMA_MOVIMIENTOS_ = {
  hoja: HOJA_MOVIMIENTOS_,
  clavePrimaria: 'id',
  columnas: [
    { clave: 'id', encabezado: 'ID_Movimiento', tipo: 'id' },
    { clave: 'fecha', encabezado: 'Fecha', tipo: 'fecha' },
    { clave: 'idUsuario', encabezado: 'ID_Usuario', tipo: 'id' },
    { clave: 'idUsuarioPagador', encabezado: 'ID_Usuario_Pagador', tipo: 'id' },
    { clave: 'idCuenta', encabezado: 'ID_Cuenta', tipo: 'id' },
    { clave: 'tipoGasto', encabezado: 'Tipo_Gasto', tipo: 'tipoGasto' },
    { clave: 'idCategoria', encabezado: 'ID_Categoria', tipo: 'id' },
    { clave: 'idSubcategoria', encabezado: 'ID_Subcategoria', tipo: 'id' },
    { clave: 'valor', encabezado: 'Valor', tipo: 'valor' },
    { clave: 'descripcion', encabezado: 'Descripcion', tipo: 'textoLibre' }
  ]
};

const CLAVE_CONTADOR_MOVIMIENTO_ = 'MOVIMIENTO';
const CLAVES_TEXTO_MOVIMIENTOS_ = ['fecha'];
// Campos que puede cambiar una edición. idUsuario (quien registró) e id no cambian.
const CAMPOS_EDITABLES_MOVIMIENTO_ = ['fecha', 'idUsuarioPagador', 'idCuenta', 'tipoGasto', 'idCategoria', 'idSubcategoria', 'valor', 'descripcion'];
// El primer ID emitido en una hoja vacía es 123 (mismo punto de partida que el repositorio anterior).
const ID_MINIMO_PREVIO_MOVIMIENTO_ = 122;

function movimientoDeFila_(fila) {
  return {
    id: fila.id,
    fecha: fila.fecha,
    idUsuario: fila.idUsuario,
    idUsuarioPagador: fila.idUsuarioPagador,
    idCuenta: fila.idCuenta,
    tipoGasto: fila.tipoGasto,
    idCategoria: fila.idCategoria,
    idSubcategoria: fila.idSubcategoria,
    valor: fila.valor,
    descripcion: fila.descripcion
  };
}

const CLAVES_ID_REQUERIDAS_MOVIMIENTO_ = ['idUsuario', 'idUsuarioPagador', 'idCuenta', 'idCategoria'];

/**
 * Convierte a ENTERO los IDs que lleguen como texto. Un ID requerido inválido
 * queda en null; idSubcategoria vacío queda en null y uno inválido en NaN
 * (verificarMovimientoEscribible_ los rechaza; nunca se "arreglan" en silencio).
 */
function normalizarIdsMovimiento_(m) {
  const r = Object.assign({}, m);
  ['id'].concat(CLAVES_ID_REQUERIDAS_MOVIMIENTO_).forEach(k => { if (k in r) r[k] = aEnteroId_(r[k]); });
  if ('idSubcategoria' in r) r.idSubcategoria = aEnteroIdOpcional_(r.idSubcategoria);
  return r;
}

/** Integridad estructural mínima antes de escribir (las reglas de negocio las valida la API). */
function verificarMovimientoEscribible_(m) {
  const faltan = CLAVES_ID_REQUERIDAS_MOVIMIENTO_.filter(k => !esIdValido_(m[k]));
  if (faltan.length) throw new Error('Movimiento incompleto o con IDs que no son enteros positivos: ' + faltan.join(', '));
  if (!(m.idSubcategoria === null || m.idSubcategoria === undefined || esIdValido_(m.idSubcategoria))) {
    throw new Error('idSubcategoria debe ser un entero positivo o estar vacío.');
  }
  if (!esFechaISOValida_(m.fecha)) {
    throw new Error('Fecha inválida; se esperaba una fecha real en formato AAAA-MM-DD.');
  }
  if (typeof m.valor !== 'number' || !isFinite(m.valor)) throw new Error('El valor del movimiento debe ser numérico.');
}

function leerMovimientosConFila_() {
  const tabla = leerTablaEsquema_(ESQUEMA_MOVIMIENTOS_);
  tabla.movimientos = tabla.filas
    .filter(f => tieneClavePrimaria_(ESQUEMA_MOVIMIENTOS_, f))
    .map(f => Object.assign({ _fila: f._fila }, movimientoDeFila_(f)));
  return tabla;
}

function obtenerTodosLosMovimientos_() {
  return leerMovimientosConFila_().movimientos.map(quitarFila_);
}

function obtenerMovimientosPorMes_(mes, anio) {
  return obtenerTodosLosMovimientos_().filter(m => perteneceAlMes_(m.fecha, mes, anio));
}

/** Historial paginado: más reciente primero. */
function obtenerMovimientosPaginados_(desde, cantidad) {
  const todos = obtenerTodosLosMovimientos_()
    .filter(m => !!m.fecha)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);

  return {
    movimientos: todos.slice(desde, desde + cantidad),
    hayMas: (desde + cantidad) < todos.length,
    total: todos.length
  };
}

function buscarMovimientoPorId_(id) {
  const buscado = aEnteroId_(id);
  if (buscado === null) return null;
  const m = leerMovimientosConFila_().movimientos.find(x => x.id === buscado);
  return m ? quitarFila_(m) : null;
}

/** Crea la hoja Movimientos con sus encabezados si aún no existe (no toca una existente). */
function crearHojaMovimientos_() {
  return crearHojaVaciaDeEsquema_(ESQUEMA_MOVIMIENTOS_);
}

/**
 * Inserta un movimiento nuevo. El ID lo genera este repositorio (dentro de un
 * bloqueo, sin reutilización). `datos` NO debe traer `id`.
 */
function insertarMovimiento_(datos) {
  const modelo = normalizarIdsMovimiento_(movimientoDeFila_(Object.assign({ descripcion: '' }, datos)));
  modelo.tipoGasto = convertirCelda_(modelo.tipoGasto, 'tipoGasto');
  modelo.valor = typeof modelo.valor === 'number' ? modelo.valor : Number(modelo.valor);
  verificarMovimientoEscribible_(modelo);

  return conBloqueo_(() => {
    const tabla = abrirTabla_(ESQUEMA_MOVIMIENTOS_);
    const ids = leerColumna_(tabla, 'id');
    modelo.id = reservarIdSecuencial_(CLAVE_CONTADOR_MOVIMIENTO_, ids, ID_MINIMO_PREVIO_MOVIMIENTO_);
    agregarFilasAlFinal_(tabla, [construirFilaDesdeModelo_(tabla, modelo)], CLAVES_TEXTO_MOVIMIENTOS_);
    return modelo;
  });
}

/**
 * Inserta muchos movimientos CON ID PROPIO (migración desde LOGS) en un solo
 * setValues. Rechaza todo el lote si algún ID ya existe o se repite.
 */
function insertarMovimientosEnBloque_(modelosEntrada) {
  if (!modelosEntrada.length) return { escritos: 0 };
  const modelos = modelosEntrada.map(m => normalizarIdsMovimiento_(movimientoDeFila_(m)));
  modelos.forEach(m => {
    if (!esIdValido_(m.id)) throw new Error('Cada movimiento del lote necesita un ID entero positivo.');
    verificarMovimientoEscribible_(m);
  });

  return conBloqueo_(() => {
    const tabla = abrirTabla_(ESQUEMA_MOVIMIENTOS_);
    const existentes = new Set(leerColumna_(tabla, 'id').map(aEnteroId_).filter(v => v !== null));
    const vistos = new Set();
    const repetidos = [];
    modelos.forEach(m => {
      if (existentes.has(m.id) || vistos.has(m.id)) repetidos.push(m.id);
      vistos.add(m.id);
    });
    if (repetidos.length) throw new Error('IDs de movimiento ya existentes o repetidos en el lote: ' + repetidos.slice(0, 20).join(', '));

    const filas = modelos.map(m => construirFilaDesdeModelo_(tabla, movimientoDeFila_(m)));
    agregarFilasAlFinal_(tabla, filas, CLAVES_TEXTO_MOVIMIENTOS_);

    const maxId = Math.max.apply(null, modelos.map(m => m.id).concat(Array.from(existentes)));
    sincronizarContadorId_(CLAVE_CONTADOR_MOVIMIENTO_, maxId);
    return { escritos: filas.length };
  });
}

/**
 * Actualiza campos editables. Nunca cambia el ID ni quién registró el
 * movimiento (idUsuario). Devuelve el movimiento actualizado o null.
 */
function actualizarMovimientoPorId_(id, cambios) {
  cambios = cambios || {};
  return conBloqueo_(() => {
    const tabla = leerMovimientosConFila_();
    const buscado = aEnteroId_(id);
    const actual = buscado === null ? null : tabla.movimientos.find(m => m.id === buscado);
    if (!actual) return null;

    let permitidos = {};
    CAMPOS_EDITABLES_MOVIMIENTO_.forEach(k => { if (k in cambios) permitidos[k] = cambios[k]; });
    permitidos = normalizarIdsMovimiento_(permitidos);
    if ('tipoGasto' in permitidos) permitidos.tipoGasto = convertirCelda_(permitidos.tipoGasto, 'tipoGasto');
    if ('valor' in permitidos) permitidos.valor = Number(permitidos.valor);

    const resultado = Object.assign(movimientoDeFila_(actual), permitidos);
    verificarMovimientoEscribible_(resultado);

    const filaBase = leerFilaCruda_(tabla, actual._fila);
    const fila = construirFilaDesdeModelo_(tabla, permitidos, filaBase);
    escribirFila_(tabla, actual._fila, fila, CLAVES_TEXTO_MOVIMIENTOS_);
    return resultado;
  });
}

function eliminarMovimientoPorId_(id) {
  return conBloqueo_(() => {
    const tabla = leerMovimientosConFila_();
    const buscado = aEnteroId_(id);
    const actual = buscado === null ? null : tabla.movimientos.find(m => m.id === buscado);
    if (!actual) return false;
    tabla.hoja.deleteRow(actual._fila);
    SpreadsheetApp.flush();
    return true;
  });
}

/**
 * Cantidad de movimientos por cuenta: Map(idCuenta -> n). Lee SOLO la columna ID_Cuenta.
 * Se usa para informar en Configuración cuántos movimientos históricos tiene cada cuenta.
 */
function contarMovimientosPorCuenta_() {
  const conteo = new Map();
  const tabla = abrirTabla_(ESQUEMA_MOVIMIENTOS_, { opcional: true });
  if (!tabla) return conteo;
  leerColumna_(tabla, 'idCuenta').map(aEnteroId_).forEach(id => {
    if (id !== null) conteo.set(id, (conteo.get(id) || 0) + 1);
  });
  return conteo;
}