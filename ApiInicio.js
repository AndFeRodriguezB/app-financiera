/**
 * ApiInicio.gs
 * Responsabilidad única: orquestar el arranque de la aplicación y el
 * resumen financiero, tanto del mes actual como de cualquier mes histórico
 * que la persona quiera consultar (retroalimentación punto 7).
 *
 * Funciones públicas (únicas llamables desde el cliente vía google.script.run):
 * obtenerDatosIniciales, obtenerResumenFinanciero, obtenerResumenFinancieroPorMes
 *
 * SALDOS POR CUENTA: además de las cifras de siempre (que NO cambiaron), el resumen incluye
 * lo calculado desde las cuentas del usuario: saldoDisponibleCuentas (Σ de sus cuentas de DÉBITO
 * activas), deudaTarjetas, cupoDisponibleTarjetas, cantidadTarjetasActivas y tarjetasSinDeclarar.
 * Son cifras "de hoy" (no dependen del mes consultado).
 *
 * MIGRACIÓN A IDs: la identidad interna del usuario es su ID_Usuario (entero).
 * El nombre solo se usa para mostrar (saludo, etiquetas). Los movimientos se
 * leen del repositorio (hoja Movimientos); ya no se lee LOGS.
 */

function obtenerDatosIniciales() {
  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActual_(catalogos.usuarios);
  const idUsuarioActual = obtenerIdUsuario_(usuarioActual);

  const hoy = new Date();
  const dashboard = calcularResumenParaPeriodo_(catalogos, idUsuarioActual, hoy.getMonth() + 1, hoy.getFullYear());

  return {
    usuarioActual,
    idUsuarioActual,
    catalogos: catalogosParaCliente_(catalogos, idUsuarioActual),
    dashboard
  };
}

/**
 * Los datos financieros de las cuentas de OTRAS personas (cupo, días, saldo declarado) no tienen
 * por qué viajar al navegador: la interfaz solo necesita su id, nombre, tipo y estado para mostrar
 * el historial. Las cuentas del usuario actual llegan completas.
 */
function catalogosParaCliente_(catalogos, idUsuarioActual) {
  const ocultar = c => (c.idUsuario === idUsuarioActual) ? c
    : Object.assign({}, c, { cupoTotal: null, diaCorte: null, diaPago: null, saldoInicial: null, fechaSaldoInicial: null });
  return Object.assign({}, catalogos, { cuentas: catalogos.cuentas.map(ocultar) });
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
 * Movimientos (nunca se modifica ni se reinicia la hoja). Alimenta tanto la
 * tarjeta principal (mes actual) como el selector de historial mensual.
 */
function obtenerResumenFinancieroPorMes(mes, anio) {
  const catalogos = obtenerCatalogos_();
  const usuarioActual = obtenerUsuarioActual_(catalogos.usuarios);
  return calcularResumenParaPeriodo_(catalogos, obtenerIdUsuario_(usuarioActual), mes, anio);
}

function calcularResumenParaPeriodo_(catalogos, idUsuarioActual, mes, anio) {
  const todosLosMovimientos = obtenerTodosLosMovimientos_();
  const resumen = calcularResumenFinanciero_(todosLosMovimientos, catalogos.categorias, catalogos.usuarios, idUsuarioActual, mes, anio);
  const saldos = calcularSaldosCuentas_({ cuentas: catalogos.cuentas, movimientos: todosLosMovimientos, categorias: catalogos.categorias });
  return Object.assign({}, resumen, resumenSaldosDeUsuario_(saldos, idUsuarioActual));
}