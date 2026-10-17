/**
 * RepositorioCuentas.gs
 * Responsabilidad única: leer y escribir la hoja "Cuentas". Es el único
 * archivo que conoce su estructura física.
 *
 * Estructura:
 *   ID_Cuenta | Nombre | Tipo | Cupo_Total | Dia_Corte | Dia_Pago | ID_Usuario | Estado
 *
 * Reglas de integridad que este repositorio garantiza (independientes de la UI):
 *  - ID_Cuenta lo genera SIEMPRE este archivo (entero 1, 2, 3, ...) con
 *    conBloqueo_(); nunca se reutiliza (ver reservarIdSecuencial_).
 *  - ID_Cuenta e ID_Usuario son ENTEROS. Los valores que llegan como texto
 *    (p. ej. desde un selector HTML) se convierten con aEnteroId_().
 *  - ID_Cuenta e ID_Usuario NO se pueden modificar una vez creada la cuenta.
 *  - Una cuenta nunca se elimina físicamente: se desactiva con Estado = 0.
 *
 * Las reglas de NEGOCIO (nombre único por usuario, propietario = usuario
 * autenticado, campos de crédito) las valida la capa API/Validaciones antes de
 * llamar aquí.
 *
 * Modelo devuelto:
 *   { idCuenta (int), nombre, tipo ('Debito'|'Credito'), cupoTotal, diaCorte, diaPago,
 *     idUsuario (int | null si la celda está vacía), estado (1|0), activa (bool) }
 */

const ESQUEMA_CUENTAS_ = {
  hoja: 'Cuentas',
  clavePrimaria: 'idCuenta',
  columnas: [
    { clave: 'idCuenta', encabezado: 'ID_Cuenta', tipo: 'id' },
    { clave: 'nombre', encabezado: 'Nombre', tipo: 'texto' },
    { clave: 'tipo', encabezado: 'Tipo', tipo: 'texto' },
    { clave: 'cupoTotal', encabezado: 'Cupo_Total', tipo: 'numero' },
    { clave: 'diaCorte', encabezado: 'Dia_Corte', tipo: 'numero' },
    { clave: 'diaPago', encabezado: 'Dia_Pago', tipo: 'numero' },
    { clave: 'idUsuario', encabezado: 'ID_Usuario', tipo: 'id' },
    { clave: 'estado', encabezado: 'Estado', tipo: 'estado' }
  ]
};

// Clave del contador de IDs (DocumentProperties). La migración de catálogos sincroniza esta misma clave.
const CLAVE_CONTADOR_CUENTA_ = 'CUENTA';

// El nombre lo escribe una persona: se fuerza formato texto para que Sheets jamás lo interprete como fórmula (=...).
const CLAVES_TEXTO_CUENTAS_ = ['nombre'];

const CAMPOS_EDITABLES_CUENTA_ = ['nombre', 'tipo', 'cupoTotal', 'diaCorte', 'diaPago', 'estado'];

/** 'Débito', 'debito', 'DEBITO' => 'Debito'; 'Crédito' => 'Credito'. Otro texto se conserva. */
function canonizarTipoCuenta_(tipo) {
  const t = normalizarTexto_(tipo);
  if (t === 'debito') return 'Debito';
  if (t === 'credito') return 'Credito';
  return (tipo === null || tipo === undefined) ? '' : String(tipo).trim();
}

function esCuentaCredito_(cuenta) {
  return canonizarTipoCuenta_(cuenta && cuenta.tipo) === 'Credito';
}

function modeloCuenta_(fila) {
  return {
    _fila: fila._fila,
    idCuenta: fila.idCuenta,
    nombre: fila.nombre,
    tipo: canonizarTipoCuenta_(fila.tipo),
    cupoTotal: fila.cupoTotal,
    diaCorte: fila.diaCorte,
    diaPago: fila.diaPago,
    idUsuario: fila.idUsuario,
    estado: fila.estado,
    activa: fila.estado === 1
  };
}

function leerCuentasConFila_() {
  const tabla = leerTablaEsquema_(ESQUEMA_CUENTAS_);
  tabla.cuentas = tabla.filas.filter(f => tieneClavePrimaria_(ESQUEMA_CUENTAS_, f)).map(modeloCuenta_);
  return tabla;
}

/** TODAS las cuentas (activas e inactivas): el catálogo necesita las inactivas para resolver el histórico. */
function obtenerCuentasCatalogo_() {
  return leerCuentasConFila_().cuentas.map(quitarFila_);
}

function obtenerCuentasDeUsuario_(idUsuario, soloActivas) {
  const id = aEnteroId_(idUsuario);
  if (id === null) return [];
  return obtenerCuentasCatalogo_().filter(c => c.idUsuario === id && (!soloActivas || c.activa));
}

function buscarCuentaPorId_(idCuenta) {
  const buscado = aEnteroId_(idCuenta);
  if (buscado === null) return null;
  const encontrada = obtenerCuentasCatalogo_().find(c => c.idCuenta === buscado);
  return encontrada || null;
}

/**
 * Crea una cuenta. `datosOPreparar` es el objeto de la cuenta (sin idCuenta) o una
 * FUNCIÓN que recibe las cuentas existentes (leídas DENTRO del bloqueo) y devuelve ese
 * objeto: así las validaciones que dependen de lo existente (p. ej. nombre único por
 * usuario) son atómicas y dos solicitudes simultáneas no pueden duplicarse. Si la
 * función lanza un error, no se escribe nada. Lanza error si faltan nombre o un
 * idUsuario entero (integridad estructural).
 */
function insertarCuenta_(datosOPreparar) {
  return conBloqueo_(() => {
    const tabla = leerCuentasConFila_();
    const datos = typeof datosOPreparar === 'function' ? datosOPreparar(tabla.cuentas.map(quitarFila_)) : datosOPreparar;

    if (!datos || !String(datos.nombre || '').trim()) throw new Error('La cuenta necesita un nombre.');
    const idUsuario = aEnteroId_(datos.idUsuario);
    if (idUsuario === null) throw new Error('La cuenta necesita un ID_Usuario propietario (entero positivo).');

    const idCuenta = reservarIdSecuencial_(CLAVE_CONTADOR_CUENTA_, tabla.cuentas.map(c => c.idCuenta), 0);
    const modelo = {
      idCuenta,
      nombre: String(datos.nombre).trim(),
      tipo: canonizarTipoCuenta_(datos.tipo),
      cupoTotal: datos.cupoTotal === undefined ? null : datos.cupoTotal,
      diaCorte: datos.diaCorte === undefined ? null : datos.diaCorte,
      diaPago: datos.diaPago === undefined ? null : datos.diaPago,
      idUsuario,
      estado: datos.estado === undefined ? 1 : normalizarEstado_(datos.estado)
    };
    agregarFilasAlFinal_(tabla, [construirFilaDesdeModelo_(tabla, modelo)], CLAVES_TEXTO_CUENTAS_);
    return Object.assign({}, modelo, { activa: modelo.estado === 1 });
  });
}

/**
 * Actualiza campos editables de una cuenta. Rechaza cambiar idCuenta o
 * idUsuario (una cuenta no se transfiere). `cambiosOPreparar` es el objeto de
 * cambios o una FUNCIÓN (cuentaActual, todasLasCuentas) -> cambios que se ejecuta DENTRO
 * del bloqueo (para validar propiedad y unicidad de forma atómica; si lanza error no se
 * escribe nada). Devuelve el modelo actualizado o null si la cuenta no existe.
 */
function actualizarCuentaPorId_(idCuenta, cambiosOPreparar) {
  return conBloqueo_(() => {
    const tabla = leerCuentasConFila_();
    const buscado = aEnteroId_(idCuenta);
    const actual = buscado === null ? null : tabla.cuentas.find(c => c.idCuenta === buscado);
    if (!actual) return null;

    const cambios = (typeof cambiosOPreparar === 'function'
      ? cambiosOPreparar(quitarFila_(actual), tabla.cuentas.map(quitarFila_)) : cambiosOPreparar) || {};

    if ('idCuenta' in cambios && aEnteroId_(cambios.idCuenta) !== actual.idCuenta) {
      throw new Error('El ID de una cuenta no se puede modificar.');
    }
    if ('idUsuario' in cambios && aEnteroId_(cambios.idUsuario) !== actual.idUsuario) {
      throw new Error('El propietario de una cuenta no se puede modificar.');
    }

    const permitidos = {};
    CAMPOS_EDITABLES_CUENTA_.forEach(k => { if (k in cambios) permitidos[k] = cambios[k]; });
    if ('nombre' in permitidos) {
      permitidos.nombre = String(permitidos.nombre || '').trim();
      if (!permitidos.nombre) throw new Error('La cuenta necesita un nombre.');
    }
    if ('tipo' in permitidos) permitidos.tipo = canonizarTipoCuenta_(permitidos.tipo);

    const filaBase = leerFilaCruda_(tabla, actual._fila);
    const fila = construirFilaDesdeModelo_(tabla, permitidos, filaBase);
    escribirFila_(tabla, actual._fila, fila, CLAVES_TEXTO_CUENTAS_);

    const fusionado = Object.assign({}, quitarFila_(actual), permitidos);
    fusionado.estado = normalizarEstado_(fusionado.estado);
    fusionado.activa = fusionado.estado === 1;
    return fusionado;
  });
}

/** Desactivar/reactivar. No existe eliminación física de cuentas. */
function cambiarEstadoCuentaPorId_(idCuenta, activa) {
  return actualizarCuentaPorId_(idCuenta, { estado: activa ? 1 : 0 });
}

/** Solo migración de catálogos: reescribe toda la hoja con la estructura nueva. */
function reemplazarCuentas_(modelos) {
  reemplazarContenidoTabla_(ESQUEMA_CUENTAS_, modelos, { crearSiNoExiste: true });
} 