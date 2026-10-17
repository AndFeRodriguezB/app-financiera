/**
 * Utilidad.gs
 * (Antes se llamaba "Utilidades.gs". Apps Script no permite que un archivo
 * .gs y un archivo .html tengan el mismo nombre en el mismo proyecto, y ya
 * existe "Utilidades.html" en el frontend, así que este archivo se renombró
 * a "Utilidad.gs" — en singular — para evitar el conflicto. Los NOMBRES DE
 * LAS FUNCIONES no cambiaron: Apps Script las expone globalmente sin
 * importar en qué archivo estén escritas, así que ningún otro archivo tuvo
 * que modificar cómo las llama.)
 *
 * Responsabilidad única: helpers compartidos por los repositorios y la capa
 * API. Todas terminan en "_" (privadas: Apps Script bloquea que
 * google.script.run las invoque desde el cliente).
 *
 * FASE 3 (migración a IDs): se agregan al final de este archivo los helpers de
 * identidad estricta, normalización de texto/estado, parseo numérico es-CO y
 * generación de IDs con bloqueo. Las funciones originales NO cambiaron de
 * firma; solo obtenerUsuarioActual_ ahora delega en resolverUsuarioPorCorreo_.
 *
 * DECISIÓN DE FORMATO DE FECHA: toda la aplicación usa fechas como texto
 * plano "AAAA-MM-DD" de punta a punta (retroalimentación punto 2). Nunca se
 * escriben objetos Date en la hoja LOGS: esto evita por completo la
 * ambigüedad entre formatos DD/MM y MM/DD, y permite comparar/ordenar fechas
 * como si fueran texto normal, porque el formato ISO ordena correctamente
 * de forma alfabética.
 */

function obtenerCampo_(objeto, ...nombres) {
  for (const nombre of nombres) {
    const valor = objeto[nombre];
    if (valor !== undefined && valor !== null && valor !== '') return valor;
  }
  return undefined;
}

function obtenerUsuarioActual_(usuarios) {
  // Comportamiento de LECTURA conservado: si el correo no coincide, cae al
  // primer usuario (igual que antes). Las operaciones de ESCRITURA deben usar
  // obtenerUsuarioActualEstricto_() (ver más abajo).
  const encontrado = resolverUsuarioPorCorreo_(usuarios, Session.getActiveUser().getEmail());
  return encontrado || usuarios[0] || {};
}

/**
 * Convierte el valor crudo de una celda de la columna Fecha en un texto
 * "AAAA-MM-DD" confiable, sin importar cómo haya quedado guardada:
 * - Date real (filas antiguas, o si Sheets la autoconvirtió).
 * - texto "AAAA-MM-DD" (el formato que usa la app desde esta versión).
 * - texto "DD/MM/AAAA", "D/M/AAAA", "DD-MM-AAAA" u otras variantes con el
 *   año al final (formato típico si se escribió a mano en la hoja, o si
 *   quedó de una versión anterior de la app).
 * Devuelve null solo si de verdad no puede interpretarla.
 */
function normalizarFechaTexto_(valorCrudo) {
  if (valorCrudo instanceof Date && !isNaN(valorCrudo)) {
    const y = valorCrudo.getFullYear();
    const m = String(valorCrudo.getMonth() + 1).padStart(2, '0');
    const d = String(valorCrudo.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof valorCrudo === 'string') {
    const texto = valorCrudo.trim();
    if (!texto) return null;

    // Caso 1: año al inicio -> "AAAA-MM-DD" o "AAAA/MM/DD" (sin ambigüedad)
    let coincidencia = texto.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (coincidencia) {
      const [, anio, mes, dia] = coincidencia;
      return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
    }

    // Caso 2: año al final -> "DD/MM/AAAA", "MM/DD/AAAA", con guion o slash
    coincidencia = texto.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (coincidencia) {
      const a = Number(coincidencia[1]);
      const b = Number(coincidencia[2]);
      const y = Number(coincidencia[3]);

      let dia, mes;
      if (a > 12 && b <= 12) {
        dia = a; mes = b; // el primero solo puede ser día
      } else if (b > 12 && a <= 12) {
        dia = b; mes = a; // el segundo solo puede ser día -> formato MM/DD/AAAA
      } else {
        dia = a; mes = b; // ambiguo: se asume DD/MM/AAAA (convención colombiana)
      }

      if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
        return `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      }
    }
  }

  return null;
}

/**
 * Fecha de HOY como texto "AAAA-MM-DD", usando componentes LOCALES del
 * servidor (respeta la zona horaria configurada en el proyecto de Apps
 * Script — ver la guía de desarrollo, sección de configuración).
 */
function fechaDeHoyTexto_() {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Valida que un texto recibido del formulario tenga forma "AAAA-MM-DD".
 * Si no es válido o viene vacío, cae de vuelta a la fecha de hoy en vez de
 * guardar un dato corrupto.
 */
function fechaValidaOAhora_(fechaTexto) {
  if (typeof fechaTexto === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaTexto.trim())) {
    return fechaTexto.trim();
  }
  return fechaDeHoyTexto_();
}

/**
 * ¿Este texto "AAAA-MM-DD" pertenece al mes/año indicado?
 */
function perteneceAlMes_(fechaTexto, mes, anio) {
  if (!fechaTexto) return false;
  const partes = fechaTexto.split('-');
  if (partes.length !== 3) return false;
  return Number(partes[1]) === mes && Number(partes[0]) === anio;
}


/* ==========================================================================
 * FASE 3: NORMALIZACIÓN, IDENTIDAD ESTRICTA E IDs
 * ========================================================================== */

/** Minúsculas, sin tildes, espacios colapsados. Para COMPARAR, nunca para guardar. */
function normalizarTexto_(valor) {
  if (valor === null || valor === undefined) return '';
  return valor.toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Clave de encabezado tolerante: "Cupo Total", "cupo_total" y "Cupo_Total" coinciden. */
function normalizarClaveEncabezado_(valor) {
  return normalizarTexto_(valor).replace(/[\s\-]+/g, '_');
}

/**
 * Estado activo/inactivo. 0, "0", false, "inactivo" => 0. Cualquier otro valor
 * (1, "1", TRUE, vacío) => 1: una fila añadida a mano sin Estado no desaparece.
 */
function normalizarEstado_(valor) {
  if (valor === 0 || valor === false) return 0;
  const t = normalizarTexto_(valor);
  if (t === '0' || t === 'false' || t === 'inactivo' || t === 'inactiva') return 0;
  return 1;
}

/**
 * Número en formato es-CO (punto = miles, coma = decimal). Devuelve null si no
 * se puede interpretar. Un valor tipo "1.234" se interpreta como 1234.
 */
function parsearNumeroCOP_(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return isFinite(valor) ? valor : null;
  let t = String(valor).trim().replace(/[\s$]|COP/gi, '');
  if (!t) return null;
  const negativo = t.startsWith('-');
  if (negativo) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t)) return null;

  let n;
  if (t.includes(',')) {
    const partes = t.split(',');
    if (partes.length > 2) return null;
    const entero = partes[0].replace(/\./g, '');
    if (!/^\d*$/.test(entero) || !/^\d+$/.test(partes[1])) return null;
    n = Number((entero || '0') + '.' + partes[1]);
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    n = Number(t.replace(/\./g, ''));
  } else if (/^\d+(\.\d+)?$/.test(t)) {
    n = Number(t);
  } else {
    return null;
  }
  return negativo ? -n : n;
}

/* ---------- Identidad ---------- */

/** Usuario cuyo Correo (admite varios separados por coma) contiene el email. null si no hay. */
function resolverUsuarioPorCorreo_(usuarios, email) {
  const buscado = normalizarTexto_(email);
  if (!buscado) return null; // un correo vacío jamás debe coincidir con nadie
  return (usuarios || []).find(u => {
    const correos = (obtenerCampo_(u, 'Correo', 'correo') || '').toString()
      .split(/[,;]/).map(e => normalizarTexto_(e)).filter(Boolean);
    return correos.includes(buscado);
  }) || null;
}

/**
 * ID_Usuario del usuario como ENTERO positivo, o null si falta o no es un
 * entero válido (p. ej. "user-001"). Acepta filas crudas de Usuarios (texto
 * visible de la celda) y modelos con idUsuario numérico.
 */
function obtenerIdUsuario_(usuario) {
  const u = usuario || {};
  const v = obtenerCampo_(u, 'ID_Usuario', 'idUsuario', 'id_usuario');
  return v === undefined ? null : aEnteroId_(v);
}

/**
 * Para operaciones de ESCRITURA. Nunca cae a usuarios[0]: si la cuenta de
 * Google activa no está registrada en Usuarios, lanza error.
 */
function obtenerUsuarioActualEstricto_(usuarios) {
  const usuario = resolverUsuarioPorCorreo_(usuarios, Session.getActiveUser().getEmail());
  if (!usuario) {
    throw new Error('Tu cuenta de Google no está registrada en la hoja Usuarios. No se puede realizar esta operación.');
  }
  if (obtenerIdUsuario_(usuario) === null) {
    throw new Error('Tu usuario no tiene un ID_Usuario numérico válido (entero positivo) en la hoja Usuarios. No se puede realizar esta operación.');
  }
  return usuario;
}

/* ---------- IDs estables sin reutilización ---------- */

const PREFIJO_PROPIEDAD_ID_ = 'ULTIMO_ID_';
let BLOQUEO_ACTIVO_ = false;

/* ---------- Identificadores ENTEROS (INT) ----------
 * Todos los IDs del proyecto son enteros positivos: 1, 2, 3, ... (sin prefijos).
 * Siempre se comparan y almacenan como número (nunca como texto). Los datos que
 * llegan como texto (celdas, selectores HTML) se convierten con aEnteroId_().
 */

/** Entero positivo (number o texto de solo dígitos) => número. Cualquier otra cosa => null. */
function aEnteroId_(valor) {
  if (typeof valor === 'number') return (Number.isSafeInteger(valor) && valor > 0) ? valor : null;
  if (typeof valor === 'string' && /^\s*\d+\s*$/.test(valor)) {
    const n = Number(valor);
    return (Number.isSafeInteger(n) && n > 0) ? n : null;
  }
  return null;
}

/** ID opcional: vacío => null; válido => número; con valor pero inválido => NaN (para que la validación lo rechace). */
function aEnteroIdOpcional_(valor) {
  if (valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '')) return null;
  const n = aEnteroId_(valor);
  return n === null ? NaN : n;
}

function esIdValido_(valor) {
  return Number.isSafeInteger(valor) && valor > 0;
}

/**
 * max(último emitido, mayor existente) + 1. Solo si no hay NINGÚN ID previo se
 * parte de `minimoPrevio` (así el primer movimiento es 123, como antes y el
 * primer ID de las demás tablas es 1). Función pura.
 */
function calcularSiguienteNumeroId_(ultimoEmitido, idsExistentes, minimoPrevio) {
  let max = Number(ultimoEmitido) || 0;
  (idsExistentes || []).forEach(id => {
    const n = aEnteroId_(id);
    if (n !== null && n > max) max = n;
  });
  if (max === 0) max = Number(minimoPrevio) || 0;
  return max + 1;
}

/** Ejecuta funcion() con el bloqueo del documento tomado. Libera SIEMPRE, incluso si falla. */
function conBloqueo_(funcion, milisegundos) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(milisegundos || 30000);
  const previo = BLOQUEO_ACTIVO_;
  BLOQUEO_ACTIVO_ = true;
  try {
    return funcion();
  } finally {
    BLOQUEO_ACTIVO_ = previo;
    lock.releaseLock();
  }
}

function leerContadorId_(clave) {
  return Number(PropertiesService.getDocumentProperties().getProperty(PREFIJO_PROPIEDAD_ID_ + clave)) || 0;
}

/** El contador solo sube: nunca se reduce, para que un ID emitido jamás se reutilice. */
function sincronizarContadorId_(clave, numero) {
  if (Number(numero) > leerContadorId_(clave)) {
    PropertiesService.getDocumentProperties().setProperty(PREFIJO_PROPIEDAD_ID_ + clave, String(numero));
  }
}

/**
 * Emite el siguiente ID ENTERO de la secuencia "clave". DEBE llamarse dentro de
 * conBloqueo_(): si no, lanza error (evita duplicados por escrituras simultáneas).
 * El contador solo sube, así un ID emitido jamás se reutiliza.
 */
function reservarIdSecuencial_(clave, idsExistentes, minimoPrevio) {
  if (!BLOQUEO_ACTIVO_) {
    throw new Error('reservarIdSecuencial_ debe ejecutarse dentro de conBloqueo_().');
  }
  const numero = calcularSiguienteNumeroId_(leerContadorId_(clave), idsExistentes, minimoPrevio);
  sincronizarContadorId_(clave, numero);
  return numero;
}

/**
 * ¿"AAAA-MM-DD" es una fecha REAL del calendario? normalizarFechaTexto_ (original,
 * sin cambios) solo cambia el formato y acepta "2026-02-31" o "2026-13-05".
 * Esta función se usa donde se necesita rechazar fechas imposibles.
 */
function esFechaISOValida_(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto === null || texto === undefined ? '' : texto));
  if (!m) return false;
  const y = Number(m[1]), mes = Number(m[2]), d = Number(m[3]);
  const f = new Date(y, mes - 1, d);
  return f.getFullYear() === y && f.getMonth() === mes - 1 && f.getDate() === d;
}

/* ==========================================================================
 * RESOLUCIÓN DE NOMBRES PARA PRESENTACIÓN
 * Las relaciones son por ID; el nombre es solo una etiqueta visual. Estos
 * índices resuelven ID -> nombre usando los catálogos COMPLETOS (incluyen
 * los elementos inactivos, para que el histórico siempre se pueda mostrar).
 * ========================================================================== */
function crearIndiceCatalogos_(catalogos) {
  const porId = (lista, clave) => new Map((lista || []).filter(x => x[clave] !== null && x[clave] !== undefined).map(x => [x[clave], x]));
  return {
    usuarios: porId(catalogos.usuarios, 'idUsuario'),
    cuentas: porId(catalogos.cuentas, 'idCuenta'),
    categorias: porId(catalogos.categorias, 'idCategoria'),
    subcategorias: porId(catalogos.subcategorias, 'idSubcategoria')
  };
}

function nombreUsuarioDeId_(indice, id) {
  const u = indice.usuarios.get(id);
  return u ? (obtenerCampo_(u, 'Nombre', 'nombre') || '') : '';
}
function nombreCuentaDeId_(indice, id) { const c = indice.cuentas.get(id); return c ? c.nombre : ''; }
function nombreCategoriaDeId_(indice, id) { const c = indice.categorias.get(id); return c ? c.categoria : ''; }
function nombreSubcategoriaDeId_(indice, id) { const s = indice.subcategorias.get(id); return s ? s.subcategoria : ''; }