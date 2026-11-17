/**
 * Validaciones.gs
 * Responsabilidad única: reglas de negocio que debe cumplir un movimiento
 * ANTES de guardarse. Son funciones PURAS (no tocan SpreadsheetApp ni Session):
 * reciben los datos y los catálogos ya cargados, y devuelven el modelo
 * normalizado o lanzan un Error con un mensaje claro para la persona.
 *
 * El frontend NUNCA es la única capa de seguridad: todo lo que valida la
 * interfaz se vuelve a validar aquí.
 *
 * Reglas (todas se verifican en el backend):
 *  - Fecha real en formato AAAA-MM-DD; valor numérico mayor que cero.
 *  - Categoría: existe y está activa.
 *  - Subcategoría (si se envía): existe, está activa y pertenece a la categoría.
 *  - Cuenta: existe, está activa y pertenece al usuario que PAGÓ.
 *  - Pagador: existe en Usuarios.
 *  - Tipo de gasto: Propio | Compartido.
 *  - Gasto: ID_Usuario = quien registra; pagador = el que se envía (por defecto, quien registra).
 *  - Ingreso: ID_Usuario = ID_Usuario_Pagador = usuario autenticado; siempre Propio;
 *    la cuenta debe ser del usuario autenticado.
 *
 * Al EDITAR un movimiento histórico:
 *  - Una cuenta/categoría/subcategoría que quedó INACTIVA se conserva si no se
 *    cambia (la referencia histórica no se pierde). Un valor inactivo NUEVO se rechaza.
 *  - Si la cuenta y el pagador no cambian, no se vuelve a exigir que la cuenta sea del
 *    pagador (algunos movimientos migrados quedaron con advertencia por esa razón).
 *  - No se puede convertir un gasto en ingreso (ni al revés).
 *  - En un ingreso el pagador no cambia; quien lo registró (ID_Usuario) tampoco.
 *  - Los permisos de quién puede editar/eliminar NO se modifican en esta etapa.
 */

const TIPOS_GASTO_VALIDOS_ = ['Propio', 'Compartido'];

function errorValidacion_(mensaje) {
  return new Error(mensaje);
}

function normalizarTipoGastoEntrada_(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return 'Propio';
  const t = normalizarTexto_(valor);
  if (t === 'propio') return 'Propio';
  if (t === 'compartido') return 'Compartido';
  throw errorValidacion_('El tipo de gasto no es válido (debe ser Propio o Compartido).');
}

/**
 * @param {Object} datos      Lo que envía el cliente (IDs como número o texto).
 * @param {Object} contexto   { catalogos, idUsuarioActual, existente }
 *                            existente = movimiento actual del repositorio (edición) o null.
 * @returns {Object} modelo listo para el repositorio (sin id).
 */
function validarMovimientoParaGuardar_(datos, contexto) {
  if (!datos || typeof datos !== 'object') throw errorValidacion_('No se recibieron datos del movimiento.');
  const catalogos = contexto.catalogos;
  const idUsuarioActual = contexto.idUsuarioActual;
  const existente = contexto.existente || null;

  const usuarioPorId = id => (catalogos.usuarios || []).find(u => u.idUsuario === id) || null;
  if (!esIdValido_(idUsuarioActual) || !usuarioPorId(idUsuarioActual)) {
    throw errorValidacion_('El usuario que registra no existe en la hoja Usuarios.');
  }

  // --- Fecha (formato estricto AAAA-MM-DD y fecha real del calendario; sin interpretar otros formatos)
  const fecha = typeof datos.fecha === 'string' ? datos.fecha.trim() : '';
  if (!esFechaISOValida_(fecha)) throw errorValidacion_('La fecha no es válida. Usa el formato AAAA-MM-DD.');

  // --- Valor
  const valor = typeof datos.valor === 'number' ? datos.valor : Number(datos.valor);
  if (datos.valor === '' || datos.valor === null || datos.valor === undefined || !isFinite(valor) || valor <= 0) {
    throw errorValidacion_('El valor debe ser un número mayor que cero.');
  }

  // --- Categoría
  const idCategoria = aEnteroId_(datos.idCategoria);
  if (idCategoria === null) throw errorValidacion_('Selecciona una categoría.');
  const categoria = (catalogos.categorias || []).find(c => c.idCategoria === idCategoria);
  if (!categoria) throw errorValidacion_('La categoría seleccionada no existe.');
  const categoriaSinCambio = !!existente && existente.idCategoria === idCategoria;
  if (!categoria.activa && !categoriaSinCambio) throw errorValidacion_('La categoría seleccionada está inactiva.');
  const esIngreso = esTipoIngreso_(categoria.tipo);

  if (existente) {
    const catExistente = (catalogos.categorias || []).find(c => c.idCategoria === existente.idCategoria);
    const eraIngreso = !!catExistente && esTipoIngreso_(catExistente.tipo);
    if (eraIngreso !== esIngreso) throw errorValidacion_('No se puede convertir un gasto en ingreso (ni un ingreso en gasto).');
  }

  // --- Subcategoría (opcional)
  const idSubcategoria = aEnteroIdOpcional_(datos.idSubcategoria);
  if (typeof idSubcategoria === 'number' && isNaN(idSubcategoria)) throw errorValidacion_('La subcategoría seleccionada no es válida.');
  if (idSubcategoria !== null) {
    const sub = (catalogos.subcategorias || []).find(s => s.idSubcategoria === idSubcategoria);
    if (!sub) throw errorValidacion_('La subcategoría seleccionada no existe.');
    if (sub.idCategoria !== idCategoria) throw errorValidacion_('La subcategoría no pertenece a la categoría seleccionada.');
    const subSinCambio = !!existente && existente.idSubcategoria === idSubcategoria;
    if (!sub.activa && !subSinCambio) throw errorValidacion_('La subcategoría seleccionada está inactiva.');
  }

  // --- Quién registra y quién paga
  const idUsuario = existente ? existente.idUsuario : idUsuarioActual;
  let idUsuarioPagador;
  if (esIngreso) {
    // Un ingreso es siempre de quien lo registró; en edición el pagador no cambia.
    idUsuarioPagador = existente ? existente.idUsuarioPagador : idUsuarioActual;
  } else {
    const enviado = aEnteroIdOpcional_(datos.idUsuarioPagador);
    if (typeof enviado === 'number' && isNaN(enviado)) throw errorValidacion_('El usuario que pagó no es válido.');
    idUsuarioPagador = enviado !== null ? enviado : (existente ? existente.idUsuarioPagador : idUsuarioActual);
  }
  if (!usuarioPorId(idUsuarioPagador)) throw errorValidacion_('El usuario que pagó no existe.');

  // --- Tipo de gasto
  const tipoGasto = esIngreso ? 'Propio' : normalizarTipoGastoEntrada_(datos.tipoGasto);

  // --- Cuenta
  const idCuenta = aEnteroId_(datos.idCuenta);
  if (idCuenta === null) throw errorValidacion_(esIngreso ? 'Selecciona la cuenta destino.' : 'Selecciona la cuenta de origen.');
  const cuenta = (catalogos.cuentas || []).find(c => c.idCuenta === idCuenta);
  if (!cuenta) throw errorValidacion_('La cuenta seleccionada no existe.');
  const cuentaSinCambio = !!existente && existente.idCuenta === idCuenta;
  if (!cuenta.activa && !cuentaSinCambio) throw errorValidacion_('La cuenta seleccionada está inactiva.');
  // Un ingreso ordinario no puede ir a una tarjeta de crédito (la tarjeta es deuda, no dinero disponible).
  // Un ingreso HISTÓRICO que ya estaba en una tarjeta y no se cambia se conserva (el diagnóstico lo reporta).
  if (esIngreso && esCuentaCredito_(cuenta) && !cuentaSinCambio) {
    throw errorValidacion_('Los ingresos solo pueden registrarse en cuentas de débito, no en tarjetas de crédito.');
  }
  const parSinCambio = cuentaSinCambio && existente.idUsuarioPagador === idUsuarioPagador;
  if (cuenta.idUsuario !== idUsuarioPagador && !parSinCambio) {
    throw errorValidacion_(esIngreso
      ? 'La cuenta destino debe pertenecer al usuario que registra el ingreso.'
      : 'La cuenta seleccionada no pertenece al usuario que pagó.');
  }

  const descripcion = (datos.descripcion === undefined || datos.descripcion === null) ? '' : String(datos.descripcion).slice(0, 1000);

  return { fecha, idUsuario, idUsuarioPagador, idCuenta, tipoGasto, idCategoria, idSubcategoria, valor, descripcion };
}

/**
 * Revisa la integridad referencial de los movimientos contra los catálogos.
 * Pura: la usa el diagnóstico. Devuelve listas de hallazgos por tipo.
 */
function revisarIntegridadMovimientos_(movimientos, catalogos) {
  const usuarios = new Set((catalogos.usuarios || []).map(u => u.idUsuario).filter(v => v !== null));
  const cuentas = new Map((catalogos.cuentas || []).map(c => [c.idCuenta, c]));
  const categorias = new Map((catalogos.categorias || []).map(c => [c.idCategoria, c]));
  const subcategorias = new Map((catalogos.subcategorias || []).map(s => [s.idSubcategoria, s]));
  const r = { usuarioInexistente: [], pagadorInexistente: [], cuentaInexistente: [], cuentaDeOtroUsuario: [], cuentaInactiva: [],
    categoriaInexistente: [], categoriaInactiva: [], subcategoriaInexistente: [], subcategoriaDeOtraCategoria: [], subcategoriaInactiva: [], idsDuplicados: [] };
  const vistos = new Set();
  movimientos.forEach(m => {
    if (vistos.has(m.id)) r.idsDuplicados.push(m.id);
    vistos.add(m.id);
    if (!usuarios.has(m.idUsuario)) r.usuarioInexistente.push(m.id);
    if (!usuarios.has(m.idUsuarioPagador)) r.pagadorInexistente.push(m.id);
    const cu = cuentas.get(m.idCuenta);
    if (!cu) r.cuentaInexistente.push(m.id);
    else {
      if (cu.idUsuario !== m.idUsuarioPagador) r.cuentaDeOtroUsuario.push(m.id);
      if (!cu.activa) r.cuentaInactiva.push(m.id);
    }
    const ca = categorias.get(m.idCategoria);
    if (!ca) r.categoriaInexistente.push(m.id);
    else if (!ca.activa) r.categoriaInactiva.push(m.id);
    if (m.idSubcategoria !== null && m.idSubcategoria !== undefined) {
      const su = subcategorias.get(m.idSubcategoria);
      if (!su) r.subcategoriaInexistente.push(m.id);
      else {
        if (su.idCategoria !== m.idCategoria) r.subcategoriaDeOtraCategoria.push(m.id);
        if (!su.activa) r.subcategoriaInactiva.push(m.id);
      }
    }
  });
  return r;
}


/* ==========================================================================
 * CUENTAS (fase 8)
 * ========================================================================== */
const LONGITUD_MAXIMA_NOMBRE_CUENTA_ = 60;
const CUPO_MAXIMO_CUENTA_ = 1e13;

/**
 * Valida y normaliza los datos de una cuenta. PURA.
 * @param {Object} datos     Lo que envía el cliente: { nombre, tipo, cupoTotal, diaCorte, diaPago }.
 *                           El cliente NO decide ni el ID ni el propietario: si envía un
 *                           idUsuario distinto del usuario autenticado se rechaza.
 * @param {Object} contexto  { idUsuarioActual, cuentasExistentes (todas las del libro), existente (modelo | null),
 *                           hoy ('AAAA-MM-DD', el servidor lo aporta para mantener la función pura) }
 *   Para tarjetas de crédito el cliente envía además { saldoAdeudado, fechaSaldo }: el saldo total que
 *   la persona declara deber y la fecha a la que corresponde (no puede ser futura).
 * @returns {Object} { nombre, tipo, cupoTotal, diaCorte, diaPago, saldoInicial?, fechaSaldoInicial? }
 *                   crédito: cupo y días obligatorios; saldoInicial/fechaSaldoInicial solo se incluyen si se
 *                   declaran (al editar, si no se envían NO cambian). Débito: todo en null.
 */
function validarCuentaParaGuardar_(datos, contexto) {
  if (!datos || typeof datos !== 'object') throw errorValidacion_('No se recibieron datos de la cuenta.');
  const idUsuarioActual = contexto.idUsuarioActual;
  const existente = contexto.existente || null;
  if (!esIdValido_(idUsuarioActual)) throw errorValidacion_('El usuario autenticado no es válido.');

  // El propietario lo fija SIEMPRE el servidor.
  const propietarioEnviado = datos.idUsuario;
  if (propietarioEnviado !== undefined && propietarioEnviado !== null && String(propietarioEnviado).trim() !== '') {
    if (aEnteroId_(propietarioEnviado) !== idUsuarioActual) {
      throw errorValidacion_('Solo puedes administrar tus propias cuentas: el propietario no se puede elegir.');
    }
  }

  // --- Nombre
  if (typeof datos.nombre !== 'string') throw errorValidacion_('El nombre de la cuenta es obligatorio.');
  const nombre = datos.nombre.replace(/\s+/g, ' ').trim();
  if (!nombre) throw errorValidacion_('El nombre de la cuenta es obligatorio.');
  if (nombre.length > LONGITUD_MAXIMA_NOMBRE_CUENTA_) {
    throw errorValidacion_(`El nombre de la cuenta no puede superar ${LONGITUD_MAXIMA_NOMBRE_CUENTA_} caracteres.`);
  }
  if (/[\u0000-\u001F\u007F]/.test(nombre)) throw errorValidacion_('El nombre de la cuenta contiene caracteres no permitidos.');

  // Único por usuario (incluye las inactivas: una cuenta desactivada se puede reactivar).
  const clave = normalizarTexto_(nombre);
  const repetida = (contexto.cuentasExistentes || []).find(c =>
    c.idUsuario === idUsuarioActual && (!existente || c.idCuenta !== existente.idCuenta) && normalizarTexto_(c.nombre) === clave);
  if (repetida) {
    throw errorValidacion_(repetida.activa
      ? `Ya tienes una cuenta llamada "${repetida.nombre}".`
      : `Ya tienes una cuenta llamada "${repetida.nombre}" que está inactiva. Reactívala en lugar de crear otra.`);
  }

  // --- Tipo
  const tipo = canonizarTipoCuenta_(datos.tipo);
  if (tipo !== 'Debito' && tipo !== 'Credito') throw errorValidacion_('El tipo de cuenta debe ser Débito o Crédito.');

  // --- Datos de crédito
  if (tipo === 'Debito') return { nombre, tipo, cupoTotal: null, diaCorte: null, diaPago: null, saldoInicial: null, fechaSaldoInicial: null };

  const cupo = typeof datos.cupoTotal === 'number' ? datos.cupoTotal : parsearNumeroCOP_(datos.cupoTotal);
  if (cupo === null || !isFinite(cupo) || cupo <= 0 || cupo > CUPO_MAXIMO_CUENTA_) {
    throw errorValidacion_('El cupo total de una cuenta de crédito debe ser un número mayor que cero.');
  }
  const dia = (valor, etiqueta) => {
    const n = aEnteroId_(valor);
    if (n === null || n > 31) throw errorValidacion_(`El día de ${etiqueta} debe ser un número entero entre 1 y 31.`);
    return n;
  };
  const credito = { nombre, tipo, cupoTotal: cupo, diaCorte: dia(datos.diaCorte, 'corte'), diaPago: dia(datos.diaPago, 'pago') };
  return Object.assign(credito, validarDeclaracionDeuda_(datos, existente, contexto.hoy));
}

/**
 * Saldo adeudado declarado de una tarjeta y su fecha de referencia. PURA.
 *  - Al CREAR (o convertir una cuenta sin movimientos en tarjeta) son obligatorios: el saldo (0 es válido,
 *    pero hay que declararlo) y su fecha.
 *  - Al EDITAR una tarjeta que ya es tarjeta: si no se envían, NO cambian (se devuelve {}); si se envía uno,
 *    hay que enviar ambos. Una tarjeta sin declarar puede seguir sin declarar.
 *  - Saldo: número >= 0. Fecha: AAAA-MM-DD real y no futura.
 */
function validarDeclaracionDeuda_(datos, existente, hoy) {
  const vacio = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  const sinSaldo = vacio(datos.saldoAdeudado);
  const sinFecha = vacio(datos.fechaSaldo);
  const yaEraTarjeta = !!existente && existente.tipo === 'Credito';

  if (sinSaldo && sinFecha) {
    if (!yaEraTarjeta) throw errorValidacion_('Indica el saldo total que adeudas actualmente en la tarjeta (puede ser 0) y la fecha a la que corresponde.');
    return {};
  }
  if (sinSaldo || sinFecha) throw errorValidacion_('Indica juntos el saldo adeudado y la fecha a la que corresponde.');

  const saldo = typeof datos.saldoAdeudado === 'number' ? datos.saldoAdeudado : parsearNumeroCOP_(datos.saldoAdeudado);
  if (saldo === null || !isFinite(saldo) || saldo < 0 || saldo > CUPO_MAXIMO_CUENTA_) {
    throw errorValidacion_('El saldo adeudado debe ser un número igual o mayor que cero.');
  }
  const fecha = typeof datos.fechaSaldo === 'string' ? datos.fechaSaldo.trim() : '';
  if (!esFechaISOValida_(fecha)) throw errorValidacion_('La fecha del saldo no es válida. Usa el formato AAAA-MM-DD.');
  if (hoy && fecha > hoy) throw errorValidacion_('La fecha del saldo no puede ser futura.');
  return { saldoInicial: saldo, fechaSaldoInicial: fecha };
}

/** El tipo de una cuenta con movimientos no puede cambiar: reinterpretaría todo su historial. PURA. */
function validarCambioDeTipoCuenta_(existente, nuevoTipo, cantidadMovimientos) {
  if (existente && existente.tipo !== nuevoTipo && cantidadMovimientos > 0) {
    throw errorValidacion_('No se puede cambiar el tipo de una cuenta que ya tiene movimientos. Crea una cuenta nueva del tipo que necesitas y desactiva esta.');
  }
}

/** Una tarjeta con deuda no se puede desactivar (inactiva ya no se podría pagar). PURA. */
function validarDesactivacionCuenta_(calculo, nombre) {
  if (calculo && calculo.esCredito && calculo.declarada && calculo.deuda > 0) {
    throw errorValidacion_(`No puedes desactivar la tarjeta "${nombre}": tiene una deuda de ${formatearPesos_(calculo.deuda)}. Cuando la pagues, actualiza su saldo adeudado a 0 y entonces podrás desactivarla.`);
  }
}