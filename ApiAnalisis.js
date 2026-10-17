/**
 * ApiAnalisis.gs
 * Responsabilidad única: exponer los datos de las gráficas de Análisis.
 *
 * "Gastos propios por categoría" se filtra por el usuario de la sesión activa
 * (cada persona ve únicamente SUS gastos propios). "Gastos compartidos por
 * categoría" no se filtra por usuario a propósito: es el acumulado del hogar y
 * debe verse igual para todos.
 *
 * MIGRACIÓN A IDs: el cálculo trabaja por ID_Categoria; aquí se resuelven los
 * nombres (desde Categorias, incluidas las inactivas) solo para mostrarlos.
 * Respuesta: { propios: [{idCategoria, categoria, valor}], compartidos: [...] }
 */

function obtenerGastosPorCategoria(mes, anio) {
  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActual_(catalogos.usuarios);
  const idUsuarioActual = obtenerIdUsuario_(usuarioActual);

  const hoy = new Date();
  const mesFinal = mes || (hoy.getMonth() + 1);
  const anioFinal = anio || hoy.getFullYear();

  const movimientosDelMes = obtenerMovimientosPorMes_(mesFinal, anioFinal);
  const esMultiUsuario = catalogos.usuarios.length >= 2;

  const r = calcularGastosPorCategoria_(movimientosDelMes, catalogos.categorias, idUsuarioActual, esMultiUsuario, mesFinal, anioFinal);
  const indice = crearIndiceCatalogos_(catalogos);
  const nombrar = items => items.map(i => ({
    idCategoria: i.idCategoria,
    categoria: nombreCategoriaDeId_(indice, i.idCategoria) || 'Categoría desconocida',
    valor: i.valor
  }));
  return { propios: nombrar(r.propios), compartidos: nombrar(r.compartidos) };
}