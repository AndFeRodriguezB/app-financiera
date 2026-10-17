/**
 * ApiDiagnostico.gs
 * Herramienta de diagnóstico (solo lectura). No es parte del flujo normal de la
 * app: se usa para comprobar la salud de los datos contra la hoja real.
 *
 * Cómo usarla: desde el editor de Apps Script selecciona "diagnosticarMovimientos"
 * y presiona Ejecutar; el resultado queda en Ver > Registros de ejecución.
 *
 * Revisa la hoja Movimientos (reemplaza al diagnóstico antiguo de LOGS):
 * conteos, fechas y la integridad referencial contra los catálogos.
 * Para comparar contra los datos antiguos (LOGS) usa
 * verificarEquivalenciaFinanciera() en VerificacionMigracion.js.
 */
function diagnosticarMovimientos() {
  const catalogos = obtenerCatalogos_();
  const movimientos = obtenerTodosLosMovimientos_();
  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();

  const integridad = revisarIntegridadMovimientos_(movimientos, catalogos);
  const hallazgos = {};
  Object.keys(integridad).forEach(k => { hallazgos[k] = { cantidad: integridad[k].length, ids: integridad[k].slice(0, 20) }; });

  const resultado = {
    totalMovimientos: movimientos.length,
    conFechaValida: movimientos.filter(m => !!m.fecha && esFechaISOValida_(m.fecha)).length,
    fechaQueElServidorConsideraHoy: `${anioActual}-${String(mesActual).padStart(2, '0')}`,
    movimientosDelMesActual: movimientos.filter(m => perteneceAlMes_(m.fecha, mesActual, anioActual)).length,
    catalogos: {
      usuarios: catalogos.usuarios.length,
      cuentas: catalogos.cuentas.length,
      categorias: catalogos.categorias.length,
      subcategorias: catalogos.subcategorias.length
    },
    integridadReferencial: hallazgos,
    // "cuentaDeOtroUsuario" y los inactivos son avisos (históricos); lo demás son errores de datos.
    hayErroresDeDatos: ['usuarioInexistente', 'pagadorInexistente', 'cuentaInexistente', 'categoriaInexistente',
      'subcategoriaInexistente', 'subcategoriaDeOtraCategoria', 'idsDuplicados'].some(k => integridad[k].length > 0)
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}