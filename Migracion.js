/**
 * Migracion.gs
 * Migración NO destructiva de la base de datos antigua (nombres) a la nueva
 * (IDs). Todo el conocimiento de la estructura ANTIGUA (LOGS y catálogos
 * "legacy") vive únicamente aquí; podrá borrarse cuando la migración termine.
 *
 * FLUJO (siempre primero sobre una COPIA de la hoja de cálculo):
 *   0. diagnosticarEstructuraHojas()      -> encabezados y formatos REALES (solo lectura)
 *   1. migrarCatalogos_simular()          -> propuesta + pendientes (no escribe)
 *   2. migrarLogsAMovimientos_simular()   -> propuesta + pendientes (no escribe)
 *   3. ejecutarMigracionCatalogosEnCopia()
 *   4. ejecutarMigracionLogsEnCopia()     (o ...Parcial, solo si lo decides)
 *
 * GARANTÍAS
 *  - LOGS jamás se modifica. Las hojas Cuentas/Categorias/Presupuesto se respaldan
 *    como _legacy_* antes de reescribirse.
 *  - Ningún ID relacional se inventa: lo que no se puede resolver se REPORTA.
 *  - Las simulaciones no escriben nada (el reporte en hoja es opt-in).
 *  - Las funciones que escriben exigen confirmación explícita, un administrador
 *    (si se configura) y que el libro se llame "copia"/"prueba"/"test".
 *  - Idempotente: repetir la migración no duplica ni altera lo ya migrado.
 *  - Todo o nada por defecto: con pendientes no se escribe, salvo permitirParcial.
 *
 * IDs: TODOS son ENTEROS positivos (1, 2, 3, ...). Los IDs antiguos con prefijo
 * (CTA-01, CAT-02, ...) se convierten tomando su número final (CTA-01 -> 1) solo
 * si es único; si no, se asigna el siguiente libre. La hoja Usuarios NO se
 * modifica: sus ID_Usuario deben ser enteros antes de migrar (si no, la
 * migración queda bloqueada con un mensaje claro). Las hojas _legacy_* conservan
 * los IDs originales para trazabilidad.
 *
 * Las funciones analizar*_ son PURAS (reciben arreglos, devuelven resultados):
 * así se prueban sin Google Sheets.
 */

/* ==========================================================================
 * CONFIGURACIÓN (revisar ANTES de ejecutar)
 * ========================================================================== */
const CONFIG_MIGRACION_ = {
  // El libro debe contener alguna de estas marcas en su nombre para permitir escrituras.
  marcasDeCopia: ['copia', 'prueba', 'test'],
  // Escribir en el libro ORIGINAL exige permitirEnOriginal:true Y esto en true.
  // Permanece en false hasta confirmar encabezados y formatos reales y aprobar la migración definitiva.
  migracionDefinitivaHabilitada: false,
  // Correos autorizados a ejecutar escrituras. Vacío = sin restricción adicional.
  administradores: [],

  // Cuentas cuyo propietario es "General"/vacío (el modelo definitivo NO admite cuentas
  // sin propietario): nombre de cuenta -> ID_Usuario ENTERO. Ej.: { 'Efectivo': 1 }.
  // REVISAR EXPLÍCITAMENTE. No se asigna nada por defecto.
  propietariosCuentas: {},
  // Presupuestos con propietario "General"/"Compartido"/vacío (el modelo definitivo
  // exige un ID_Usuario real): ID_Presupuesto ANTIGUO tal como está en la hoja
  // (p. ej. 'PRE-01') -> ID_Usuario ENTERO. Ej.: { 'PRE-01': 1 }.
  propietariosPresupuesto: {},
  // Tipos de cuenta no estándar: texto antiguo -> 'Debito' | 'Credito'. Ej.: { 'Efectivo': 'Debito' }
  mapeoTiposCuenta: {},

  // Alias para textos antiguos de LOGS que no coinciden con el catálogo actual
  // (permite resolverlos SIN tocar LOGS). Siempre apuntan a un ID existente.
  aliasUsuarios: {},        // 'Andy' -> 1
  aliasCuentas: {},         // 'Nubank' -> 2
  aliasCategorias: {},      // 'Comida' -> 1
  aliasSubcategorias: {}    // 'Comida|Super' (categoría|subcategoría) -> 1
};

const PENDIENTE_ = 'PENDIENTE';
const ADVERTENCIA_ = 'ADVERTENCIA';
const INFO_ = 'INFO';

const HOJA_LOGS_ = 'LOGS';
const HOJAS_LEGACY_ = { Cuentas: '_legacy_Cuentas', Categorias: '_legacy_Categorias', Presupuesto: '_legacy_Presupuesto' };
const HOJA_REPORTE_CATALOGOS_ = 'Migracion_Reporte_Catalogos';
const HOJA_REPORTE_MOVIMIENTOS_ = 'Migracion_Reporte_Movimientos';

/* ==========================================================================
 * ESQUEMAS DE LA ESTRUCTURA ANTIGUA (solo lectura)
 * ========================================================================== */
const ESQUEMA_LOGS_LEGACY_ = {
  hoja: HOJA_LOGS_,
  clavePrimaria: 'id',
  columnas: [
    { clave: 'id', encabezado: 'ID', tipo: 'crudo' },
    { clave: 'fecha', encabezado: 'Fecha', tipo: 'crudo' },
    { clave: 'usuario', encabezado: 'Usuario', tipo: 'crudo' },
    { clave: 'pagadoPor', encabezado: 'Pagado Por', alias: ['PagadoPor'], tipo: 'crudo' },
    { clave: 'cuenta', encabezado: 'Cuenta Origen', alias: ['Cuenta', 'CuentaOrigen'], tipo: 'crudo' },
    { clave: 'tipoGasto', encabezado: 'Tipo Gasto', alias: ['TipoGasto'], tipo: 'crudo' },
    { clave: 'categoria', encabezado: 'Categoria', tipo: 'crudo' },
    { clave: 'subcategoria', encabezado: 'Subcategoria', tipo: 'crudo' },
    { clave: 'valor', encabezado: 'Valor', tipo: 'crudo' },
    { clave: 'descripcion', encabezado: 'Descripcion', tipo: 'crudo' }
  ]
};

const ESQUEMA_CUENTAS_LEGACY_ = {
  hoja: 'Cuentas',
  clavePrimaria: 'idCuenta',
  columnas: [
    { clave: 'idCuenta', encabezado: 'ID_Cuenta', tipo: 'crudo' },
    { clave: 'nombre', encabezado: 'Nombre', tipo: 'crudo' },
    { clave: 'tipo', encabezado: 'Tipo', tipo: 'crudo' },
    { clave: 'cupoTotal', encabezado: 'Cupo Total', alias: ['CupoTotal'], tipo: 'crudo' },
    { clave: 'diaCorte', encabezado: 'Dia Corte', alias: ['DiaCorte'], tipo: 'crudo' },
    { clave: 'diaPago', encabezado: 'Dia Pago', alias: ['DiaPago'], tipo: 'crudo' },
    { clave: 'propietario', encabezado: 'Propietario', tipo: 'crudo' }
  ]
};

const ESQUEMA_CATEGORIAS_LEGACY_ = {
  hoja: 'Categorias',
  clavePrimaria: 'idCategoria',
  columnas: [
    { clave: 'idCategoria', encabezado: 'ID_Categoria', tipo: 'crudo' },
    { clave: 'categoria', encabezado: 'Categoria', tipo: 'crudo' },
    { clave: 'subcategoria', encabezado: 'Subcategoria', tipo: 'crudo' },
    { clave: 'tipo', encabezado: 'Tipo', tipo: 'crudo' }
  ]
};

const ESQUEMA_PRESUPUESTO_LEGACY_ = {
  hoja: 'Presupuesto',
  clavePrimaria: 'idPresupuesto',
  columnas: [
    { clave: 'idPresupuesto', encabezado: 'ID_Presupuesto', tipo: 'crudo' },
    { clave: 'categoria', encabezado: 'Categoria', tipo: 'crudo' },
    { clave: 'subcategoria', encabezado: 'Subcategoria', tipo: 'crudo' },
    { clave: 'limite', encabezado: 'Limite', tipo: 'crudo' },
    { clave: 'periodo', encabezado: 'Periodo', tipo: 'crudo' },
    { clave: 'propietario', encabezado: 'Propietario', tipo: 'crudo' }
  ]
};

/* ==========================================================================
 * HELPERS PUROS
 * ========================================================================== */
function t_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function esVacio_(v) { return t_(v) === ''; }

function mapaAlias_(obj) {
  const m = new Map();
  Object.keys(obj || {}).forEach(k => m.set(normalizarTexto_(k), t_(obj[k])));
  return m;
}

/**
 * ID antiguo (texto o número) -> entero. 5 -> 5; "7" -> 7; "CTA-01" -> 1;
 * "user-001" -> 1; "sin números" -> null. Solo para MIGRAR; el resto del
 * sistema exige enteros puros (aEnteroId_).
 */
function idLegacyANumero_(crudo) {
  const directo = aEnteroId_(crudo);
  if (directo !== null) return directo;
  const m = /(\d+)\s*$/.exec(t_(crudo));
  return m ? aEnteroId_(m[1]) : null;
}

/** ¿El ID antiguo ya es un entero puro (no requiere conversión)? */
function esIdLegacyEntero_(crudo) { return aEnteroId_(crudo) !== null; }

function hallazgo_(fase, hoja, fila, campo, valor, severidad, motivo) {
  let v = '';
  if (valor instanceof Date) v = normalizarFechaTexto_(valor) || String(valor);
  else if (valor !== null && valor !== undefined) v = String(valor);
  return { fase, hoja, fila: (fila === null || fila === undefined) ? '' : fila, campo, valor: v, severidad, motivo };
}

/** "10/09/2026" con día y mes <= 12 y distintos: no se sabe si es DD/MM o MM/DD. */
function esFechaAmbigua_(crudo) {
  if (typeof crudo !== 'string') return false;
  const m = crudo.trim().match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a <= 12 && b <= 12 && a !== b;
}

/** Valor de LOGS: solo números o texto numérico inequívoco. "50.000" (¿50 o 50000?) se reporta. */
function parsearValorLogs_(crudo) {
  if (typeof crudo === 'number') return isFinite(crudo) ? { ok: true, valor: crudo } : { ok: false, motivo: 'Número no finito' };
  const t = t_(crudo);
  if (t === '') return { ok: false, motivo: 'Valor vacío' };
  if (/^-?\d+(\.\d+)?$/.test(t) && !/^\d{1,3}(\.\d{3})+$/.test(t)) return { ok: true, valor: Number(t) };
  return { ok: false, motivo: 'Valor de texto ambiguo o no numérico (p. ej. separadores de miles); no se interpreta automáticamente' };
}

function indexarUsuarios_(usuarios, reportar) {
  const porNombre = new Map();
  const porId = new Map();
  (usuarios || []).forEach(u => {
    if (u.idUsuario === null || u.idUsuario === undefined) {
      const crudo = t_(u.idUsuarioCrudo);
      reportar('Usuarios', u._fila, 'ID_Usuario', crudo || u.nombre, PENDIENTE_, crudo
        ? `ID_Usuario "${crudo}" no es un entero positivo. Convierta los IDs de la hoja Usuarios a numéricos (1, 2, 3...) antes de migrar.`
        : 'Usuario sin ID_Usuario');
      return;
    }
    if (porId.has(u.idUsuario)) { reportar('Usuarios', u._fila, 'ID_Usuario', u.idUsuario, PENDIENTE_, 'ID_Usuario duplicado'); return; }
    porId.set(u.idUsuario, u);
    const k = normalizarTexto_(u.nombre);
    if (!k) return;
    if (!porNombre.has(k)) porNombre.set(k, []);
    porNombre.get(k).push(u.idUsuario);
  });
  return { porNombre, porId };
}

function resolverUsuarioPorNombre_(texto, indice, aliasMap) {
  const t = t_(texto);
  if (!t) return { ok: false, motivo: 'Vacío' };
  const k = normalizarTexto_(t);
  if (aliasMap && aliasMap.has(k)) {
    const crudo = aliasMap.get(k);
    const id = aEnteroId_(crudo);
    return (id !== null && indice.porId.has(id)) ? { ok: true, id } : { ok: false, motivo: `El alias apunta a "${crudo}", que no es un ID_Usuario entero existente` };
  }
  const ids = indice.porNombre.get(k) || [];
  if (ids.length === 1) return { ok: true, id: ids[0] };
  if (ids.length === 0) return { ok: false, motivo: 'No existe un usuario con ese nombre' };
  return { ok: false, motivo: `Nombre ambiguo: coincide con ${ids.length} usuarios (${ids.join(', ')})` };
}

function clasificarTipoCuentaLegacy_(texto, mapeoMap) {
  const k = normalizarTexto_(texto);
  if (mapeoMap.has(k)) {
    const v = canonizarTipoCuenta_(mapeoMap.get(k));
    return (v === 'Debito' || v === 'Credito') ? v : null;
  }
  if (k.includes('cred')) return 'Credito';
  if (k.includes('deb')) return 'Debito';
  return null;
}

/* ==========================================================================
 * ANÁLISIS PURO DE CATÁLOGOS
 * entrada = { usuarios:[{idUsuario,nombre,_fila}], cuentas:[legacy], categorias:[legacy], presupuestos:[legacy] }
 * ========================================================================== */
function analizarCatalogosLegacy_(entrada, config) {
  const hallazgos = [];
  const H = (hoja, fila, campo, valor, sev, motivo) => hallazgos.push(hallazgo_('catalogos', hoja, fila, campo, valor, sev, motivo));
  const usuarios = indexarUsuarios_(entrada.usuarios || [], H);
  const aliasUsuarios = mapaAlias_(config.aliasUsuarios);
  const propietariosCuentas = mapaAlias_(config.propietariosCuentas);
  const propietariosPresupuesto = new Map(Object.keys(config.propietariosPresupuesto || {}).map(k => [t_(k), t_(config.propietariosPresupuesto[k])]));
  const SIN_PROPIETARIO_UNICO = ['general', 'compartido'];
  const tiposCuenta = mapaAlias_(config.mapeoTiposCuenta);

  /* ---------- Categorías y subcategorías ---------- */
  const grupos = new Map();
  let filasCategoria = 0;
  (entrada.categorias || []).forEach(f => {
    if (esVacio_(f.idCategoria) && esVacio_(f.categoria) && esVacio_(f.subcategoria) && esVacio_(f.tipo)) return;
    filasCategoria++;
    const nombre = t_(f.categoria);
    if (!nombre) { H('Categorias', f._fila, 'Categoria', f.subcategoria, PENDIENTE_, 'Fila con datos pero sin nombre de categoría'); return; }
    const k = normalizarTexto_(nombre);
    if (!grupos.has(k)) grupos.set(k, { nombre, variantes: new Set(), clases: new Set(), legacyIds: new Set(), filas: [], subs: new Map() });
    const g = grupos.get(k);
    g.variantes.add(nombre);
    g.filas.push(f._fila);
    const tipoTxt = t_(f.tipo);
    if (tipoTxt) {
      const nt = normalizarTexto_(tipoTxt);
      g.clases.add(nt === 'ingreso' ? 'Ingreso' : 'Gasto');
      if (nt !== 'gasto' && nt !== 'ingreso') H('Categorias', f._fila, 'Tipo', tipoTxt, ADVERTENCIA_, 'Tipo no estándar; se trata como Gasto (igual que la lógica actual)');
    }
    if (t_(f.idCategoria)) g.legacyIds.add(t_(f.idCategoria));
    const sub = t_(f.subcategoria);
    if (sub) {
      const ks = normalizarTexto_(sub);
      if (g.subs.has(ks)) H('Categorias', f._fila, 'Subcategoria', sub, ADVERTENCIA_, 'Subcategoría repetida dentro de la misma categoría; se migra una sola vez');
      else g.subs.set(ks, { nombre: sub, fila: f._fila });
    }
  });

  const gruposValidos = [];
  grupos.forEach(g => {
    if (g.clases.size > 1) {
      H('Categorias', g.filas.join(','), 'Tipo', g.nombre, PENDIENTE_, `La categoría "${g.nombre}" aparece con Tipo Gasto e Ingreso a la vez. Corrija el Tipo en la hoja antes de migrar.`);
      return;
    }
    if (g.variantes.size > 1) H('Categorias', g.filas.join(','), 'Categoria', Array.from(g.variantes).join(' | '), ADVERTENCIA_, 'Variantes de escritura de la misma categoría; se unifican bajo el primer nombre');
    let tipo = g.clases.has('Ingreso') ? 'Ingreso' : 'Gasto';
    if (g.clases.size === 0) H('Categorias', g.filas.join(','), 'Tipo', g.nombre, ADVERTENCIA_, 'Tipo vacío; se asume Gasto (igual que la lógica actual)');
    if (normalizarTexto_(g.nombre) === 'ingreso' && tipo !== 'Ingreso') {
      tipo = 'Ingreso';
      H('Categorias', g.filas.join(','), 'Tipo', g.nombre, ADVERTENCIA_, 'La categoría se llama "Ingreso": la lógica actual la trata como ingreso aunque su Tipo diga otra cosa; se conserva ese comportamiento');
    }
    g.tipo = tipo;
    gruposValidos.push(g);
  });

  // IDs de categoría (enteros): se conserva el número del ID antiguo solo si es coherente
  // (un único ID antiguo para todo el grupo, derivable a entero y sin choques con otro grupo).
  const candidatos = new Map();
  gruposValidos.forEach(g => {
    g.candidato = null;
    if (g.legacyIds.size === 1) {
      g.legacyUnico = Array.from(g.legacyIds)[0];
      g.candidato = idLegacyANumero_(g.legacyUnico);
      if (g.candidato !== null) candidatos.set(g.candidato, (candidatos.get(g.candidato) || 0) + 1);
    }
  });
  let maxCat = 0;
  gruposValidos.forEach(g => {
    if (g.candidato !== null && candidatos.get(g.candidato) === 1) { g.idCategoria = g.candidato; maxCat = Math.max(maxCat, g.candidato); }
  });
  let sigCat = maxCat + 1;
  let sigSub = 1;
  const categorias = [];
  const subcategorias = [];
  gruposValidos.forEach(g => {
    if (g.idCategoria === undefined) g.idCategoria = sigCat++;
    else if (!esIdLegacyEntero_(g.legacyUnico)) H('Categorias', g.filas.join(','), 'ID_Categoria', g.legacyUnico, INFO_, `ID antiguo "${g.legacyUnico}" -> ${g.idCategoria}`);
    categorias.push({ idCategoria: g.idCategoria, categoria: g.nombre, tipo: g.tipo, estado: 1 });
    g.subs.forEach(s => {
      subcategorias.push({ idSubcategoria: sigSub++, subcategoria: s.nombre, idCategoria: g.idCategoria, estado: 1 });
    });
  });

  /* ---------- Cuentas ---------- */
  const cuentas = [];
  const filasCuenta = (entrada.cuentas || []).filter(f => !(esVacio_(f.idCuenta) && esVacio_(f.nombre) && esVacio_(f.tipo) && esVacio_(f.propietario)));
  const numerosCuenta = new Map();
  const conteoIds = new Map();
  filasCuenta.forEach(f => {
    const n = idLegacyANumero_(f.idCuenta);
    numerosCuenta.set(f, n);
    if (n !== null) conteoIds.set(n, (conteoIds.get(n) || 0) + 1);
  });
  let maxC = 0;
  conteoIds.forEach((cuantos, n) => { if (cuantos === 1) maxC = Math.max(maxC, n); });
  let sigC = maxC + 1;

  filasCuenta.forEach(f => {
    const nombre = t_(f.nombre);
    if (!nombre) { H('Cuentas', f._fila, 'Nombre', '', PENDIENTE_, 'Cuenta sin nombre'); return; }
    let ok = true;

    // Propietario
    const propTxt = t_(f.propietario);
    const propNorm = normalizarTexto_(propTxt);
    let idUsuario = null;
    if (!propNorm || SIN_PROPIETARIO_UNICO.includes(propNorm)) {
      const asignadoCrudo = propietariosCuentas.get(normalizarTexto_(nombre));
      const asignado = asignadoCrudo === undefined ? null : aEnteroId_(asignadoCrudo);
      if (asignadoCrudo === undefined) {
        ok = false;
        H('Cuentas', f._fila, 'Propietario', propTxt || '(vacío)', PENDIENTE_, `La cuenta "${nombre}" no pertenece a un único usuario (el modelo definitivo no admite cuentas sin propietario). Asigne el propietario en CONFIG_MIGRACION_.propietariosCuentas (ej.: {'${nombre}': 1}). No se asigna automáticamente.`);
      } else if (asignado === null || !usuarios.porId.has(asignado)) {
        ok = false;
        H('Cuentas', f._fila, 'Propietario', asignadoCrudo, PENDIENTE_, 'CONFIG_MIGRACION_.propietariosCuentas debe apuntar a un ID_Usuario ENTERO que exista en Usuarios');
      } else {
        idUsuario = asignado;
        H('Cuentas', f._fila, 'Propietario', propTxt || '(vacío)', ADVERTENCIA_, `Propietario asignado por CONFIG_MIGRACION_.propietariosCuentas -> ${asignado}`);
      }
    } else {
      const idDirecto = aEnteroId_(f.propietario);
      if (idDirecto !== null) {
        if (usuarios.porId.has(idDirecto)) {
          idUsuario = idDirecto;
        } else {
          ok = false;
          H_(pendientes, `Cuentas fila ${i + 2} · Propietario: No existe un usuario con ID ${idDirecto}`);
        }
      } else {
        const r = resolverUsuarioPorNombre_(propTxt, usuarios, aliasUsuarios);

        if (!r.ok) {
          ok = false;
          H_(pendientes, `Cuentas fila ${i + 2} · Propietario: ${r.motivo}`);
        } else {
          idUsuario = r.id;
        }
      }
    }

    // Tipo
    const tipo = clasificarTipoCuentaLegacy_(f.tipo, tiposCuenta);
    if (!tipo) {
      ok = false;
      H('Cuentas', f._fila, 'Tipo', t_(f.tipo) || '(vacío)', PENDIENTE_, `Tipo de cuenta no reconocido. Corrija la hoja o defina CONFIG_MIGRACION_.mapeoTiposCuenta (ej.: {'${normalizarTexto_(f.tipo)}': 'Debito'})`);
    }
    if (!ok) return;

    // Números (no se pierde nada en silencio)
    const num = (campo, crudo) => {
      if (esVacio_(crudo)) return null;
      const n = parsearNumeroCOP_(crudo);
      if (n === null) H('Cuentas', f._fila, campo, crudo, ADVERTENCIA_, 'No se pudo interpretar el número; el campo queda vacío');
      return n;
    };
    const cupoTotal = num('Cupo Total', f.cupoTotal);
    const diaCorte = num('Dia Corte', f.diaCorte);
    const diaPago = num('Dia Pago', f.diaPago);
    [['Dia Corte', diaCorte], ['Dia Pago', diaPago]].forEach(([c, v]) => {
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 31)) H('Cuentas', f._fila, c, v, ADVERTENCIA_, 'Se esperaba un día del mes entre 1 y 31');
    });
    if (tipo === 'Credito' && cupoTotal === null) H('Cuentas', f._fila, 'Cupo Total', '', ADVERTENCIA_, 'Cuenta de crédito sin cupo total');

    // ID
    let idCuenta = numerosCuenta.get(f);
    if (idCuenta === null || conteoIds.get(idCuenta) > 1) {
      idCuenta = sigC++;
      H('Cuentas', f._fila, 'ID_Cuenta', t_(f.idCuenta), ADVERTENCIA_, `ID antiguo ${t_(f.idCuenta) ? '"' + t_(f.idCuenta) + '" duplicado o sin número derivable' : 'vacío'}; se asigna ${idCuenta}`);
    } else if (!esIdLegacyEntero_(f.idCuenta)) {
      H('Cuentas', f._fila, 'ID_Cuenta', t_(f.idCuenta), INFO_, `ID antiguo "${t_(f.idCuenta)}" -> ${idCuenta}`);
    }
    cuentas.push({ idCuenta, nombre, tipo, cupoTotal, diaCorte, diaPago, idUsuario, estado: 1, _filaOrigen: f._fila });
  });

  const vistos = new Map();
  cuentas.forEach(c => {
    const k = c.idUsuario + '|' + normalizarTexto_(c.nombre);
    if (vistos.has(k)) H('Cuentas', c._filaOrigen, 'Nombre', c.nombre, ADVERTENCIA_, `El usuario ${c.idUsuario} ya tiene otra cuenta con el mismo nombre (${vistos.get(k)}); los movimientos antiguos que la nombren serán ambiguos`);
    else vistos.set(k, c.idCuenta);
  });

  /* ---------- Presupuesto ---------- */
  const presupuestos = [];
  const catPorNombre = new Map(categorias.map(c => [normalizarTexto_(c.categoria), c]));
  const filasPres = (entrada.presupuestos || []).filter(f => !(esVacio_(f.idPresupuesto) && esVacio_(f.categoria) && esVacio_(f.subcategoria) && esVacio_(f.limite) && esVacio_(f.propietario)));
  const conteoPres = new Map();
  filasPres.forEach(f => { const n = idLegacyANumero_(f.idPresupuesto); if (n !== null) conteoPres.set(n, (conteoPres.get(n) || 0) + 1); });
  filasPres.forEach(f => {
    let ok = true;
    const idCrudo = t_(f.idPresupuesto);
    const id = idLegacyANumero_(f.idPresupuesto);
    if (!idCrudo) { ok = false; H('Presupuesto', f._fila, 'ID_Presupuesto', '', PENDIENTE_, 'Presupuesto sin ID'); }
    else if (id === null) { ok = false; H('Presupuesto', f._fila, 'ID_Presupuesto', idCrudo, PENDIENTE_, 'No se puede derivar un ID entero del ID antiguo'); }
    else if (conteoPres.get(id) > 1) { ok = false; H('Presupuesto', f._fila, 'ID_Presupuesto', idCrudo, PENDIENTE_, 'ID_Presupuesto duplicado (o dos IDs antiguos con el mismo número)'); }
    else if (!esIdLegacyEntero_(idCrudo)) H('Presupuesto', f._fila, 'ID_Presupuesto', idCrudo, INFO_, `ID antiguo "${idCrudo}" -> ${id}`);

    const cat = catPorNombre.get(normalizarTexto_(f.categoria));
    if (!cat) { ok = false; H('Presupuesto', f._fila, 'Categoria', f.categoria, PENDIENTE_, 'La categoría no existe (o quedó sin resolver en la migración)'); }
    let idSub = null;
    if (cat && !esVacio_(f.subcategoria)) {
      const sub = subcategorias.find(s => s.idCategoria === cat.idCategoria && normalizarTexto_(s.subcategoria) === normalizarTexto_(f.subcategoria));
      if (!sub) { ok = false; H('Presupuesto', f._fila, 'Subcategoria', f.subcategoria, PENDIENTE_, `La subcategoría no existe dentro de "${cat.categoria}"`); }
      else idSub = sub.idSubcategoria;
    }

    let limite = null;
    if (!esVacio_(f.limite)) {
      limite = parsearNumeroCOP_(f.limite);
      if (limite === null) { ok = false; H('Presupuesto', f._fila, 'Limite', f.limite, PENDIENTE_, 'No se pudo interpretar el límite'); }
    } else {
      H('Presupuesto', f._fila, 'Limite', '', ADVERTENCIA_, 'Límite vacío');
    }

    let idUsuario = null;
    const propTxt = t_(f.propietario);
    const propNorm = normalizarTexto_(propTxt);
    if (!propNorm || SIN_PROPIETARIO_UNICO.includes(propNorm)) {
      const asignado = aEnteroId_(propietariosPresupuesto.get(idCrudo));
      if (asignado === null || !usuarios.porId.has(asignado)) {
        ok = false;
        H('Presupuesto', f._fila, 'Propietario', propTxt || '(vacío)', PENDIENTE_, `El presupuesto debe pertenecer a un ID_Usuario real (no existe propietario "${propTxt || 'vacío'}"). Asigne CONFIG_MIGRACION_.propietariosPresupuesto (ej.: {'${idCrudo}': 1}) con un usuario existente.`);
      } else idUsuario = asignado;
    } else {
      const idDirecto = aEnteroId_(f.propietario);
      if (idDirecto !== null) {
        if (usuarios.porId.has(idDirecto)) {
          idUsuario = idDirecto;
        } else {
          ok = false;
          H_(pendientes, `Presupuesto fila ${i + 2} · Propietario: No existe un usuario con ID ${idDirecto}`);
        }
      } else {
        const r = resolverUsuarioPorNombre_(propTxt, usuarios, aliasUsuarios);

        if (!r.ok) {
          ok = false;
          H_(pendientes, `Presupuesto fila ${i + 2} · Propietario: ${r.motivo}`);
        } else {
          idUsuario = r.id;
        }
      }
    }
    if (!ok) return;
    presupuestos.push({ idPresupuesto: id, idCategoria: cat.idCategoria, idSubcategoria: idSub, limite, periodo: t_(f.periodo), idUsuario });
  });

  const pend = hallazgos.filter(h => h.severidad === PENDIENTE_).length;
  return {
    categorias, subcategorias, cuentas, presupuestos, hallazgos,
    resumen: {
      usuariosLeidos: (entrada.usuarios || []).length,
      cuentas: { leidas: filasCuenta.length, migrables: cuentas.length },
      categorias: { filasLeidas: filasCategoria, categoriasMigrables: categorias.length, subcategoriasMigrables: subcategorias.length },
      presupuestos: { leidas: filasPres.length, migrables: presupuestos.length },
      pendientes: pend,
      advertencias: hallazgos.filter(h => h.severidad === ADVERTENCIA_).length
    }
  };
}

/* ==========================================================================
 * ANÁLISIS PURO DE LOGS
 * filas = filas de LOGS con claves lógicas (crudas); catalogos ya con IDs.
 * ========================================================================== */
function construirIndicesResolucion_(catalogos, config) {
  const ignorar = () => {};
  const usuarios = indexarUsuarios_(catalogos.usuarios, ignorar);
  const cuentasPorNombre = new Map();
  const cuentasPorId = new Map();
  (catalogos.cuentas || []).forEach(c => {
    cuentasPorId.set(c.idCuenta, c);
    const k = normalizarTexto_(c.nombre);
    if (!cuentasPorNombre.has(k)) cuentasPorNombre.set(k, []);
    cuentasPorNombre.get(k).push(c);
  });
  const catPorNombre = new Map();
  const catPorId = new Map();
  (catalogos.categorias || []).forEach(c => {
    catPorId.set(c.idCategoria, c);
    const k = normalizarTexto_(c.categoria);
    if (!catPorNombre.has(k)) catPorNombre.set(k, []);
    catPorNombre.get(k).push(c);
  });
  const subPorCat = new Map();
  const subPorId = new Map();
  (catalogos.subcategorias || []).forEach(s => {
    subPorId.set(s.idSubcategoria, s);
    if (!subPorCat.has(s.idCategoria)) subPorCat.set(s.idCategoria, new Map());
    const m = subPorCat.get(s.idCategoria);
    const k = normalizarTexto_(s.subcategoria);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  });
  return {
    usuarios, cuentasPorNombre, cuentasPorId, catPorNombre, catPorId, subPorCat, subPorId,
    aliasUsuarios: mapaAlias_(config.aliasUsuarios), aliasCuentas: mapaAlias_(config.aliasCuentas),
    aliasCategorias: mapaAlias_(config.aliasCategorias), aliasSubcategorias: mapaAlias_(config.aliasSubcategorias)
  };
}

function resolverCuentaLegacy_(texto, idx, idPagador) {
  const t = t_(texto);
  if (!t) return { ok: false, motivo: 'La cuenta está vacía (todo movimiento debe tener cuenta)' };
  const k = normalizarTexto_(t);
  if (idx.aliasCuentas.has(k)) {
    const crudo = idx.aliasCuentas.get(k);
    const id = aEnteroId_(crudo);
    return (id !== null && idx.cuentasPorId.has(id)) ? { ok: true, cuenta: idx.cuentasPorId.get(id) } : { ok: false, motivo: `El alias apunta a "${crudo}", que no es un ID_Cuenta entero existente` };
  }
  const cand = idx.cuentasPorNombre.get(k) || [];
  if (cand.length === 0) return { ok: false, motivo: 'No existe una cuenta con ese nombre en el catálogo (o quedó sin resolver en la migración de catálogos)' };
  if (cand.length === 1) return { ok: true, cuenta: cand[0] };
  const delPagador = idPagador ? cand.filter(c => c.idUsuario === idPagador) : [];
  if (delPagador.length === 1) return { ok: true, cuenta: delPagador[0] };
  return { ok: false, motivo: `Nombre de cuenta ambiguo: lo comparten ${cand.map(c => c.idCuenta).join(', ')} y no se puede decidir por el pagador` };
}

function analizarLogsLegacy_(filas, catalogos, config) {
  const idx = construirIndicesResolucion_(catalogos, config);
  const hallazgos = [];
  const movimientos = [];
  const resumen = { filasTotales: filas.length, vacias: 0, sinId: 0, pendientes: 0, resueltas: 0, sumaValoresResueltas: 0 };
  const idsVistos = new Map();
  const P = (f, campo, valor, motivo) => hallazgo_('logs', HOJA_LOGS_, f._fila, campo, valor, PENDIENTE_, motivo);
  const A = (f, campo, valor, motivo) => hallazgo_('logs', HOJA_LOGS_, f._fila, campo, valor, ADVERTENCIA_, motivo);

  filas.forEach(f => {
    if (['id', 'fecha', 'usuario', 'pagadoPor', 'cuenta', 'tipoGasto', 'categoria', 'subcategoria', 'valor', 'descripcion'].every(k => esVacio_(f[k]))) {
      resumen.vacias++; return;
    }
    if (esVacio_(f.id)) {
      resumen.sinId++;
      hallazgos.push(hallazgo_('logs', HOJA_LOGS_, f._fila, 'ID', '', INFO_, 'Fila con datos pero sin ID: la aplicación actual tampoco la leía; no se migra. Permanece en LOGS.'));
      return;
    }

    const problemas = [];
    const avisos = [];

    const idNum = Number(t_(f.id));
    let id = null;
    if (!Number.isInteger(idNum) || idNum <= 0) problemas.push(P(f, 'ID', f.id, 'El ID no es un entero positivo'));
    else if (idsVistos.has(idNum)) problemas.push(P(f, 'ID', f.id, `ID duplicado: ya aparece en la fila ${idsVistos.get(idNum)} de LOGS`));
    else { idsVistos.set(idNum, f._fila); id = idNum; }

    const fecha = normalizarFechaTexto_(f.fecha);
    if (!fecha) problemas.push(P(f, 'Fecha', f.fecha, 'No se pudo interpretar la fecha'));
    else if (!esFechaISOValida_(fecha)) problemas.push(P(f, 'Fecha', f.fecha, `La fecha no existe en el calendario (${fecha})`));
    else if (esFechaAmbigua_(f.fecha)) avisos.push(A(f, 'Fecha', f.fecha, `Fecha ambigua; se interpretó como DD/MM/AAAA -> ${fecha}`));

    const ru = resolverUsuarioPorNombre_(f.usuario, idx.usuarios, idx.aliasUsuarios);
    if (!ru.ok) problemas.push(P(f, 'Usuario', f.usuario, ru.motivo));
    const idUsuario = ru.ok ? ru.id : null;

    let idPagador = null;
    if (esVacio_(f.pagadoPor)) {
      if (idUsuario) { idPagador = idUsuario; avisos.push(A(f, 'Pagado Por', '', 'Vacío; se usó el Usuario que registró (igual que hace hoy Análisis). El Dashboard actual no contaba estas filas.')); }
    } else {
      const rp = resolverUsuarioPorNombre_(f.pagadoPor, idx.usuarios, idx.aliasUsuarios);
      if (rp.ok) idPagador = rp.id; else problemas.push(P(f, 'Pagado Por', f.pagadoPor, rp.motivo));
    }

    const rc = resolverCuentaLegacy_(f.cuenta, idx, idPagador);
    let idCuenta = null;
    if (!rc.ok) problemas.push(P(f, 'Cuenta', f.cuenta, rc.motivo));
    else {
      idCuenta = rc.cuenta.idCuenta;
      if (idPagador && rc.cuenta.idUsuario !== idPagador) {
        avisos.push(A(f, 'Cuenta', f.cuenta, `La cuenta ${idCuenta} pertenece a ${rc.cuenta.idUsuario}, no al pagador ${idPagador}. Se migra tal cual (histórico).`));
      }
    }

    const tg = normalizarTexto_(f.tipoGasto);
    let tipoGasto = 'Propio';
    if (tg === 'compartido') tipoGasto = 'Compartido';
    else if (tg !== '' && tg !== 'propio') avisos.push(A(f, 'Tipo Gasto', f.tipoGasto, 'Valor no reconocido; se usó Propio (igual que la lógica actual)'));

    // Categoría
    let idCategoria = null;
    let catObj = null;
    const catTxt = t_(f.categoria);
    const kc = normalizarTexto_(catTxt);
    if (!catTxt) problemas.push(P(f, 'Categoria', '', 'La categoría está vacía'));
    else if (idx.aliasCategorias.has(kc)) {
      const acrudo = idx.aliasCategorias.get(kc);
      const aid = aEnteroId_(acrudo);
      if (aid !== null && idx.catPorId.has(aid)) { catObj = idx.catPorId.get(aid); idCategoria = aid; }
      else problemas.push(P(f, 'Categoria', catTxt, `El alias apunta a "${acrudo}", que no es un ID_Categoria entero existente`));
    } else {
      const cand = idx.catPorNombre.get(kc) || [];
      if (cand.length === 1) { catObj = cand[0]; idCategoria = catObj.idCategoria; }
      else if (cand.length === 0) problemas.push(P(f, 'Categoria', catTxt, 'No existe una categoría con ese nombre en el catálogo (o quedó sin resolver en la migración de catálogos)'));
      else problemas.push(P(f, 'Categoria', catTxt, `Nombre de categoría ambiguo: ${cand.map(c => c.idCategoria).join(', ')}`));
    }

    // Subcategoría
    let idSubcategoria = null;
    const subTxt = t_(f.subcategoria);
    if (subTxt && catObj) {
      const ka = kc + '|' + normalizarTexto_(subTxt);
      if (idx.aliasSubcategorias.has(ka)) {
        const acrudo = idx.aliasSubcategorias.get(ka);
        const aid = aEnteroId_(acrudo);
        const s = aid === null ? undefined : idx.subPorId.get(aid);
        if (s && s.idCategoria === idCategoria) idSubcategoria = aid;
        else problemas.push(P(f, 'Subcategoria', subTxt, `El alias apunta a "${acrudo}", que no es un ID_Subcategoria entero existente dentro de la categoría ${idCategoria}`));
      } else {
        const cand = (idx.subPorCat.get(idCategoria) || new Map()).get(normalizarTexto_(subTxt)) || [];
        if (cand.length === 1) idSubcategoria = cand[0].idSubcategoria;
        else if (cand.length === 0) problemas.push(P(f, 'Subcategoria', subTxt, `No existe esa subcategoría dentro de la categoría "${catObj.categoria}"`));
        else problemas.push(P(f, 'Subcategoria', subTxt, `Subcategoría ambigua: ${cand.map(c => c.idSubcategoria).join(', ')}`));
      }
    }

    const pv = parsearValorLogs_(f.valor);
    let valor = null;
    if (!pv.ok) problemas.push(P(f, 'Valor', f.valor, pv.motivo));
    else { valor = pv.valor; if (valor <= 0) avisos.push(A(f, 'Valor', f.valor, 'Valor cero o negativo; se migra tal cual (histórico)')); }

    if (problemas.length) {
      resumen.pendientes++;
      problemas.forEach(p => hallazgos.push(p));
      return;
    }
    avisos.forEach(a => hallazgos.push(a));
    movimientos.push({
      id, fecha, idUsuario, idUsuarioPagador: idPagador, idCuenta, tipoGasto, idCategoria, idSubcategoria,
      valor, descripcion: (f.descripcion === null || f.descripcion === undefined) ? '' : String(f.descripcion), _filaLogs: f._fila
    });
    resumen.resueltas++;
    resumen.sumaValoresResueltas += valor;
  });

  resumen.reconciliado = (resumen.vacias + resumen.sinId + resumen.pendientes + resumen.resueltas) === resumen.filasTotales;
  return { movimientos, hallazgos, resumen };
}

const CAMPOS_COMPARABLES_MOVIMIENTO_ = ['fecha', 'idUsuario', 'idUsuarioPagador', 'idCuenta', 'tipoGasto', 'idCategoria', 'idSubcategoria', 'valor', 'descripcion'];

function diferenciasMovimiento_(a, b) {
  return CAMPOS_COMPARABLES_MOVIMIENTO_.filter(k => {
    if (k === 'valor') return Math.abs(Number(a.valor) - Number(b.valor)) > 1e-9;
    return t_(a[k]) !== t_(b[k]);
  });
}

/** Separa lo resuelto en: por escribir, ya migrado idéntico (omitir) y conflicto (mismo ID, distinto contenido). */
function clasificarContraExistentes_(resueltas, existentes) {
  const porId = new Map((existentes || []).map(m => [m.id, m]));
  const aEscribir = [], omitidas = [], conflictos = [], hallazgosConflicto = [];
  resueltas.forEach(m => {
    const e = porId.get(m.id);
    if (!e) aEscribir.push(m);
    else {
      const dif = diferenciasMovimiento_(m, e);
      if (!dif.length) omitidas.push(m);
      else {
        conflictos.push(m);
        hallazgosConflicto.push(hallazgo_('logs', HOJA_MOVIMIENTOS_, m._filaLogs, 'ID', m.id, PENDIENTE_, `El ID ${m.id} ya existe en Movimientos con contenido distinto (${dif.join(', ')}). No se sobrescribe.`));
      }
    }
  });
  return { aEscribir, omitidas, conflictos, hallazgosConflicto };
}

/* ==========================================================================
 * LECTURA DESDE HOJAS
 * ========================================================================== */
function leerUsuariosParaMigracion_() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Usuarios')) throw new Error('No existe la hoja "Usuarios".');
  return obtenerDatosDinamicos_('Usuarios')
    .map((u, i) => {
      const crudo = obtenerCampo_(u, 'ID_Usuario', 'idUsuario', 'id_usuario');
      return { _fila: i + 2, idUsuarioCrudo: t_(crudo), idUsuario: aEnteroId_(crudo), nombre: t_(obtenerCampo_(u, 'Nombre', 'nombre')) };
    })
    .filter(u => u.idUsuarioCrudo || u.nombre);
}

function leerCatalogosLegacyParaMigracion_() {
  return {
    cuentas: leerTablaEsquema_(ESQUEMA_CUENTAS_LEGACY_).filas,
    categorias: leerTablaEsquema_(ESQUEMA_CATEGORIAS_LEGACY_).filas,
    presupuestos: leerTablaEsquema_(ESQUEMA_PRESUPUESTO_LEGACY_, { opcional: true }).filas
  };
}

function clasificarEstructura_(nombre, esquemaNuevo, esquemaLegacy) {
  const nuevo = detectarEstructuraHoja_(nombre, esquemaNuevo);
  if (nuevo === 'inexistente' || nuevo === 'vacia') return nuevo;
  const esNueva = nuevo === 'coincide';
  const esLegacy = esquemaLegacy ? detectarEstructuraHoja_(nombre, esquemaLegacy) === 'coincide' : false;
  if (esNueva && esLegacy) return 'mixta';
  if (esNueva) return 'nueva';
  if (esLegacy) return 'legacy';
  return 'desconocida';
}

function filasDeDatos_(nombre) {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  return h ? Math.max(h.getLastRow() - 1, 0) : 0;
}

/** global: 'legacy' (migrable) | 'nueva' (ya migrado) | 'inconsistente' */
function clasificarEstadoCatalogos_() {
  const e = {
    cuentas: clasificarEstructura_('Cuentas', ESQUEMA_CUENTAS_, ESQUEMA_CUENTAS_LEGACY_),
    categorias: clasificarEstructura_('Categorias', ESQUEMA_CATEGORIAS_, ESQUEMA_CATEGORIAS_LEGACY_),
    subcategorias: clasificarEstructura_('Subcategorias', ESQUEMA_SUBCATEGORIAS_, null),
    presupuesto: clasificarEstructura_('Presupuesto', ESQUEMA_PRESUPUESTO_, ESQUEMA_PRESUPUESTO_LEGACY_)
  };
  const subSinDatos = ['inexistente', 'vacia'].includes(e.subcategorias) || (e.subcategorias === 'nueva' && filasDeDatos_('Subcategorias') === 0);
  let global = 'inconsistente';
  if (e.cuentas === 'legacy' && e.categorias === 'legacy' && subSinDatos && ['legacy', 'inexistente', 'vacia'].includes(e.presupuesto)) global = 'legacy';
  else if (e.cuentas === 'nueva' && e.categorias === 'nueva' && e.subcategorias === 'nueva' && ['nueva', 'inexistente', 'vacia'].includes(e.presupuesto)) global = 'nueva';
  return { global, detalle: e };
}

/* ==========================================================================
 * SEGURIDAD DE LAS ESCRITURAS
 * ========================================================================== */
function exigirAdministrador_() {
  const lista = (CONFIG_MIGRACION_.administradores || []).map(normalizarTexto_).filter(Boolean);
  if (!lista.length) return;
  const email = normalizarTexto_(Session.getActiveUser().getEmail());
  if (!lista.includes(email)) throw new Error('Solo un administrador configurado puede ejecutar la migración.');
}

function exigirPermisoEscritura_(opciones, nombreFuncion) {
  if (!opciones || opciones.confirmarEscritura !== true) {
    throw new Error(`${nombreFuncion} escribe en la hoja de cálculo. Ejecute uno de los wrappers ejecutarMigracion...EnCopia() o pase {confirmarEscritura:true}.`);
  }
  exigirAdministrador_();
  const nombre = normalizarTexto_(SpreadsheetApp.getActiveSpreadsheet().getName());
  const esCopia = (CONFIG_MIGRACION_.marcasDeCopia || []).some(m => nombre.includes(normalizarTexto_(m)));
  if (esCopia) return;
  if (opciones.permitirEnOriginal !== true) {
    throw new Error('Este libro no parece una copia de prueba (su nombre no contiene: ' + CONFIG_MIGRACION_.marcasDeCopia.join(', ') + '). Haga una copia del libro y ejecute allí.');
  }
  if (CONFIG_MIGRACION_.migracionDefinitivaHabilitada !== true) {
    throw new Error('La migración definitiva está BLOQUEADA (CONFIG_MIGRACION_.migracionDefinitivaHabilitada = false) hasta confirmar encabezados/formatos reales y aprobar los resultados en la copia.');
  }
}

/* ==========================================================================
 * REPORTES
 * ========================================================================== */
function registrarResumenMigracion_(titulo, resultado) {
  Logger.log(`=== ${titulo} === estado: ${resultado.estado}`);
  if (resultado.mensaje) Logger.log(resultado.mensaje);
  if (resultado.resumen) Logger.log('Resumen: ' + JSON.stringify(resultado.resumen));
  (resultado.hallazgos || []).slice(0, 300).forEach(h => {
    Logger.log(`[${h.severidad}] ${h.hoja} fila ${h.fila} · ${h.campo}: ${h.motivo}${h.valor !== '' ? ' (valor: ' + h.valor + ')' : ''}`);
  });
  if ((resultado.hallazgos || []).length > 300) Logger.log(`... y ${resultado.hallazgos.length - 300} hallazgos más (use escribirReporte:true para verlos todos).`);
}

/** Escribe SOLO la hoja de reporte indicada (nunca hojas de datos). Formato texto para evitar fórmulas. */
function guardarReporteMigracion_(nombreHoja, resultado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(nombreHoja) || ss.insertSheet(nombreHoja);
  hoja.clearContents();
  const filas = [['Estado', resultado.estado, '', '', '', '', '', '']];
  Object.keys(resultado.resumen || {}).forEach(k => filas.push([k, JSON.stringify(resultado.resumen[k]), '', '', '', '', '', '']));
  filas.push(['', '', '', '', '', '', '', '']);
  filas.push(['Severidad', 'Fase', 'Hoja', 'Fila', 'Campo', 'Valor', 'Motivo', '']);
  (resultado.hallazgos || []).forEach(h => filas.push([h.severidad, h.fase, h.hoja, h.fila, h.campo, h.valor, h.motivo, '']));
  const rango = hoja.getRange(1, 1, filas.length, 8);
  rango.setNumberFormat('@');
  rango.setValues(filas.map(f => f.map(x => String(x))));
  SpreadsheetApp.flush();
}

/* ==========================================================================
 * CATÁLOGOS: simulación y ejecución
 * ========================================================================== */
function migrarCatalogos_simular(opciones) {
  opciones = opciones || {};
  const estado = clasificarEstadoCatalogos_();
  let resultado;
  if (estado.global === 'nueva') {
    resultado = { estado: 'ya_migrado', mensaje: 'Cuentas, Categorias y Subcategorias ya tienen la estructura nueva. No hay nada que migrar.', estructura: estado.detalle, hallazgos: [], resumen: {} };
  } else if (estado.global !== 'legacy') {
    resultado = { estado: 'inconsistente', mensaje: 'Las hojas de catálogo están en un estado mixto o desconocido; no se puede migrar automáticamente. Restaure la copia o revise las hojas.', estructura: estado.detalle, hallazgos: [], resumen: {} };
  } else {
    const entrada = Object.assign({ usuarios: leerUsuariosParaMigracion_() }, leerCatalogosLegacyParaMigracion_());
    const an = analizarCatalogosLegacy_(entrada, CONFIG_MIGRACION_);
    resultado = {
      estado: an.resumen.pendientes > 0 ? 'bloqueado' : 'listo',
      mensaje: an.resumen.pendientes > 0 ? `Hay ${an.resumen.pendientes} pendiente(s) que impiden migrar (salvo permitirParcial).` : 'Sin pendientes: la migración de catálogos puede ejecutarse en la copia.',
      estructura: estado.detalle,
      propuesta: { cuentas: an.cuentas, categorias: an.categorias, subcategorias: an.subcategorias, presupuestos: an.presupuestos },
      hallazgos: an.hallazgos, resumen: an.resumen
    };
  }
  registrarResumenMigracion_('migrarCatalogos_simular', resultado);
  if (opciones.escribirReporte === true) guardarReporteMigracion_(HOJA_REPORTE_CATALOGOS_, resultado);
  return resultado;
}

function maxNumeroId_(modelos, clave) {
  return modelos.reduce((m, x) => Math.max(m, aEnteroId_(x[clave]) || 0), 0);
}

/** La hoja Usuarios no se migra: sus ID_Usuario deben ser enteros. Lanza un error accionable si no. */
function exigirUsuariosConIdEntero_(usuarios) {
  const malos = usuarios.filter(u => u.idUsuario === null);
  if (malos.length) {
    throw new Error('La hoja Usuarios tiene ID_Usuario que no son enteros positivos: ' +
      malos.map(u => `fila ${u._fila} ("${u.idUsuarioCrudo}")`).join(', ') +
      '. Conviértalos a numéricos (1, 2, 3...) en la hoja Usuarios antes de continuar.');
  }
}

function validarCatalogosMigrados_(esperado) {
  const errores = [];
  const c = obtenerCatalogos_();
  const usuarios = new Set(leerUsuariosParaMigracion_().map(u => u.idUsuario).filter(v => v !== null));
  if (c.cuentas.length !== esperado.cuentas.length) errores.push(`Cuentas: se esperaban ${esperado.cuentas.length} y hay ${c.cuentas.length}`);
  if (c.categorias.length !== esperado.categorias.length) errores.push(`Categorias: se esperaban ${esperado.categorias.length} y hay ${c.categorias.length}`);
  if (c.subcategorias.length !== esperado.subcategorias.length) errores.push(`Subcategorias: se esperaban ${esperado.subcategorias.length} y hay ${c.subcategorias.length}`);
  if (c.presupuestos.length !== esperado.presupuestos.length) errores.push(`Presupuesto: se esperaban ${esperado.presupuestos.length} y hay ${c.presupuestos.length}`);
  const dup = (arr, k) => arr.length !== new Set(arr.map(x => x[k])).size;
  if (dup(c.cuentas, 'idCuenta')) errores.push('IDs de cuenta duplicados');
  if (dup(c.categorias, 'idCategoria')) errores.push('IDs de categoría duplicados');
  if (dup(c.subcategorias, 'idSubcategoria')) errores.push('IDs de subcategoría duplicados');
  const cats = new Set(c.categorias.map(x => x.idCategoria));
  c.cuentas.forEach(x => { if (!usuarios.has(x.idUsuario)) errores.push(`Cuenta ${x.idCuenta}: ID_Usuario ${x.idUsuario} no existe`); });
  c.subcategorias.forEach(x => { if (!cats.has(x.idCategoria)) errores.push(`Subcategoría ${x.idSubcategoria}: ID_Categoria ${x.idCategoria} no existe`); });
  c.presupuestos.forEach(x => {
    if (!cats.has(x.idCategoria)) errores.push(`Presupuesto ${x.idPresupuesto}: categoría inexistente`);
    if (!usuarios.has(x.idUsuario)) errores.push(`Presupuesto ${x.idPresupuesto}: usuario inexistente`);
  });
  return { ok: errores.length === 0, errores };
}

function migrarCatalogos(opciones) {
  opciones = opciones || {};
  exigirPermisoEscritura_(opciones, 'migrarCatalogos');

  const sim = migrarCatalogos_simular({});
  if (sim.estado === 'ya_migrado') return sim;
  if (sim.estado === 'inconsistente') throw new Error(sim.mensaje);
  if (sim.estado === 'bloqueado' && opciones.permitirParcial !== true) {
    if (opciones.escribirReporte !== false) guardarReporteMigracion_(HOJA_REPORTE_CATALOGOS_, sim);
    return sim;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const conRespaldo = Object.keys(HOJAS_LEGACY_).filter(n => ss.getSheetByName(n));
  const yaExisten = conRespaldo.map(n => HOJAS_LEGACY_[n]).filter(n => ss.getSheetByName(n));
  if (yaExisten.length) {
    throw new Error('Ya existe(n) la(s) hoja(s) de respaldo ' + yaExisten.join(', ') + '. No se sobrescriben: revise el estado de la copia antes de continuar.');
  }

  // 1) Respaldos
  conRespaldo.forEach(n => ss.getSheetByName(n).copyTo(ss).setName(HOJAS_LEGACY_[n]));

  // 2) Escritura de la estructura nueva
  const p = sim.propuesta;
  reemplazarCuentas_(p.cuentas);
  reemplazarCategorias_(p.categorias);
  reemplazarSubcategorias_(p.subcategorias);
  if (ss.getSheetByName('Presupuesto')) reemplazarPresupuestos_(p.presupuestos);

  // 3) Contadores de IDs (nunca reutilizar)
  conBloqueo_(() => {
    sincronizarContadorId_(CLAVE_CONTADOR_CUENTA_, maxNumeroId_(p.cuentas, 'idCuenta'));
    sincronizarContadorId_(CLAVE_CONTADOR_CATEGORIA_, maxNumeroId_(p.categorias, 'idCategoria'));
    sincronizarContadorId_(CLAVE_CONTADOR_SUBCATEGORIA_, maxNumeroId_(p.subcategorias, 'idSubcategoria'));
  });

  // 4) Validación posterior
  const validacion = validarCatalogosMigrados_(p);
  const resultado = {
    estado: validacion.ok ? (sim.estado === 'bloqueado' ? 'parcial' : 'completa') : 'error_validacion',
    mensaje: validacion.ok ? 'Catálogos migrados. Respaldos en hojas _legacy_*.' : 'La validación posterior encontró errores: ' + validacion.errores.join('; '),
    validacion, respaldos: conRespaldo.map(n => HOJAS_LEGACY_[n]), hallazgos: sim.hallazgos, resumen: sim.resumen
  };
  registrarResumenMigracion_('migrarCatalogos', resultado);
  if (opciones.escribirReporte !== false) guardarReporteMigracion_(HOJA_REPORTE_CATALOGOS_, resultado);
  return resultado;
}

/* ==========================================================================
 * LOGS -> MOVIMIENTOS: simulación y ejecución
 * ========================================================================== */
function prepararMigracionLogs_() {
  const estadoCat = clasificarEstadoCatalogos_();
  const usuarios = leerUsuariosParaMigracion_();
  exigirUsuariosConIdEntero_(usuarios);
  let catalogos, origen;
  if (estadoCat.global === 'nueva') {
    const c = obtenerCatalogos_();
    catalogos = { usuarios, cuentas: c.cuentas, categorias: c.categorias, subcategorias: c.subcategorias };
    origen = 'hojas_nuevas';
  } else if (estadoCat.global === 'legacy') {
    const an = analizarCatalogosLegacy_(Object.assign({ usuarios }, leerCatalogosLegacyParaMigracion_()), CONFIG_MIGRACION_);
    catalogos = { usuarios, cuentas: an.cuentas, categorias: an.categorias, subcategorias: an.subcategorias };
    origen = 'propuesta_catalogos_legacy';
  } else {
    throw new Error('Los catálogos están en un estado inconsistente; ejecute migrarCatalogos_simular() para ver el detalle.');
  }

  const logs = leerTablaEsquema_(ESQUEMA_LOGS_LEGACY_).filas;
  const analisis = analizarLogsLegacy_(logs, catalogos, CONFIG_MIGRACION_);

  const estMov = detectarEstructuraHoja_(HOJA_MOVIMIENTOS_, ESQUEMA_MOVIMIENTOS_);
  let existentes = [];
  if (estMov === 'coincide') existentes = obtenerTodosLosMovimientos_();
  else if (estMov === 'no_coincide') throw new Error('La hoja Movimientos existe pero no tiene la estructura esperada; no se escribirá en ella.');

  const clasif = clasificarContraExistentes_(analisis.movimientos, existentes);
  return { origen, catalogos, analisis, clasif, existentes: existentes.length };
}

function armarResultadoLogs_(p) {
  const pendientes = p.analisis.resumen.pendientes + p.clasif.conflictos.length;
  const hallazgos = p.analisis.hallazgos.concat(p.clasif.hallazgosConflicto);
  const resumen = Object.assign({}, p.analisis.resumen, {
    origenCatalogos: p.origen,
    yaExistentesEnMovimientos: p.existentes,
    omitidasYaMigradas: p.clasif.omitidas.length,
    conflictosConExistentes: p.clasif.conflictos.length,
    aEscribir: p.clasif.aEscribir.length,
    sumaAEscribir: p.clasif.aEscribir.reduce((s, m) => s + m.valor, 0),
    filasPendientesTotal: pendientes
  });
  return { pendientes, hallazgos, resumen };
}

function migrarLogsAMovimientos_simular(opciones) {
  opciones = opciones || {};
  const p = prepararMigracionLogs_();
  const r = armarResultadoLogs_(p);
  const resultado = {
    estado: r.pendientes > 0 ? 'bloqueado' : (p.clasif.aEscribir.length === 0 ? 'sin_cambios' : 'listo'),
    mensaje: r.pendientes > 0 ? `Hay ${r.pendientes} fila(s) sin resolver que impiden migrar (salvo permitirParcial).` :
      (p.origen === 'propuesta_catalogos_legacy' ? 'Simulación basada en la PROPUESTA de catálogos (aún no migrados).' : 'Simulación basada en los catálogos ya migrados.'),
    movimientosPropuestos: p.clasif.aEscribir, hallazgos: r.hallazgos, resumen: r.resumen
  };
  registrarResumenMigracion_('migrarLogsAMovimientos_simular', resultado);
  if (opciones.escribirReporte === true) guardarReporteMigracion_(HOJA_REPORTE_MOVIMIENTOS_, resultado);
  return resultado;
}

function validarMigracionLogs_(p) {
  const errores = [];
  const finales = new Map(obtenerTodosLosMovimientos_().map(m => [m.id, m]));
  const esperados = p.clasif.aEscribir.concat(p.clasif.omitidas);
  let sumaEsperada = 0, sumaEncontrada = 0, encontrados = 0;
  esperados.forEach(m => {
    sumaEsperada += m.valor;
    const f = finales.get(m.id);
    if (!f) { errores.push(`ID ${m.id}: no se encontró en Movimientos`); return; }
    encontrados++;
    sumaEncontrada += f.valor;
    const dif = diferenciasMovimiento_(m, f);
    if (dif.length) errores.push(`ID ${m.id}: difiere en ${dif.join(', ')}`);
  });
  if (Math.abs(sumaEsperada - sumaEncontrada) > 1e-6) errores.push(`La suma de valores no coincide: esperada ${sumaEsperada}, encontrada ${sumaEncontrada}`);
  if (!p.analisis.resumen.reconciliado) errores.push('La clasificación de filas de LOGS no cuadra con el total');
  return { ok: errores.length === 0, errores, esperados: esperados.length, encontrados, sumaEsperada, sumaEncontrada };
}

function migrarLogsAMovimientos(opciones) {
  opciones = opciones || {};
  exigirPermisoEscritura_(opciones, 'migrarLogsAMovimientos');

  const p = prepararMigracionLogs_();
  if (p.origen !== 'hojas_nuevas') throw new Error('Los catálogos aún no están migrados a la estructura nueva. Ejecute primero migrarCatalogos.');
  const r = armarResultadoLogs_(p);

  if (r.pendientes > 0 && opciones.permitirParcial !== true) {
    const bloqueado = { estado: 'bloqueado', mensaje: `No se escribió nada: ${r.pendientes} fila(s) sin resolver. Revise el reporte o use permitirParcial explícitamente.`, hallazgos: r.hallazgos, resumen: r.resumen };
    registrarResumenMigracion_('migrarLogsAMovimientos', bloqueado);
    if (opciones.escribirReporte !== false) guardarReporteMigracion_(HOJA_REPORTE_MOVIMIENTOS_, bloqueado);
    return bloqueado;
  }

  let escritos = 0;
  if (p.clasif.aEscribir.length) {
    crearHojaMovimientos_();
    escritos = insertarMovimientosEnBloque_(p.clasif.aEscribir).escritos;
  }
  const validacion = validarMigracionLogs_(p);
  const resultado = {
    estado: !validacion.ok ? 'error_validacion' : (r.pendientes > 0 ? 'parcial' : (escritos === 0 ? 'sin_cambios' : 'completa')),
    mensaje: validacion.ok ? `Movimientos escritos: ${escritos}. LOGS no se modificó.` : 'La validación posterior encontró errores: ' + validacion.errores.join('; '),
    escritos, validacion, hallazgos: r.hallazgos, resumen: r.resumen
  };
  registrarResumenMigracion_('migrarLogsAMovimientos', resultado);
  if (opciones.escribirReporte !== false) guardarReporteMigracion_(HOJA_REPORTE_MOVIMIENTOS_, resultado);
  return resultado;
}

/* ---------- Wrappers sin argumentos (para el botón "Ejecutar" del editor) ---------- */
function ejecutarMigracionCatalogosEnCopia() { return migrarCatalogos({ confirmarEscritura: true }); }
function ejecutarMigracionLogsEnCopia() { return migrarLogsAMovimientos({ confirmarEscritura: true }); }
function ejecutarMigracionLogsEnCopiaParcial() { return migrarLogsAMovimientos({ confirmarEscritura: true, permitirParcial: true }); }

/* ==========================================================================
 * DIAGNÓSTICO DE ESTRUCTURA REAL (solo lectura)
 * ========================================================================== */
function diagnosticarEstructuraHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombres = ['LOGS', 'Usuarios', 'Cuentas', 'Categorias', 'Subcategorias', 'Presupuesto', 'Movimientos',
    '_legacy_Cuentas', '_legacy_Categorias', '_legacy_Presupuesto', HOJA_REPORTE_CATALOGOS_, HOJA_REPORTE_MOVIMIENTOS_];
  const hojas = {};
  nombres.forEach(n => {
    const h = ss.getSheetByName(n);
    if (!h) { hojas[n] = { existe: false }; return; }
    const lc = h.getLastColumn();
    hojas[n] = { existe: true, filasConDatos: Math.max(h.getLastRow() - 1, 0), columnas: lc,
      encabezadosExactos: lc ? h.getRange(1, 1, 1, lc).getValues()[0].map(x => String(x)) : [] };
  });

  const resultado = {
    libro: ss.getName(),
    hojas,
    estructura: {
      Cuentas: clasificarEstructura_('Cuentas', ESQUEMA_CUENTAS_, ESQUEMA_CUENTAS_LEGACY_),
      Categorias: clasificarEstructura_('Categorias', ESQUEMA_CATEGORIAS_, ESQUEMA_CATEGORIAS_LEGACY_),
      Subcategorias: clasificarEstructura_('Subcategorias', ESQUEMA_SUBCATEGORIAS_, null),
      Presupuesto: clasificarEstructura_('Presupuesto', ESQUEMA_PRESUPUESTO_, ESQUEMA_PRESUPUESTO_LEGACY_),
      Movimientos: detectarEstructuraHoja_('Movimientos', ESQUEMA_MOVIMIENTOS_)
    },
    estadoCatalogos: clasificarEstadoCatalogos_().global
  };

  // LOGS: qué encabezado real corresponde a cada columna lógica + tipos de dato
  const logs = ss.getSheetByName(HOJA_LOGS_);
  if (logs && logs.getLastRow() >= 1) {
    const enc = logs.getRange(1, 1, 1, logs.getLastColumn()).getValues()[0];
    const loc = localizarColumnas_(ESQUEMA_LOGS_LEGACY_, enc);
    const usados = new Set(Object.keys(loc.indices).map(k => loc.indices[k]));
    const muestra = logs.getLastRow() >= 2 ? logs.getRange(2, 1, Math.min(5, logs.getLastRow() - 1), logs.getLastColumn()).getValues() : [];
    const tipoDe = v => v instanceof Date ? 'Date' : typeof v;
    resultado.logs = {
      columnasEncontradas: loc.encontrados,
      columnasFaltantes: loc.faltantes,
      encabezadosNoMapeados: enc.map((h, i) => usados.has(i) ? null : String(h)).filter(x => x !== null && x !== ''),
      tiposMuestra: ['fecha', 'valor', 'id'].reduce((o, k) => {
        if (k in loc.indices) o[k] = muestra.map(f => tipoDe(f[loc.indices[k]]));
        return o;
      }, {})
    };
  }

  // Usuarios: encabezados y formato real de Porcentaje Compartido (sin correos)
  const us = ss.getSheetByName('Usuarios');
  if (us && us.getLastRow() >= 1) {
    const enc = us.getRange(1, 1, 1, us.getLastColumn()).getValues()[0].map(x => String(x));
    const col = enc.findIndex(h => normalizarClaveEncabezado_(h).replace(/_/g, '') === 'porcentajecompartido');
    const infoUs = { encabezados: enc, columnaPorcentaje: null, filas: [] };
    if (col >= 0) {
      const encReal = enc[col].trim();
      const coincide = encReal === 'PorcentajeCompartido' || encReal === 'porcentajecompartido';
      infoUs.columnaPorcentaje = { encabezadoReal: enc[col], lo_encuentra_el_codigo_actual: coincide };
      const idCol = enc.findIndex(h => normalizarClaveEncabezado_(h) === 'id_usuario');
      const nomCol = enc.findIndex(h => normalizarClaveEncabezado_(h) === 'nombre');
      for (let r = 2; r <= us.getLastRow(); r++) {
        const celda = us.getRange(r, col + 1);
        const crudo = celda.getValue();
        const visible = celda.getDisplayValue ? celda.getDisplayValue() : String(celda.getDisplayValues()[0][0]);
        const numVisible = Number(visible);
        infoUs.filas.push({
          fila: r,
          idUsuario: idCol >= 0 ? String(us.getRange(r, idCol + 1).getValue()) : '',
          nombre: nomCol >= 0 ? String(us.getRange(r, nomCol + 1).getValue()) : '',
          idUsuarioEsEntero: idCol >= 0 ? aEnteroId_(us.getRange(r, idCol + 1).getValue()) !== null : false,
          valorCrudo: crudo, tipoCrudo: typeof crudo, valorVisible: visible, formatoNumerico: celda.getNumberFormat(),
          seAplicaConCodigoActual: coincide && isFinite(numVisible) && numVisible > 0
        });
      }
    }
    resultado.usuarios = infoUs;
  }

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}