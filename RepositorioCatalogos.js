/**
 * RepositorioCatalogos.gs
 * Responsabilidad única: leer los catálogos (Usuarios, Cuentas, Categorias,
 * Subcategorias, Presupuesto) y convertirlos en arreglos de objetos.
 *
 * Es la capa "Repositorio": lo único en todo el proyecto que sabe cómo está
 * organizada la hoja de cálculo para estas tablas. Ninguna otra capa (UI,
 * Service, API) debe leer un Sheet directamente: todo pasa por aquí.
 *
 * FASE 3 (migración a IDs):
 *  - Usuarios NO cambia: sigue devolviendo las filas "crudas" (getDisplayValues,
 *    claves = encabezados reales) exactamente como antes. Así el cálculo de
 *    "Porcentaje Compartido" y el resto de la lógica actual se conservan tal cual.
 *  - Cuentas vive en RepositorioCuentas.js (lectura y escritura).
 *  - Categorias, Subcategorias y Presupuesto se leen con modelos normalizados
 *    (camelCase, IDs). Se leen por NOMBRE de encabezado, con getValues.
 *  - El catálogo incluye elementos INACTIVOS (Estado = 0): son necesarios para
 *    resolver movimientos históricos. Quien llena un selector de "nuevo
 *    movimiento" debe filtrar por `activa`.
 *  - Los NOMBRES son solo etiquetas: las relaciones se hacen por ID.
 *
 * Modelos:
 *   categoria    { idCategoria, categoria, tipo ('Gasto'|'Ingreso'), estado, activa }
 *   subcategoria { idSubcategoria, subcategoria, idCategoria, estado, activa }
 *   presupuesto  { idPresupuesto, idCategoria, idSubcategoria (null si no aplica), limite, periodo, idUsuario }
 *
 * TODOS los IDs (PK y FK) son ENTEROS positivos. Usuarios conserva sus filas
 * crudas, pero cada fila recibe además `idUsuario` (entero o null) para evitar
 * comparaciones texto/número. Los valores crudos originales no se alteran.
 */

const ESQUEMA_CATEGORIAS_ = {
  hoja: 'Categorias',
  clavePrimaria: 'idCategoria',
  columnas: [
    { clave: 'idCategoria', encabezado: 'ID_Categoria', tipo: 'id' },
    { clave: 'categoria', encabezado: 'Categoria', tipo: 'texto' },
    { clave: 'tipo', encabezado: 'Tipo', tipo: 'texto' },
    { clave: 'estado', encabezado: 'Estado', tipo: 'estado' }
  ]
};

const ESQUEMA_SUBCATEGORIAS_ = {
  hoja: 'Subcategorias',
  clavePrimaria: 'idSubcategoria',
  columnas: [
    { clave: 'idSubcategoria', encabezado: 'ID_Subcategoria', tipo: 'id' },
    { clave: 'subcategoria', encabezado: 'Subcategoria', tipo: 'texto' },
    { clave: 'idCategoria', encabezado: 'ID_Categoria', tipo: 'id' },
    { clave: 'estado', encabezado: 'Estado', tipo: 'estado' }
  ]
};

const ESQUEMA_PRESUPUESTO_ = {
  hoja: 'Presupuesto',
  clavePrimaria: 'idPresupuesto',
  columnas: [
    { clave: 'idPresupuesto', encabezado: 'ID_Presupuesto', tipo: 'id' },
    { clave: 'idCategoria', encabezado: 'ID_Categoria', tipo: 'id' },
    { clave: 'idSubcategoria', encabezado: 'ID_Subcategoria', tipo: 'id' },
    { clave: 'limite', encabezado: 'Limite', tipo: 'numero' },
    { clave: 'periodo', encabezado: 'Periodo', tipo: 'texto' },
    { clave: 'idUsuario', encabezado: 'ID_Usuario', tipo: 'id' }
  ]
};

// Claves de los contadores de IDs (DocumentProperties). Las usará la administración de
// categorías (fase 9); la migración de catálogos las sincroniza desde ya.
const CLAVE_CONTADOR_CATEGORIA_ = 'CATEGORIA';
const CLAVE_CONTADOR_SUBCATEGORIA_ = 'SUBCATEGORIA';

/** 'Ingreso' (sin importar mayúsculas/tildes) => 'Ingreso'; cualquier otro valor => 'Gasto'. */
function canonizarTipoCategoria_(tipo) {
  return normalizarTexto_(tipo) === 'ingreso' ? 'Ingreso' : 'Gasto';
}

/** Compatibilidad con la lógica actual: todo lo que no sea "Ingreso" se trata como gasto. */
function esTipoIngreso_(tipo) {
  return normalizarTexto_(tipo) === 'ingreso';
}

function obtenerDatosDinamicos_(nombreHoja) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(nombreHoja);

  if (!hoja) return [];

  const datos = hoja.getDataRange().getDisplayValues();
  if (datos.length <= 1) return [];

  const encabezados = datos.shift();

  return datos.map(fila => {
    const objetoColumna = {};
    encabezados.forEach((nombreColumna, index) => {
      if (nombreColumna) {
        const clave = nombreColumna.toString().trim();
        objetoColumna[clave] = fila[index];
      }
    });
    return objetoColumna;
  });
}

/**
 * Usuarios: filas crudas EXACTAMENTE como antes (claves = encabezados reales,
 * valores visibles) + `idUsuario` numérico (entero o null). No se modifica
 * ningún valor existente, así la lógica de "Porcentaje Compartido" no cambia.
 */
function obtenerUsuariosCatalogo_() {
  return obtenerDatosDinamicos_('Usuarios').map(u => Object.assign({}, u, { idUsuario: obtenerIdUsuario_(u) }));
}

function obtenerCategorias_() {
  return leerTablaEsquema_(ESQUEMA_CATEGORIAS_).filas
    .filter(f => tieneClavePrimaria_(ESQUEMA_CATEGORIAS_, f))
    .map(f => ({
      idCategoria: f.idCategoria,
      categoria: f.categoria,
      tipo: canonizarTipoCategoria_(f.tipo),
      estado: f.estado,
      activa: f.estado === 1
    }));
}

function obtenerSubcategorias_() {
  return leerTablaEsquema_(ESQUEMA_SUBCATEGORIAS_).filas
    .filter(f => tieneClavePrimaria_(ESQUEMA_SUBCATEGORIAS_, f))
    .map(f => ({
      idSubcategoria: f.idSubcategoria,
      subcategoria: f.subcategoria,
      idCategoria: f.idCategoria,
      estado: f.estado,
      activa: f.estado === 1
    }));
}

/** Presupuesto aún no tiene funcionalidad: si la hoja no existe se devuelve []. */
function obtenerPresupuestos_() {
  return leerTablaEsquema_(ESQUEMA_PRESUPUESTO_, { opcional: true }).filas
    .filter(f => tieneClavePrimaria_(ESQUEMA_PRESUPUESTO_, f))
    .map(quitarFila_);
}

/**
 * Agrupa los catálogos que la aplicación necesita cargar una sola vez al
 * iniciar (sección 8 del documento maestro). Una lectura por hoja.
 */
function obtenerCatalogos_() {
  return {
    usuarios: obtenerUsuariosCatalogo_(),
    cuentas: obtenerCuentasCatalogo_(),
    categorias: obtenerCategorias_(),
    subcategorias: obtenerSubcategorias_(),
    presupuestos: obtenerPresupuestos_()
  };
}

/* ---------- Solo migración de catálogos: reescritura completa con estructura nueva ---------- */

function reemplazarCategorias_(modelos) {
  reemplazarContenidoTabla_(ESQUEMA_CATEGORIAS_, modelos, { crearSiNoExiste: true });
}

function reemplazarSubcategorias_(modelos) {
  reemplazarContenidoTabla_(ESQUEMA_SUBCATEGORIAS_, modelos, { crearSiNoExiste: true });
}

function reemplazarPresupuestos_(modelos) {
  reemplazarContenidoTabla_(ESQUEMA_PRESUPUESTO_, modelos, { crearSiNoExiste: true });
}