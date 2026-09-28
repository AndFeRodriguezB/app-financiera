/**
 * CalculosFinancieros.gs
 * Responsabilidad única: las fórmulas del modelo financiero. Son funciones
 * puras (no tocan SpreadsheetApp ni Session), probadas con datos de ejemplo
 * en Node antes de entregarlas.
 *
 * CAMBIOS de esta revisión (retroalimentación del usuario):
 * - Se agrega "saldoDisponible": a diferencia de "balance" (que descuenta el
 *   APORTE ESPERADO, una obligación aún no pagada), "saldoDisponible"
 *   descuenta el APORTE REALIZADO (lo que ya salió físicamente de la
 *   cuenta). Es decir: "balance" = tu posición contable real considerando lo
 *   que debes; "saldoDisponible" = lo que ya se movió en efectivo.
 * - "saldoPendiente" (un solo número con signo) se reemplaza por dos campos
 *   siempre positivos y mutuamente excluyentes: "saldoPendienteAportar" (te
 *   falta pagar) y "saldoPendienteRecibir" (pagaste de más, te deben).
 * - calcularGastosPorCategoria_ ahora filtra "propios" por
 *   PagadoPor === usuario autenticado (antes mezclaba los gastos propios de
 *   TODOS los usuarios en una sola gráfica). "Compartido" se mantiene sin
 *   filtrar por usuario: es un acumulado del hogar igual para todos.
 * - Las fechas se comparan como texto "AAAA-MM-DD" (perteneceAlMes_), no
 *   como objetos Date.
 */

function calcularResumenFinanciero_(movimientos, categorias, usuarios, nombreUsuarioActual, mes, anio) {
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
    const valor = Number(mov.Valor) || 0;
    const esIngreso = esCategoriaIngreso_(categorias, mov.Categoria);
    const pagadoPor = mov['Pagado Por'];
    const tipoGasto = mov['Tipo Gasto'] || 'Propio';

    // Evalua si el movimiento corresponde al mes que el usuario consulta
    const esDelMes = perteneceAlMes_(mov.Fecha, mes, anio);

    if (esIngreso){
      if (pagadoPor === nombreUsuarioActual){
        ingresosHistoricos += valor;      // Siempre suma al historico
        if (esDelMes) ingresos += valor;  // Solo suma al mes si la fecha coincide
      }
      return;
    }
    if (esMultiUsuario && tipoGasto === 'Compartido'){
      gastosCompartidosTotalHistorico += valor;
      if (esDelMes) gastosCompartidosTotal += valor;

      if (pagadoPor === nombreUsuarioActual){
        aporteRealizadoHistorico += valor;
        if (esDelMes) aporteRealizado += valor;
      }
    } else if (pagadoPor === nombreUsuarioActual){
      gastosPropiosHistoricos += valor;
      if (esDelMes) gastosPropios += valor;
    }
  });

  let aporteEsperado = 0;
  let saldoPendienteAportar = 0;
  let saldoPendienteRecibir = 0;

  let aporteEsperadoHistorico = 0;

  if (esMultiUsuario) {
    const usuarioInfo = usuarios.find(u => obtenerCampo_(u, 'Nombre', 'nombre') === nombreUsuarioActual);
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
  const saldoDisponibleHistorico = ingresosHistoricos - gastosPropiosHistoricos - aporteRealizadoHistorico

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
 * Desglose de gastos por categoría del mes, para las dos gráficas de
 * Análisis:
 * - "propios": SOLO los gastos "Propio" (o cualquier gasto, en modo un solo
 *   usuario) que PAGÓ el usuario autenticado. Nunca debe verse el gasto
 *   propio de otra persona.
 * - "compartidos": TODOS los gastos "Compartido" del hogar, sin filtrar por
 *   usuario — todos los usuarios deben ver exactamente la misma gráfica.
 */


/**
 * Desglose de gastos por categoría del mes, para las dos gráficas de Análisis.
 */
function calcularGastosPorCategoria_(movimientos, categorias, nombreUsuarioActual, esMultiUsuario, mes, anio) {
  const propios = {};
  const compartidos = {};

  movimientos.forEach(mov => {
    if (!perteneceAlMes_(mov.Fecha, mes, anio)) return;
    if (esCategoriaIngreso_(categorias, mov.Categoria)) return;

    // 1. CORRECCIÓN: Limpieza profunda del número
    const valorCrudo = mov['Valor'] || mov['valor'] || 0;
    const valorLimpio = String(valorCrudo).replace(/[$A-Za-z\s]/g, '');
    const valor = parseFloat(valorLimpio) || 0;

    const categoria = mov['Categoria'] || mov['categoria'] || 'Sin categoría';
    
    // 2. CORRECCIÓN: Blindaje de Tipos de Gasto
    const tipoGastoCrudo = mov['Tipo Gasto'] || mov['Tipo gasto'] || mov['tipo gasto'] || 'Propio';
    const tipoGastoLimpio = tipoGastoCrudo.toString().trim().toLowerCase();
    const tipoGasto = tipoGastoLimpio === 'compartido' ? 'Compartido' : 'Propio';
    
    // 3. CORRECCIÓN: Blindaje de Pagado Por (Dueño del gasto)
    const pagadoPorCrudo = mov['Pagado Por'] || mov['Pagado por'] || mov['pagado por'] || '';
    const usuarioRegistro = mov['Usuario'] || mov['usuario'] || '';
    const pagadoPor = pagadoPorCrudo ? pagadoPorCrudo : usuarioRegistro;

    // Distribución a las bolsitas correspondientes
    if (esMultiUsuario && tipoGasto === 'Compartido') {
      compartidos[categoria] = (compartidos[categoria] || 0) + valor;
    } else if (pagadoPor === nombreUsuarioActual) {
      propios[categoria] = (propios[categoria] || 0) + valor;
    }
  });

  return { propios, compartidos };
}

/*function calcularGastosPorCategoria_(movimientos, categorias, nombreUsuarioActual, esMultiUsuario, mes, anio) {
  const propios = {};
  const compartidos = {};

  movimientos.forEach(mov => {
    if (!perteneceAlMes_(mov.Fecha, mes, anio)) return;
    if (esCategoriaIngreso_(categorias, mov.Categoria)) return;

    const valorCrudo = mov['Valor'] || 0;
    const valorLimpio = String(valorCrudo).replace(/[$A-Za-z\s]/g, '');
    const valor = parseFloat(valorLimpio) || 0;
    const categoria = mov.Categoria || mov['Categoria'] || 'Sin categoría';
    const tipoGasto = mov['Tipo Gasto'] || 'Propio';
    const pagadoPor = mov['Pagado Por'];

    if (esMultiUsuario && tipoGasto === 'Compartido') {
      compartidos[categoria] = (compartidos[categoria] || 0) + valor;
    } else if (pagadoPor === nombreUsuarioActual) {
      propios[categoria] = (propios[categoria] || 0) + valor;
    }
  });

  return { propios, compartidos };
}*/

function esCategoriaIngreso_(categorias, nombreCategoria) {
  const info = categorias.find(c => obtenerCampo_(c, 'Categoria', 'categoria') === nombreCategoria);
  const tipo = info ? obtenerCampo_(info, 'Tipo', 'tipo') : undefined;
  return tipo === 'Ingreso' || nombreCategoria === 'Ingreso';
}
