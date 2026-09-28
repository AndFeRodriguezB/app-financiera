/**
 * ApiAnalisis.gs
 * Responsabilidad única: exponer los datos de las gráficas de Análisis.
 *
 * CORRECCIÓN (retroalimentación punto 5): antes, "gastos propios por
 * categoría" sumaba los gastos "Propio" de TODOS los usuarios juntos. Ahora
 * se filtra correctamente por el usuario de la sesión activa: cada persona
 * ve únicamente SUS gastos propios. "Gastos compartidos por categoría" sigue
 * sin filtrar por usuario a propósito: es el acumulado del hogar y debe
 * verse igual para todos.
 */

function obtenerGastosPorCategoria(mes, anio) {
  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActual_(catalogos.usuarios);
  const nombreUsuarioActual = obtenerCampo_(usuarioActual, 'Nombre', 'nombre') || '';

  const hoy = new Date();
  const mesFinal = mes || (hoy.getMonth() + 1);
  const anioFinal = anio || hoy.getFullYear();

  const movimientosDelMes = obtenerMovimientosPorMes_(mesFinal, anioFinal);
  const esMultiUsuario = catalogos.usuarios.length >= 2;

  return calcularGastosPorCategoria_(movimientosDelMes, catalogos.categorias, nombreUsuarioActual, esMultiUsuario, mesFinal, anioFinal);
}
