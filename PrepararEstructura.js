/**
 * PrepararEstructura.gs
 * Funciones ADMINISTRATIVAS de preparación de la estructura de las hojas. Se ejecutan a mano,
 * una vez, desde el editor de Apps Script (Ejecutar). Todas son IDEMPOTENTES (ejecutarlas
 * otra vez no cambia nada) y NO DESTRUCTIVAS (nunca modifican ni borran datos existentes).
 *
 *  - prepararColumnasCuentas(): agrega a la hoja "Cuentas" las columnas opcionales
 *    Saldo_Inicial y Fecha_Saldo_Inicial (saldo adeudado declarado de las tarjetas de crédito
 *    y fecha a la que corresponde). Solo agrega encabezados al final: las filas existentes
 *    quedan con esas celdas vacías (= tarjeta "sin declarar") y no se altera ningún dato.
 */
function prepararColumnasCuentas() {
  const r = agregarColumnasFaltantes_(ESQUEMA_CUENTAS_, ['saldoInicial', 'fechaSaldoInicial']);
  const resultado = {
    estado: r.agregadas.length ? 'columnas_agregadas' : 'sin_cambios',
    agregadas: r.agregadas,
    yaExistian: r.yaExistian,
    mensaje: r.agregadas.length
      ? 'Se agregaron las columnas: ' + r.agregadas.join(', ') + '. Los datos existentes no se modificaron.'
      : 'La hoja Cuentas ya tenía las columnas de saldo declarado. No se hizo ningún cambio.'
  };
  Logger.log(JSON.stringify(resultado));
  return resultado;
}