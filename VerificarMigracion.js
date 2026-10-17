/**
 * VerificacionMigracion.gs
 * Herramienta de VERIFICACIÓN (solo lectura) de la migración LOGS -> Movimientos.
 *
 * Compara, para cada usuario y cada mes con movimientos:
 *   - el resultado del cálculo ORIGINAL (por nombres, sobre la hoja LOGS intacta,
 *     leída como la leía el dashboard antiguo: valores visibles + encabezados crudos), contra
 *   - el cálculo NUEVO (por IDs, sobre la hoja Movimientos).
 * Cualquier diferencia queda identificada con usuario, periodo y campo. También
 * compara las gráficas de Análisis (gastos por categoría) y cuenta las causas
 * probables de una diferencia (valores no numéricos, fechas con otro formato,
 * "Pagado Por" vacío, ...).
 *
 * Las funciones *Legacy_ de abajo son COPIA LITERAL del cálculo anterior (solo
 * renombradas) y existen únicamente para esta comparación. Cuando la migración
 * esté aprobada y cerrada este archivo puede eliminarse.
 *
 * Uso: ejecutar verificarEquivalenciaFinanciera() desde el editor y revisar
 * Ver > Registros de ejecución.
 */

/* ======================= CÁLCULO ORIGINAL (COPIA LITERAL, SOLO RENOMBRADA) ======================= */

function calcularResumenFinancieroLegacy_(movimientos, categorias, usuarios, nombreUsuarioActual, mes, anio) {
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
    const esIngreso = esCategoriaIngresoLegacy_(categorias, mov.Categoria);
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

function calcularGastosPorCategoriaLegacy_(movimientos, categorias, nombreUsuarioActual, esMultiUsuario, mes, anio) {
  const propios = {};
  const compartidos = {};

  movimientos.forEach(mov => {
    if (!perteneceAlMes_(mov.Fecha, mes, anio)) return;
    if (esCategoriaIngresoLegacy_(categorias, mov.Categoria)) return;

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

function esCategoriaIngresoLegacy_(categorias, nombreCategoria) {
  const info = categorias.find(c => obtenerCampo_(c, 'Categoria', 'categoria') === nombreCategoria);
  const tipo = info ? obtenerCampo_(info, 'Tipo', 'tipo') : undefined;
  return tipo === 'Ingreso' || nombreCategoria === 'Ingreso';
}


/* ======================= VERIFICACIÓN ======================= */

const TOLERANCIA_EQUIVALENCIA_ = 1e-6;
const MAX_DIFERENCIAS_REPORTADAS_ = 200;

function hojaExiste_(nombre) { return !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre); }

/**
 * Núcleo PURO de la comparación (recibe todo ya leído).
 * entrada = { filasLogs, categoriasLegacy, usuariosCrudos, movimientos, catalogos, periodos:[{mes,anio}] }
 */
function compararEquivalenciaFinanciera_(entrada) {
  const { filasLogs, categoriasLegacy, usuariosCrudos, movimientos, catalogos } = entrada;
  const diferencias = [];
  let comparaciones = 0;
  const registrar = (tipo, usuario, periodo, campo, legacy, nuevo) => {
    if (diferencias.length < MAX_DIFERENCIAS_REPORTADAS_) diferencias.push({ tipo, usuario, periodo, campo, legacy, nuevo });
    else diferencias.overflow = (diferencias.overflow || 0) + 1;
  };
  const distintos = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > TOLERANCIA_EQUIVALENCIA_;
  const indice = crearIndiceCatalogos_(catalogos);
  const esMulti = catalogos.usuarios.length >= 2;

  // Usuarios con nombre e ID (mismas filas de la hoja Usuarios)
  const usuarios = catalogos.usuarios
    .map(u => ({ id: u.idUsuario, nombre: obtenerCampo_(u, 'Nombre', 'nombre') }))
    .filter(u => u.id !== null && u.nombre);

  usuarios.forEach(u => {
    entrada.periodos.forEach(p => {
      const etiqueta = `${p.anio}-${String(p.mes).padStart(2, '0')}`;

      // 1) Resumen (dashboard)
      const viejo = calcularResumenFinancieroLegacy_(filasLogs, categoriasLegacy, usuariosCrudos, u.nombre, p.mes, p.anio);
      const nuevo = calcularResumenFinanciero_(movimientos, catalogos.categorias, catalogos.usuarios, u.id, p.mes, p.anio);
      Object.keys(nuevo).forEach(campo => {
        comparaciones++;
        if (campo === 'esMultiUsuario') { if (viejo[campo] !== nuevo[campo]) registrar('resumen', u.nombre, etiqueta, campo, viejo[campo], nuevo[campo]); }
        else if (distintos(viejo[campo], nuevo[campo])) registrar('resumen', u.nombre, etiqueta, campo, viejo[campo], nuevo[campo]);
      });

      // 2) Análisis: gastos por categoría (comparados por NOMBRE de categoría)
      const aViejo = calcularGastosPorCategoriaLegacy_(filasLogs, categoriasLegacy, u.nombre, esMulti, p.mes, p.anio);
      const aNuevo = calcularGastosPorCategoria_(movimientos, catalogos.categorias, u.id, esMulti, p.mes, p.anio);
      ['propios', 'compartidos'].forEach(grupo => {
        const mapaViejo = new Map(Object.keys(aViejo[grupo]).map(k => [normalizarTexto_(k), aViejo[grupo][k]]));
        const mapaNuevo = new Map();
        aNuevo[grupo].forEach(i => mapaNuevo.set(normalizarTexto_(nombreCategoriaDeId_(indice, i.idCategoria)), i.valor));
        new Set([...mapaViejo.keys(), ...mapaNuevo.keys()]).forEach(cat => {
          comparaciones++;
          if (distintos(mapaViejo.get(cat), mapaNuevo.get(cat))) registrar('analisis-' + grupo, u.nombre, etiqueta, cat, mapaViejo.get(cat) || 0, mapaNuevo.get(cat) || 0);
        });
      });
    });
  });

  // Causas probables, leídas de LOGS tal como las veía el cálculo original
  const causas = { filasLogs: filasLogs.length, valorNoNumerico: 0, fechaNoIso: 0, pagadoPorVacio: 0, propioPagadoPorDistintoDeUsuario: 0 };
  filasLogs.forEach(f => {
    if (isNaN(Number(f.Valor))) causas.valorNoNumerico++;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(f.Fecha || ''))) causas.fechaNoIso++;
    if (!String(f['Pagado Por'] || '').trim()) causas.pagadoPorVacio++;
    if (String(f['Tipo Gasto'] || 'Propio') !== 'Compartido' && String(f['Pagado Por'] || '').trim() && String(f['Pagado Por']).trim() !== String(f.Usuario || '').trim()) causas.propioPagadoPorDistintoDeUsuario++;
  });

  return {
    estado: diferencias.length === 0 ? 'equivalente' : 'con_diferencias',
    resumen: { filasLogs: filasLogs.length, filasMovimientos: movimientos.length, usuarios: usuarios.length,
      periodosComparados: entrada.periodos.length, comparaciones, diferencias: diferencias.length + (diferencias.overflow || 0) },
    causasProbables: causas,
    diferencias
  };
}

/** Meses con movimientos (AAAA-MM únicos) + el mes actual. */
function periodosAComparar_(movimientos) {
  const vistos = new Set();
  const hoy = new Date();
  vistos.add(`${hoy.getFullYear()}-${hoy.getMonth() + 1}`);
  movimientos.forEach(m => {
    const mt = /^(\d{4})-(\d{2})-\d{2}$/.exec(m.fecha || '');
    if (mt) vistos.add(`${Number(mt[1])}-${Number(mt[2])}`);
  });
  return Array.from(vistos).map(s => { const [a, m] = s.split('-').map(Number); return { mes: m, anio: a }; })
    .sort((x, y) => (x.anio - y.anio) || (x.mes - y.mes));
}

function verificarEquivalenciaFinanciera() {
  if (!hojaExiste_('LOGS')) throw new Error('No existe la hoja LOGS: no hay con qué comparar.');
  const catalogos = obtenerCatalogos_();
  const movimientos = obtenerTodosLosMovimientos_();
  const resultado = compararEquivalenciaFinanciera_({
    filasLogs: obtenerDatosDinamicos_('LOGS'),
    categoriasLegacy: obtenerDatosDinamicos_(hojaExiste_('_legacy_Categorias') ? '_legacy_Categorias' : 'Categorias'),
    usuariosCrudos: obtenerDatosDinamicos_('Usuarios'),
    movimientos, catalogos,
    periodos: periodosAComparar_(movimientos)
  });
  Logger.log('=== verificarEquivalenciaFinanciera === ' + resultado.estado);
  Logger.log(JSON.stringify(resultado.resumen));
  Logger.log('Causas probables: ' + JSON.stringify(resultado.causasProbables));
  resultado.diferencias.slice(0, 100).forEach(d => Logger.log(`[${d.tipo}] ${d.usuario} ${d.periodo} ${d.campo}: antes=${d.legacy} ahora=${d.nuevo}`));
  return resultado;
}