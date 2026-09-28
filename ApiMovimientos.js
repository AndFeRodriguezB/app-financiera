/**
 * ApiMovimientos.gs
 * Responsabilidad única: las 4 operaciones de negocio sobre movimientos que
 * pide el MVP (sección 3 del documento maestro): registrar, editar, eliminar
 * y consultar el historial paginado. Reemplaza y amplía a Transacciones.gs,
 * que solo tenía "registrar".
 *
 * Estas 4 funciones son las únicas públicas del archivo (sin "_" final).
 */

function registrarMovimiento(datos) {
  const id = obtenerSiguienteIdMovimiento_();
  const fecha = fechaValidaOAhora_(datos.fecha); // texto "AAAA-MM-DD", nunca un objeto Date

  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActual_(catalogos.usuarios);
  const nombreUsuarioRegistra = obtenerCampo_(usuarioActual, 'Nombre', 'nombre') || Session.getActiveUser().getEmail();

  // Si el formulario no envía "pagadoPor" (p. ej. formulario de ingreso, o
  // app de un solo usuario), se asume que el movimiento es de quien lo registra.
  const pagadoPor = datos.pagadoPor || nombreUsuarioRegistra;
  const tipoGasto = datos.tipoGasto || 'Propio';
  const valorNumerico = Number(datos.valor) || 0;

  insertarMovimiento_([
    id,
    fecha,
    nombreUsuarioRegistra,
    pagadoPor,
    datos.cuenta,
    tipoGasto,
    datos.categoria,
    datos.subcategoria || '',
    valorNumerico,
    datos.descripcion || ''
  ]);

  return {
    id,
    fecha,
    usuario: nombreUsuarioRegistra,
    pagadoPor,
    cuenta: datos.cuenta,
    tipoGasto,
    categoria: datos.categoria,
    subcategoria: datos.subcategoria || '',
    valor: valorNumerico,
    descripcion: datos.descripcion || ''
  };
}

function actualizarMovimiento(id, datos) {
  const filaActualizada = actualizarMovimientoPorId_(id, datos);
  if (!filaActualizada) return null;

  return {
    id: filaActualizada[0],
    fecha: filaActualizada[1], // ya es texto "AAAA-MM-DD"
    usuario: filaActualizada[2],
    pagadoPor: filaActualizada[3],
    cuenta: filaActualizada[4],
    tipoGasto: filaActualizada[5],
    categoria: filaActualizada[6],
    subcategoria: filaActualizada[7],
    valor: filaActualizada[8],
    descripcion: filaActualizada[9]
  };
}

function eliminarMovimiento(id) {
  return eliminarMovimientoPorId_(id);
}

function obtenerHistorialMovimientos(desde, cantidad) {
  return obtenerMovimientosPaginados_(desde || 0, cantidad || 10);
}
