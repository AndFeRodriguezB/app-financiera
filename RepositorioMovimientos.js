/**
 * RepositorioMovimientos.gs
 * Responsabilidad única: toda la lectura/escritura de la hoja "LOGS".
 * Es el único archivo del proyecto que conoce el nombre de columnas de LOGS
 * y su orden físico.
 *
 * FORMATO DE FECHA: la columna Fecha se fuerza a formato de texto plano
 * ("@") ANTES de escribir en ella, para que Google Sheets nunca la
 * reinterprete como número de fecha con un formato de visualización propio
 * del locale de la hoja. Las filas antiguas (con Date real) se siguen
 * leyendo bien gracias a normalizarFechaTexto_() en Utilidad.gs.
 *
 * CORRECCIÓN IMPORTANTE: antes, el nombre de cada columna se tomaba TAL
 * CUAL como venía escrito en la fila de encabezados de la hoja, y se usaba
 * directamente como llave del objeto (objeto[nombreColumna] = fila[i]).
 * Si el encabezado real tenía una diferencia mínima con lo que el código
 * esperaba (mayúsculas, un espacio de más, una tilde), la propiedad
 * quedaba "undefined" — y como el resto de la app lee mov.Fecha, esto hacía
 * que CADA movimiento fallara la comprobación de fecha, dejando TODOS los
 * meses (incluido el actual) y ambas gráficas de Análisis en cero al mismo
 * tiempo. normalizarEncabezadoLogs_() ahora tolera esas variaciones.
 */

const HOJA_LOGS_ = 'LOGS';
const COLUMNA_FECHA_LOGS_ = 2; // A=ID, B=Fecha, C=Usuario, ...

// Distintas formas en que alguien pudo escribir cada encabezado en la hoja
// (minúsculas, con/sin tilde, con/sin espacio) -> nombre canónico que usa
// el resto del código.
const MAPEO_ENCABEZADOS_LOGS_ = {
  'id': 'ID',
  'fecha': 'Fecha',
  'usuario': 'Usuario',
  'pagadopor': 'PagadoPor',
  'pagado por': 'PagadoPor',
  'cuenta': 'Cuenta',
  'tipogasto': 'Tipo gasto',
  'tipo gasto': 'Tipo gasto',
  'categoria': 'Categoria',
  'categoría': 'Categoria',
  'subcategoria': 'Subcategoria',
  'subcategoría': 'Subcategoria',
  'valor': 'Valor',
  'descripcion': 'Descripcion',
  'descripción': 'Descripcion'
};

function normalizarEncabezadoLogs_(textoOriginal) {
  const clave = textoOriginal.toString().trim().toLowerCase();
  return MAPEO_ENCABEZADOS_LOGS_[clave] || textoOriginal.toString().trim();
}

function obtenerHojaLogs_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_LOGS_);
}

function leerMovimientosCrudos_() {
  const hoja = obtenerHojaLogs_();
  if (!hoja) return [];

  const valores = hoja.getDataRange().getValues();
  if (valores.length <= 1) return [];

  const encabezados = valores[0].map(e => normalizarEncabezadoLogs_(e));
  const filas = valores.slice(1);

  return filas
    .map((fila, indice) => {
      const objeto = { _fila: indice + 2 };
      encabezados.forEach((nombreColumna, i) => {
        objeto[nombreColumna] = fila[i];
      });
      objeto.Fecha = normalizarFechaTexto_(objeto.Fecha);
      objeto.Valor = Number(objeto.Valor) || 0;
      return objeto;
    })
    .filter(mov => mov.ID !== '' && mov.ID !== null && mov.ID !== undefined);
}

function obtenerTodosLosMovimientos_() {
  return leerMovimientosCrudos_();
}

function obtenerMovimientosPorMes_(mes, anio) {
  return leerMovimientosCrudos_().filter(mov => perteneceAlMes_(mov.Fecha, mes, anio));
}

/**
 * Historial paginado: más reciente primero. El formato "AAAA-MM-DD" ordena
 * correctamente como texto (localeCompare), sin necesidad de convertir a
 * Date para comparar.
 */
function obtenerMovimientosPaginados_(desde, cantidad) {
  const todos = leerMovimientosCrudos_()
    .filter(mov => !!mov.Fecha)
    .sort((a, b) => b.Fecha.localeCompare(a.Fecha) || Number(b.ID) - Number(a.ID));

  const pagina = todos.slice(desde, desde + cantidad);

  return {
    movimientos: pagina.map(mov => ({
      id: Number(mov.ID),
      fecha: mov.Fecha,
      usuario: mov.Usuario,
      pagadoPor: mov.PagadoPor,
      cuenta: mov.Cuenta,
      tipoGasto: mov['Tipo gasto'],
      categoria: mov.Categoria,
      subcategoria: mov.Subcategoria,
      valor: mov.Valor,
      descripcion: mov.Descripcion
    })),
    hayMas: (desde + cantidad) < todos.length,
    total: todos.length
  };
}

function obtenerSiguienteIdMovimiento_() {
  const movimientos = leerMovimientosCrudos_();
  if (movimientos.length === 0) return 123;
  const maxId = Math.max(...movimientos.map(m => Number(m.ID) || 0));
  return maxId + 1;
}

/**
 * Escribe una fila nueva forzando la celda de Fecha a texto plano ANTES de
 * poner el valor, para que Sheets no la autoconvierta a fecha con su propio
 * formato visual.
 */
function insertarMovimiento_(datosFila) {
  const hoja = obtenerHojaLogs_();
  const filaDestino = hoja.getLastRow() + 1;

  hoja.getRange(filaDestino, COLUMNA_FECHA_LOGS_).setNumberFormat('@');
  hoja.getRange(filaDestino, 1, 1, datosFila.length).setValues([datosFila]);
  SpreadsheetApp.flush();
}

function buscarMovimientoPorId_(id) {
  return leerMovimientosCrudos_().find(m => Number(m.ID) === Number(id));
}

function actualizarMovimientoPorId_(id, datosActualizados) {
  const hoja = obtenerHojaLogs_();
  const movimiento = buscarMovimientoPorId_(id);
  if (!movimiento) return null;

  const fechaFinal = datosActualizados.fecha ? fechaValidaOAhora_(datosActualizados.fecha) : movimiento.Fecha;

  const filaActualizada = [
    movimiento.ID,
    fechaFinal,
    movimiento.Usuario,
    datosActualizados.pagadoPor !== undefined ? datosActualizados.pagadoPor : movimiento.PagadoPor,
    datosActualizados.cuenta !== undefined ? datosActualizados.cuenta : movimiento.Cuenta,
    datosActualizados.tipoGasto !== undefined ? datosActualizados.tipoGasto : movimiento['Tipo gasto'],
    datosActualizados.categoria !== undefined ? datosActualizados.categoria : movimiento.Categoria,
    datosActualizados.subcategoria !== undefined ? datosActualizados.subcategoria : movimiento.Subcategoria,
    datosActualizados.valor !== undefined ? Number(datosActualizados.valor) : movimiento.Valor,
    datosActualizados.descripcion !== undefined ? datosActualizados.descripcion : movimiento.Descripcion
  ];

  hoja.getRange(movimiento._fila, COLUMNA_FECHA_LOGS_).setNumberFormat('@');
  hoja.getRange(movimiento._fila, 1, 1, filaActualizada.length).setValues([filaActualizada]);
  SpreadsheetApp.flush();
  return filaActualizada;
}

function eliminarMovimientoPorId_(id) {
  const hoja = obtenerHojaLogs_();
  const movimiento = buscarMovimientoPorId_(id);
  if (!movimiento) return false;
  hoja.deleteRow(movimiento._fila);
  SpreadsheetApp.flush();
  return true;
}
