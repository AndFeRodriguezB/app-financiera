/**
 * ApiDiagnostico.gs
 * Herramienta de diagnóstico. No es parte del flujo normal de la app: se usa
 * para investigar problemas de lectura de datos contra la hoja real.
 *
 * Cómo usarla:
 * 1) Desde el editor de Apps Script: selecciona "diagnosticarLogs" en el
 *    menú desplegable de funciones, presiona Ejecutar, y abre
 *    Ver > Registros de ejecución (o Ctrl+Enter) para ver el resultado.
 * 2) O desde la consola del navegador con la app abierta:
 *    google.script.run.withSuccessHandler(console.log).diagnosticarLogs()
 */
function diagnosticarLogs() {
  const hoja = obtenerHojaLogs_();
  if (!hoja) {
    const errorMsg = 'No se encontró una hoja llamada "LOGS". Revisa que el nombre de la pestaña sea exactamente ese.';
    Logger.log(errorMsg);
    return { error: errorMsg };
  }

  const valores = hoja.getDataRange().getValues();
  const encabezadosCrudos = valores[0] || [];
  const encabezadosNormalizados = encabezadosCrudos.map(e => normalizarEncabezadoLogs_(e));

  // Muestra el valor CRUDO de la columna Fecha (antes de normalizar), con su
  // tipo de dato real, para las primeras filas de datos. Esto es clave para
  // saber si Sheets está devolviendo un objeto Date, un texto, o un número.
  const indiceColFecha = encabezadosNormalizados.indexOf('Fecha');
  const muestraFechasCrudas = valores.slice(1, 6).map((fila, i) => {
    const crudo = indiceColFecha >= 0 ? fila[indiceColFecha] : undefined;
    return {
      fila: i + 2,
      valorCrudo: crudo instanceof Date ? crudo.toString() : crudo,
      tipoDeDato: crudo instanceof Date ? 'Date' : typeof crudo,
      normalizadoA: normalizarFechaTexto_(crudo)
    };
  });

  const movimientos = leerMovimientosCrudos_();
  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();
  const coincidenEsteMes = movimientos.filter(m => perteneceAlMes_(m.Fecha, mesActual, anioActual)).length;
  const conFechaValida = movimientos.filter(m => !!m.Fecha).length;

  const resultado = {
    encabezadosComoEstanEnLaHoja: encabezadosCrudos,
    encabezadosYaNormalizados: encabezadosNormalizados,
    muestraDeFechasCrudasVsNormalizadas: muestraFechasCrudas,
    totalFilasDeDatosEnLaHoja: valores.length - 1,
    totalMovimientosLeidos: movimientos.length,
    movimientosConFechaQueSePudoInterpretar: conFechaValida,
    fechaQueElServidorConsideraHoy: `${anioActual}-${String(mesActual).padStart(2, '0')}`,
    movimientosQueCoincidenConElMesActual: coincidenEsteMes,
    primeros3MovimientosLeidos: movimientos.slice(0, 3).map(m => ({
      ID: m.ID, Fecha: m.Fecha, PagadoPor: m.PagadoPor, Categoria: m.Categoria,
      TipoGasto: m['Tipo gasto'], Valor: m.Valor
    }))
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}
