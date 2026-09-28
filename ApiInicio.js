/**
 * ApiInicio.gs
 * Responsabilidad única: orquestar el arranque de la aplicación y el
 * resumen financiero, tanto del mes actual como de cualquier mes histórico
 * que la persona quiera consultar (retroalimentación punto 7).
 *
 * Funciones públicas (únicas llamables desde el cliente vía google.script.run):
 * obtenerDatosIniciales, obtenerResumenFinanciero, obtenerResumenFinancieroPorMes
 */

function obtenerDatosIniciales() {
  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActual_(catalogos.usuarios);
  const nombreUsuarioActual = obtenerCampo_(usuarioActual, 'Nombre', 'nombre') || '';

  const hoy = new Date();
  const dashboard = calcularResumenParaPeriodo_(catalogos, nombreUsuarioActual, hoy.getMonth() + 1, hoy.getFullYear());

  return {
    usuarioActual,
    catalogos,
    dashboard
  };
}

/**
 * Refresco liviano del resumen del mes ACTUAL (se usa después de
 * registrar/editar/eliminar un movimiento).
 */
function obtenerResumenFinanciero() {
  const hoy = new Date();
  return obtenerResumenFinancieroPorMes(hoy.getMonth() + 1, hoy.getFullYear());
}

/**
 * Resumen financiero de CUALQUIER mes/año, recalculado en vivo a partir de
 * LOGS (nunca se modifica ni se reinicia la hoja: sección "Consideraciones
 * importantes" de la retroalimentación). Es la función que alimenta tanto la
 * tarjeta principal (mes actual) como el selector de historial mensual.
 */
function obtenerResumenFinancieroPorMes(mes, anio) {
  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActual_(catalogos.usuarios);
  const nombreUsuarioActual = obtenerCampo_(usuarioActual, 'Nombre', 'nombre') || '';
  return calcularResumenParaPeriodo_(catalogos, nombreUsuarioActual, mes, anio);
}

function calcularResumenParaPeriodo_(catalogos, nombreUsuarioActual, mes, anio){
  const todosLosMovimientos = obtenerDatosDinamicos_('LOGS');

  return calcularResumenFinanciero_(todosLosMovimientos, catalogos.categorias, catalogos.usuarios, nombreUsuarioActual, mes, anio);
}
