/**
 * ApiCuentas.gs
 * Responsabilidad única: la administración de las cuentas del usuario
 * autenticado (Configuración > Mis cuentas). Orquesta Repositorio ->
 * Validaciones, sin conocer la estructura física de la hoja.
 *
 * Funciones públicas (únicas llamables desde el cliente): obtenerCuentasDelUsuarioActual,
 * crearCuenta, actualizarCuenta, cambiarEstadoCuenta. Todas devuelven { cuentas, cuenta }:
 * la lista COMPLETA y actualizada de las cuentas del usuario (activas e inactivas, con
 * cantidadMovimientos) y la cuenta afectada (o null).
 *
 * REGLAS (siempre validadas aquí, nunca solo en la interfaz):
 *  - Cada cuenta pertenece a UN usuario. El ID_Usuario propietario y el ID_Cuenta los
 *    decide EL SERVIDOR (usuario autenticado + generador de IDs); el cliente no puede
 *    elegirlos ni cambiarlos. Nadie puede ver o modificar la gestión de cuentas de otro.
 *  - Una cuenta no se elimina: se DESACTIVA (Estado = 0) y se puede reactivar. Desactivarla
 *    no altera los movimientos históricos ni ningún cálculo (los cálculos no dependen de
 *    la cuenta); solo deja de ofrecerse para movimientos NUEVOS (ver Validaciones.js).
 *  - Nombre único por usuario; tipo Débito/Crédito; para crédito, cupo y días de corte y
 *    pago son obligatorios.
 *  - Un usuario no registrado (o sin ID_Usuario entero) recibe un error: aquí nunca se
 *    cae a usuarios[0], tampoco para consultar.
 */

function contextoCuentas_() {
  const usuario = obtenerUsuarioActualEstricto_(obtenerUsuariosCatalogo_());
  return { idUsuario: obtenerIdUsuario_(usuario) };
}

function respuestaCuentas_(idUsuario, cuenta) {
  const conteo = contarMovimientosPorCuenta_();
  const conDetalle = c => Object.assign({}, c, { cantidadMovimientos: conteo.get(c.idCuenta) || 0 });
  return {
    cuentas: obtenerCuentasDeUsuario_(idUsuario, false).map(conDetalle),
    cuenta: cuenta ? conDetalle(cuenta) : null
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
  const creada = insertarCuenta_(existentes => {
    const v = validarCuentaParaGuardar_(datos, { idUsuarioActual: idUsuario, cuentasExistentes: existentes, existente: null });
    return Object.assign({}, v, { idUsuario, estado: 1 }); // propietario y estado: siempre los fija el servidor
  });
  return respuestaCuentas_(idUsuario, creada);
}

function actualizarCuenta(idCuenta, datos) {
  const { idUsuario } = contextoCuentas_();
  const actualizada = actualizarCuentaPorId_(idCuenta, (actual, todas) => {
    exigirPropietario_(actual, idUsuario);
    return validarCuentaParaGuardar_(datos, { idUsuarioActual: idUsuario, cuentasExistentes: todas, existente: actual });
  });
  if (!actualizada) throw new Error('La cuenta no existe.');
  return respuestaCuentas_(idUsuario, actualizada);
}

function cambiarEstadoCuenta(idCuenta, activa) {
  const { idUsuario } = contextoCuentas_();
  if (activa !== true && activa !== false) throw new Error('El estado de la cuenta no es válido.');
  const actualizada = actualizarCuentaPorId_(idCuenta, actual => {
    exigirPropietario_(actual, idUsuario);
    return { estado: activa ? 1 : 0 };
  });
  if (!actualizada) throw new Error('La cuenta no existe.');
  return respuestaCuentas_(idUsuario, actualizada);
}