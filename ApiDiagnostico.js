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

/**
 * diagnosticarSaldos() — SOLO LECTURA. No escribe en ninguna hoja.
 * Muestra, para comprobar con tus datos reales ANTES de fiarte de los saldos de la aplicación:
 *  - por usuario: el saldo de CADA cuenta de débito (ingresos, gastos, cantidad de movimientos y
 *    la parte que viene de movimientos pagados por OTRO usuario) y su total;
 *  - por usuario: cada tarjeta de crédito: si está declarada, saldo declarado y fecha, consumos
 *    posteriores, deuda y cupo. Si está "sin declarar" NO se calcula deuda; los consumos históricos
 *    se muestran solo como REFERENCIA (no se asume que sigan pendientes);
 *  - anomalías detectadas (nada se reasigna ni se corrige): movimientos sin cuenta válida, en cuenta
 *    de otro usuario, ingresos en tarjetas, consumos anteriores a la fecha de referencia, IDs duplicados;
 *  - una verificación cruzada: los saldos se recalculan por un camino independiente y deben coincidir.
 * Cómo usarla: en el editor de Apps Script elige "diagnosticarSaldos", Ejecutar, y mira
 * Ver > Registros de ejecución (también queda en el valor devuelto).
 */
function diagnosticarSaldos() {
  const catalogos = obtenerCatalogos_();
  const movimientos = obtenerTodosLosMovimientos_();
  const calculo = calcularSaldosCuentas_({ cuentas: catalogos.cuentas, movimientos, categorias: catalogos.categorias });
  const indice = crearIndiceCatalogos_(catalogos);
  const valorPorId = new Map(movimientos.map(m => [m.id, Number(m.valor) || 0]));
  const resumirIds = ids => ({ cantidad: ids.length, valorTotal: ids.reduce((s, id) => s + (valorPorId.get(id) || 0), 0), ids: ids.slice(0, 30) });

  const porUsuario = catalogos.usuarios.filter(u => u.idUsuario !== null).map(u => {
    const propias = calculo.cuentas.filter(c => c.idUsuario === u.idUsuario);
    const resumen = resumenSaldosDeUsuario_(calculo, u.idUsuario);
    return {
      idUsuario: u.idUsuario,
      nombre: nombreUsuarioDeId_(indice, u.idUsuario),
      saldoDisponibleTotal: resumen.saldoDisponibleCuentas,
      deudaTarjetas: resumen.deudaTarjetas,
      cupoDisponibleTarjetas: resumen.cupoDisponibleTarjetas,
      tarjetasSinDeclarar: resumen.tarjetasSinDeclarar,
      cuentasDebito: propias.filter(c => !c.esCredito).map(c => ({
        idCuenta: c.idCuenta, nombre: c.nombre, activa: c.activa, saldo: c.saldo,
        ingresos: c.ingresos, gastos: c.gastos, movimientos: c.cantidadMovimientos,
        efectoDeMovimientosPagadosPorOtroUsuario: c.efectoMovimientosAjenos
      })),
      tarjetas: propias.filter(c => c.esCredito).map(c => ({
        idCuenta: c.idCuenta, nombre: c.nombre, activa: c.activa, estado: c.declarada ? 'declarada' : 'SIN DECLARAR',
        saldoDeclarado: c.saldoDeclarado, fechaReferencia: c.fechaReferencia,
        consumosPosterioresALaFecha: c.consumosPosteriores, deuda: c.deuda,
        cupoTotal: c.cupoTotal, cupoDisponible: c.cupoDisponible,
        referenciaConsumosHistoricosTotales: c.consumosHistoricosTotales,
        consumosAnterioresOIgualesALaFecha: c.consumosAnteriores,
        ingresosEnTarjetaNoContados: c.ingresosEnTarjeta, movimientos: c.cantidadMovimientos
      }))
    };
  });

  // Verificación cruzada: otro camino de cálculo (acumulación simple por ID_Cuenta) debe dar lo mismo.
  const acumulado = new Map(); const vistos = new Set();
  movimientos.forEach(m => {
    if (vistos.has(m.id)) return; vistos.add(m.id);
    const cat = catalogos.categorias.find(c => c.idCategoria === m.idCategoria);
    const signo = (cat && esTipoIngreso_(cat.tipo)) ? 1 : -1;
    acumulado.set(m.idCuenta, (acumulado.get(m.idCuenta) || 0) + signo * (Number(m.valor) || 0));
  });
  const discrepancias = calculo.cuentas.filter(c => !c.esCredito && Math.abs((acumulado.get(c.idCuenta) || 0) - c.saldo) > 1e-6)
    .map(c => ({ idCuenta: c.idCuenta, nombre: c.nombre, calculado: c.saldo, verificacion: acumulado.get(c.idCuenta) || 0 }));

  const a = calculo.anomalias;
  const nombres = new Map();
  catalogos.cuentas.forEach(c => { const k = normalizarTexto_(c.nombre); nombres.set(k, (nombres.get(k) || new Set()).add(c.idUsuario)); });
  const resultado = {
    solo_lectura: true,
    totales: { usuarios: porUsuario.length, cuentas: catalogos.cuentas.length, movimientosLeidos: movimientos.length },
    porUsuario,
    anomalias: {
      movimientosSinCuentaValida: resumirIds(a.sinCuentaValida),
      movimientosEnCuentaDeOtroUsuario: resumirIds(a.enCuentaDeOtroUsuario),
      ingresosRegistradosEnTarjetas: resumirIds(a.ingresosEnTarjeta),
      consumosAnterioresALaFechaDeReferencia: resumirIds(a.consumosAnterioresALaReferencia),
      idsDeMovimientoDuplicados: resumirIds(a.idsDuplicados),
      cuentasSinPropietarioValido: catalogos.cuentas.filter(c => c.idUsuario === null).map(c => c.idCuenta)
    },
    informativo: {
      nombresDeCuentaUsadosPorMasDeUnUsuario: Array.from(nombres.entries()).filter(([, u]) => u.size > 1).map(([n, u]) => ({ nombre: n, idsUsuario: Array.from(u) }))
    },
    verificacionCruzada: { coincide: discrepancias.length === 0, discrepancias }
  };
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}