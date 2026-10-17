/**
 * ApiMovimientos.gs
 * Responsabilidad única: las 4 operaciones de negocio sobre movimientos:
 * registrar, editar, eliminar y consultar el historial paginado. Orquesta
 * Repositorio -> Validaciones, sin conocer la estructura física de las hojas.
 *
 * Estas 4 funciones son las únicas públicas del archivo (sin "_" final).
 *
 * MIGRACIÓN A IDs: un movimiento guarda IDs (enteros), nunca nombres.
 *  - Lo que envía el cliente: { fecha, valor, idCuenta, idCategoria, idSubcategoria,
 *    descripcion, idUsuarioPagador, tipoGasto } (los IDs pueden llegar como texto,
 *    p. ej. el value de un <select>; se convierten y validan aquí).
 *  - Lo que recibe el cliente: el movimiento con sus IDs MÁS los nombres
 *    resueltos desde los catálogos (nombreCategoria, nombreCuenta, ...), solo
 *    para mostrar. Los nombres nunca se usan como llave.
 *
 * SEGURIDAD: toda operación de escritura identifica al usuario con
 * obtenerUsuarioActualEstricto_ (un usuario no registrado produce error, nunca
 * cae a usuarios[0]) y revalida todo en el backend. Los permisos de quién puede
 * editar o eliminar un movimiento NO cambian en esta etapa.
 */

function enriquecerMovimiento_(m, indice) {
  const categoria = indice.categorias.get(m.idCategoria);
  return {
    id: m.id,
    fecha: m.fecha,
    idUsuario: m.idUsuario,
    idUsuarioPagador: m.idUsuarioPagador,
    idCuenta: m.idCuenta,
    tipoGasto: m.tipoGasto,
    idCategoria: m.idCategoria,
    idSubcategoria: m.idSubcategoria,
    valor: m.valor,
    descripcion: m.descripcion,
    esIngreso: !!categoria && esTipoIngreso_(categoria.tipo),
    nombreUsuario: nombreUsuarioDeId_(indice, m.idUsuario),
    nombrePagador: nombreUsuarioDeId_(indice, m.idUsuarioPagador),
    nombreCuenta: nombreCuentaDeId_(indice, m.idCuenta),
    nombreCategoria: nombreCategoriaDeId_(indice, m.idCategoria),
    nombreSubcategoria: m.idSubcategoria === null ? '' : nombreSubcategoriaDeId_(indice, m.idSubcategoria)
  };
}

function registrarMovimiento(datos) {
  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActualEstricto_(catalogos.usuarios);
  const modelo = validarMovimientoParaGuardar_(datos, {
    catalogos, idUsuarioActual: obtenerIdUsuario_(usuarioActual), existente: null
  });
  const guardado = insertarMovimiento_(modelo);
  return enriquecerMovimiento_(guardado, crearIndiceCatalogos_(catalogos));
}

function actualizarMovimiento(id, datos) {
  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActualEstricto_(catalogos.usuarios);
  const existente = buscarMovimientoPorId_(id);
  if (!existente) return null;

  const modelo = validarMovimientoParaGuardar_(datos, {
    catalogos, idUsuarioActual: obtenerIdUsuario_(usuarioActual), existente
  });
  const actualizado = actualizarMovimientoPorId_(existente.id, modelo);
  if (!actualizado) return null;
  return enriquecerMovimiento_(actualizado, crearIndiceCatalogos_(catalogos));
}

function eliminarMovimiento(id) {
  obtenerUsuarioActualEstricto_(obtenerCatalogos_().usuarios);
  return eliminarMovimientoPorId_(id);
}

function obtenerHistorialMovimientos(desde, cantidad) {
  const inicio = Math.max(0, parseInt(desde, 10) || 0);
  const tam = Math.min(100, Math.max(1, parseInt(cantidad, 10) || 10));
  const pagina = obtenerMovimientosPaginados_(inicio, tam);
  const indice = crearIndiceCatalogos_(obtenerCatalogos_());
  return {
    movimientos: pagina.movimientos.map(m => enriquecerMovimiento_(m, indice)),
    hayMas: pagina.hayMas,
    total: pagina.total
  };
}