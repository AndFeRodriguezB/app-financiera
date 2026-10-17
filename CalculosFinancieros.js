/**
 * CalculosFinancieros.gs
 * Responsabilidad única: las fórmulas del modelo financiero. Son funciones
 * puras (no tocan SpreadsheetApp ni Session), probadas con datos de ejemplo
 * en Node antes de entregarlas.
 *
 * MIGRACIÓN A IDs (fase 6): las FÓRMULAS NO CAMBIARON. Solo cambió cómo se
 * relacionan las entidades:
 *   - el usuario actual es un ID_Usuario (entero), no un nombre;
 *   - "pagó el usuario actual" = ID_Usuario_Pagador === idUsuarioActual;
 *   - una categoría es de ingreso según Categorias.Tipo, buscada por ID_Categoria;
 *   - los movimientos llegan del repositorio ya con IDs, fecha "AAAA-MM-DD" y
 *     valor numérico.
 * Los nombres solo se resuelven más arriba (API) para presentación.
 *
 * Conservado de revisiones anteriores:
 *  - "saldoDisponible" descuenta el APORTE REALIZADO; "balance" el APORTE ESPERADO.
 *  - "saldoPendienteAportar" / "saldoPendienteRecibir": positivos y excluyentes.
 *  - Los gastos "Compartido" suman el acumulado del hogar (igual para todos);
 *    el gasto se atribuye a quien lo pagó.
 *  - "Porcentaje Compartido" se lee EXACTAMENTE como antes (clave
 *    PorcentajeCompartido sobre la fila cruda de Usuarios; si no es un número
 *    positivo se reparte en partes iguales). NO se modificó esa lógica: ver las
 *    pruebas de caracterización (tests/caracterizacion_porcentaje.test.js).
 */

function calcularResumenFinanciero_(movimientos, categorias, usuarios, idUsuarioActual, mes, anio) {
  const cantidadUsuarios = usuarios.length;
  const esMultiUsuario = cantidadUsuarios >= 2;

  // Variables Mensuales
  let ingresos = 0;
  let gastosPropios = 0;
  let gastosCompartidosTotal = 0;
  let aporteRealizado = 0;

  // Variables Historicas
  let ingresosHistoricos = 0;
  let gastosPropiosHistoricos = 0;
  let gastosCompartidosTotalHistorico = 0;
  let aporteRealizadoHistorico = 0;

  movimientos.forEach(mov => {
    const valor = Number(mov.valor) || 0;
    const esIngreso = esCategoriaIngreso_(categorias, mov.idCategoria);
    const pagoElUsuarioActual = mov.idUsuarioPagador === idUsuarioActual;
    const tipoGasto = mov.tipoGasto || 'Propio';

    // Evalua si el movimiento corresponde al mes que el usuario consulta
    const esDelMes = perteneceAlMes_(mov.fecha, mes, anio);

    if (esIngreso){
      if (pagoElUsuarioActual){
        ingresosHistoricos += valor;      // Siempre suma al historico
        if (esDelMes) ingresos += valor;  // Solo suma al mes si la fecha coincide
      }
      return;
    }
    if (esMultiUsuario && tipoGasto === 'Compartido'){
      gastosCompartidosTotalHistorico += valor;
      if (esDelMes) gastosCompartidosTotal += valor;

      if (pagoElUsuarioActual){
        aporteRealizadoHistorico += valor;
        if (esDelMes) aporteRealizado += valor;
      }
    } else if (pagoElUsuarioActual){
      gastosPropiosHistoricos += valor;
      if (esDelMes) gastosPropios += valor;
    }
  });

  let aporteEsperado = 0;
  let saldoPendienteAportar = 0;
  let saldoPendienteRecibir = 0;

  let aporteEsperadoHistorico = 0;

  if (esMultiUsuario) {
    const usuarioInfo = usuarios.find(u => u.idUsuario === idUsuarioActual);
    let porcentaje = usuarioInfo ? Number(obtenerCampo_(usuarioInfo, 'PorcentajeCompartido', 'porcentajecompartido')) : NaN;
    if (isNaN(porcentaje) || porcentaje <= 0) {
      porcentaje = 100 / cantidadUsuarios;
    }

    // Calculos para las deudas de este mes
    aporteEsperado = gastosCompartidosTotal * (porcentaje / 100);

    const diferencia = aporteEsperado - aporteRealizado;
    if (diferencia > 0) {
      saldoPendienteAportar = diferencia;   // todavía debe pagar esto al fondo compartido
    } else if (diferencia < 0) {
      saldoPendienteRecibir = -diferencia;  // pagó de más, le deben esto
    }

    // Calculo para restar al balance historico
    aporteEsperadoHistorico = gastosCompartidosTotalHistorico * (porcentaje / 100);
  }

  // Se aplica el ajuste usando vairables historicas
  const balanceHistorico = ingresosHistoricos - gastosPropiosHistoricos - aporteEsperadoHistorico;
  const saldoDisponibleHistorico = ingresosHistoricos - gastosPropiosHistoricos - aporteRealizadoHistorico;

  const balance = ingresos - gastosPropios - aporteEsperado;
  const saldoDisponible = ingresos - gastosPropios - aporteRealizado;

  return {
    balance,
    balanceHistorico,
    saldoDisponibleHistorico,
    saldoDisponible,
    ingresos,
    gastosPropios,
    gastosCompartidos: esMultiUsuario ? gastosCompartidosTotal : 0,
    aporteEsperado: esMultiUsuario ? aporteEsperado : 0,
    aporteRealizado: esMultiUsuario ? aporteRealizado : 0,
    saldoPendienteAportar: esMultiUsuario ? saldoPendienteAportar : 0,
    saldoPendienteRecibir: esMultiUsuario ? saldoPendienteRecibir : 0,
    esMultiUsuario
  };
}

/**
 * Desglose de gastos por categoría del mes, para las dos gráficas de Análisis.
 * Internamente por ID_Categoria; la API resuelve los nombres para mostrarlos.
 * - "propios": SOLO los gastos "Propio" (o cualquier gasto, en modo un solo
 *   usuario) que PAGÓ el usuario autenticado. Nunca debe verse el gasto
 *   propio de otra persona.
 * - "compartidos": TODOS los gastos "Compartido" del hogar, sin filtrar por
 *   usuario: todos los usuarios ven exactamente la misma gráfica.
 * Devuelve { propios: [{idCategoria, valor}], compartidos: [{idCategoria, valor}] }
 * (en orden de primera aparición).
 */
function calcularGastosPorCategoria_(movimientos, categorias, idUsuarioActual, esMultiUsuario, mes, anio) {
  const propios = new Map();
  const compartidos = new Map();
  const sumar = (mapa, id, valor) => mapa.set(id, (mapa.get(id) || 0) + valor);

  movimientos.forEach(mov => {
    if (!perteneceAlMes_(mov.fecha, mes, anio)) return;
    if (esCategoriaIngreso_(categorias, mov.idCategoria)) return;

    const valor = Number(mov.valor) || 0;
    const tipoGasto = mov.tipoGasto || 'Propio';

    if (esMultiUsuario && tipoGasto === 'Compartido') {
      sumar(compartidos, mov.idCategoria, valor);
    } else if (mov.idUsuarioPagador === idUsuarioActual) {
      sumar(propios, mov.idCategoria, valor);
    }
  });

  const aLista = mapa => Array.from(mapa, ([idCategoria, valor]) => ({ idCategoria, valor }));
  return { propios: aLista(propios), compartidos: aLista(compartidos) };
}

/** Una categoría es de ingreso si su Tipo (Categorias.Tipo) es "Ingreso". Se busca por ID. */
function esCategoriaIngreso_(categorias, idCategoria) {
  const info = categorias.find(c => c.idCategoria === idCategoria);
  return !!info && esTipoIngreso_(info.tipo);
}