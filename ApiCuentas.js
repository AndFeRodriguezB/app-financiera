/**
 * ApiCuentas.gs
 * Responsabilidad única: la administración de las cuentas del usuario
 * autenticado (Configuración > Gestión de cuentas). Orquesta Repositorio ->
 * Validaciones, sin conocer la estructura física de la hoja.
 *
 * Funciones públicas (únicas llamables desde el cliente): obtenerCuentasDelUsuarioActual,
 * crearCuenta, actualizarCuenta, cambiarEstadoCuenta. Todas devuelven
 * { cuentas, cuenta, resumen }: la lista COMPLETA y actualizada de las cuentas del usuario
 * (activas e inactivas), la cuenta afectada (o null) y los totales del usuario.
 *
 * Cada cuenta incluye lo que se CALCULA desde los movimientos (nunca se guarda):
 *  - débito:  saldo (puede ser negativo);
 *  - crédito: deudaDeclarada (bool), deuda y cupoDisponible (null si la tarjeta está "sin declarar").
 *  - cantidadMovimientos.
 *
 * REGLAS (siempre validadas aquí, nunca solo en la interfaz):
 *  - Cada cuenta pertenece a UN usuario. El ID_Usuario propietario y el ID_Cuenta los
 *    decide EL SERVIDOR; el cliente no puede elegirlos ni cambiarlos.
 *  - Una cuenta no se elimina: se DESACTIVA (Estado = 0) y se puede reactivar. Desactivarla no
 *    altera los movimientos históricos; solo deja de ofrecerse para movimientos NUEVOS.
 *  - Cuenta de DÉBITO nueva: saldo 0 (sin movimientos). Tarjeta de CRÉDITO nueva: se declara el
 *    saldo adeudado y su fecha (ver CalculosFinancieros.js > calcularSaldosCuentas_).
 *  - No se puede cambiar el TIPO de una cuenta que ya tiene movimientos.
 *  - No se puede desactivar una tarjeta con deuda mayor que cero.
 *  - Nombre único por usuario; para crédito, cupo y días de corte y pago son obligatorios.
 *  - Un usuario no registrado (o sin ID_Usuario entero) recibe un error: nunca se cae a usuarios[0].
 */

function contextoCuentas_() {
  const usuario = obtenerUsuarioActualEstricto_(obtenerUsuariosCatalogo_());
  return { idUsuario: obtenerIdUsuario_(usuario) };
}

/** Saldos/deuda de las cuentas dadas, calculados desde los movimientos persistidos. */
function calcularSaldosDeCuentas_(cuentas) {
  return calcularSaldosCuentas_({ cuentas, movimientos: obtenerTodosLosMovimientos_(), categorias: obtenerCategorias_() });
}

function detalleCuentaParaCliente_(cuenta, calculo) {
  const d = Object.assign({}, cuenta, { cantidadMovimientos: calculo.cantidadMovimientos });
  if (calculo.esCredito) {
    d.deudaDeclarada = calculo.declarada;
    d.deuda = calculo.deuda;
    d.cupoDisponible = calculo.cupoDisponible;
    // Solo como REFERENCIA para tarjetas sin declarar: no se asume que sigan pendientes.
    d.consumosHistoricosReferencia = calculo.declarada ? null : calculo.consumosHistoricosTotales;
  } else {
    d.saldo = calculo.saldo;
  }
  return d;
}

function respuestaCuentas_(idUsuario, idCuentaAfectada) {
  const propias = obtenerCuentasDeUsuario_(idUsuario, false);
  const calculo = calcularSaldosDeCuentas_(propias);
  const calculoPorId = new Map(calculo.cuentas.map(c => [c.idCuenta, c]));
  const detalle = propias.map(c => detalleCuentaParaCliente_(c, calculoPorId.get(c.idCuenta)));
  return {
    cuentas: detalle,
    cuenta: idCuentaAfectada === null ? null : (detalle.find(c => c.idCuenta === idCuentaAfectada) || null),
    resumen: resumenSaldosDeUsuario_(calculo, idUsuario)
  };
}

function exigirPropietario_(cuenta, idUsuario) {
  if (cuenta.idUsuario !== idUsuario) throw new Error('Solo puedes administrar tus propias cuentas.');
}

function obtenerCuentasDelUsuarioActual() {
  return respuestaCuentas_(contextoCuentas_().idUsuario, null);
}

function crearCuenta(datos) {
  const { idUsuario } = contextoCuentas_();
  const hoy = fechaDeHoyTexto_();
  const creada = insertarCuenta_(existentes => {
    const v = validarCuentaParaGuardar_(datos, { idUsuarioActual: idUsuario, cuentasExistentes: existentes, existente: null, hoy });
    return Object.assign({}, v, { idUsuario, estado: 1 }); // propietario y estado: siempre los fija el servidor
  });
  return respuestaCuentas_(idUsuario, creada.idCuenta);
}

function actualizarCuenta(idCuenta, datos) {
  const { idUsuario } = contextoCuentas_();
  const hoy = fechaDeHoyTexto_();
  const actualizada = actualizarCuentaPorId_(idCuenta, (actual, todas) => {
    exigirPropietario_(actual, idUsuario);
    const v = validarCuentaParaGuardar_(datos, { idUsuarioActual: idUsuario, cuentasExistentes: todas, existente: actual, hoy });
    const propio = calcularSaldosDeCuentas_([actual]).cuentas[0];
    validarCambioDeTipoCuenta_(actual, v.tipo, propio.cantidadMovimientos);
    return v;
  });
  if (!actualizada) throw new Error('La cuenta no existe.');
  return respuestaCuentas_(idUsuario, actualizada.idCuenta);
}

function cambiarEstadoCuenta(idCuenta, activa) {
  const { idUsuario } = contextoCuentas_();
  if (activa !== true && activa !== false) throw new Error('El estado de la cuenta no es válido.');
  const actualizada = actualizarCuentaPorId_(idCuenta, actual => {
    exigirPropietario_(actual, idUsuario);
    if (!activa) validarDesactivacionCuenta_(calcularSaldosDeCuentas_([actual]).cuentas[0], actual.nombre);
    return { estado: activa ? 1 : 0 };
  });
  if (!actualizada) throw new Error('La cuenta no existe.');
  return respuestaCuentas_(idUsuario, actualizada.idCuenta);
}