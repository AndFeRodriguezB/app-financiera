/**
 * RepositorioBase.gs
 * Responsabilidad única: mecánica genérica de lectura/escritura de tablas de
 * Google Sheets, guiada por un "esquema" (lista de columnas lógicas con su
 * encabezado físico). NO conoce ninguna hoja concreta: cada repositorio
 * (Cuentas, Catálogos, Movimientos) define su propio esquema y es el único
 * que sabe cómo está organizada su hoja.
 *
 * Reglas:
 *  - Las columnas se localizan por NOMBRE de encabezado (tolerante a
 *    mayúsculas, tildes y espacios/guiones bajos), nunca por posición.
 *  - Si falta una columna requerida se lanza un error explícito en vez de
 *    devolver datos vacíos en silencio.
 *  - Las columnas que el esquema no conoce se conservan intactas al actualizar.
 *
 * Forma de un esquema:
 *   { hoja: 'Cuentas', clavePrimaria: 'idCuenta',
 *     columnas: [ { clave: 'idCuenta', encabezado: 'ID_Cuenta', alias: [], tipo: 'texto' }, ... ] }
 *
 * Tipos de columna: texto | textoLibre | numero | id | estado | fecha |
 *                   tipoGasto | valor | crudo
 *   - id: ENTERO positivo (PK o FK). Vacío => null. Un valor no entero se
 *         detecta al leer y lanza error (no se oculta como null).
 */

function convertirCelda_(valor, tipo) {
  switch (tipo) {
    case 'crudo':
      return valor;
    case 'textoLibre':
      return (valor === null || valor === undefined) ? '' : String(valor);
    case 'numero':
      return parsearNumeroCOP_(valor);
    case 'id':
      return aEnteroIdOpcional_(valor); // null (vacío) | entero | NaN (inválido: lo rechaza leerTablaEsquema_)
    case 'estado':
      return normalizarEstado_(valor);
    case 'fecha':
      return normalizarFechaTexto_(valor);
    case 'tipoGasto':
      return normalizarTexto_(valor) === 'compartido' ? 'Compartido' : 'Propio';
    case 'valor':
      return Number(valor) || 0;
    case 'texto':
    default:
      return (valor === null || valor === undefined) ? '' : String(valor).trim();
  }
}

/** Lo que se escribe en la celda para un valor del modelo. */
function valorParaCelda_(valor, tipo) {
  if (valor === null || valor === undefined) return '';
  switch (tipo) {
    case 'estado':
      return normalizarEstado_(valor);
    case 'numero':
    case 'id':
    case 'valor':
      return valor === '' ? '' : Number(valor);
    default:
      return valor;
  }
}

/** Encabezados aceptados para una columna: el principal más sus alias. */
function encabezadosDeColumna_(columna) {
  return [columna.encabezado].concat(columna.alias || []);
}

/**
 * Localiza las columnas del esquema dentro de los encabezados reales.
 * Devuelve { indices: {clave: posición}, encontrados: {clave: encabezadoReal}, faltantes: [encabezado...] }.
 * Lanza error si un encabezado mapeado aparece duplicado (ambiguo).
 */
function localizarColumnas_(esquema, encabezados) {
  const porClave = {};
  const repetidas = {};
  encabezados.forEach((h, i) => {
    const k = normalizarClaveEncabezado_(h);
    if (!k) return;
    if (k in porClave) repetidas[k] = true;
    else porClave[k] = i;
  });

  const indices = {};
  const encontrados = {};
  const faltantes = [];
  esquema.columnas.forEach(c => {
    const candidatos = encabezadosDeColumna_(c).map(normalizarClaveEncabezado_);
    const k = candidatos.find(x => x in porClave);
    if (k === undefined) {
      if (c.requerida !== false) faltantes.push(c.encabezado);
      return;
    }
    if (repetidas[k]) {
      throw new Error(`La hoja "${esquema.hoja}" tiene la columna "${encabezados[porClave[k]]}" repetida; no se puede saber cuál usar.`);
    }
    indices[c.clave] = porClave[k];
    encontrados[c.clave] = encabezados[porClave[k]];
  });
  return { indices, encontrados, faltantes };
}

/** ¿Los encabezados reales cumplen el esquema? (sin lanzar error) */
function estructuraCoincide_(esquema, encabezados) {
  try {
    return localizarColumnas_(esquema, encabezados).faltantes.length === 0;
  } catch (e) {
    return false;
  }
}

/** 'inexistente' | 'vacia' | 'coincide' | 'no_coincide' para una hoja frente a un esquema. */
function detectarEstructuraHoja_(nombreHoja, esquema) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!hoja) return 'inexistente';
  if (hoja.getLastRow() < 1 || hoja.getLastColumn() < 1) return 'vacia';
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  return estructuraCoincide_(esquema, encabezados) ? 'coincide' : 'no_coincide';
}

function errorEstructura_(esquema, faltantes) {
  return new Error(
    `La hoja "${esquema.hoja}" no tiene la estructura esperada. Faltan las columnas: ${faltantes.join(', ')}. ` +
    'Si aún no se ha migrado la base de datos, ejecute primero la migración (Migracion.js) en la copia de prueba.'
  );
}

/**
 * Abre la tabla leyendo SOLO la fila de encabezados (barato). Sirve para
 * insertar o leer una sola columna sin cargar toda la hoja.
 */
function abrirTabla_(esquema, opciones) {
  opciones = opciones || {};
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(esquema.hoja);
  if (!hoja) {
    if (opciones.opcional) return null;
    throw new Error(`No existe la hoja "${esquema.hoja}".`);
  }
  const ancho = hoja.getLastColumn();
  if (hoja.getLastRow() < 1 || ancho < 1) {
    throw new Error(`La hoja "${esquema.hoja}" está vacía (sin encabezados).`);
  }
  const encabezados = hoja.getRange(1, 1, 1, ancho).getValues()[0];
  const loc = localizarColumnas_(esquema, encabezados);
  if (loc.faltantes.length) throw errorEstructura_(esquema, loc.faltantes);
  return { esquema, hoja, ancho, encabezados, indices: loc.indices, encontrados: loc.encontrados };
}

/** Valores de UNA columna lógica (sin la fila de encabezados). */
function leerColumna_(tabla, clave) {
  const ultima = tabla.hoja.getLastRow();
  if (ultima < 2) return [];
  return tabla.hoja.getRange(2, tabla.indices[clave] + 1, ultima - 1, 1).getValues().map(f => f[0]);
}

/**
 * Lee toda la tabla con UNA sola llamada getDataRange().getValues().
 * Devuelve { ...tabla, filas: [ {_fila, ...modelo} ] }. Incluye filas cuya
 * clave primaria esté vacía; el llamador decide si las descarta.
 */
function leerTablaEsquema_(esquema, opciones) {
  const tabla = abrirTabla_(esquema, opciones);
  if (!tabla) return { hoja: null, filas: [], indices: {}, encabezados: [], ancho: 0, esquema };

  const valores = tabla.hoja.getDataRange().getValues();
  tabla.filas = [];
  const idsInvalidos = [];
  for (let i = 1; i < valores.length; i++) {
    const fila = valores[i];
    const objeto = { _fila: i + 1 };
    esquema.columnas.forEach(c => {
      if (!(c.clave in tabla.indices)) return;
      const crudo = fila[tabla.indices[c.clave]];
      const v = convertirCelda_(crudo, c.tipo);
      if (c.tipo === 'id' && typeof v === 'number' && isNaN(v)) idsInvalidos.push(`fila ${i + 1} (${c.encabezado} = "${crudo}")`);
      objeto[c.clave] = v;
    });
    tabla.filas.push(objeto);
  }
  if (idsInvalidos.length) {
    throw new Error(`La hoja "${esquema.hoja}" tiene IDs que no son enteros positivos: ${idsInvalidos.slice(0, 5).join(', ')}` +
      `${idsInvalidos.length > 5 ? ` y ${idsInvalidos.length - 5} más` : ''}. ` +
      'Todos los IDs deben ser numéricos (1, 2, 3...). Si la hoja aún tiene IDs con prefijo (p. ej. CTA-01), ejecute la migración en la copia de prueba.');
  }
  return tabla;
}

/** ¿La clave primaria de la fila tiene valor? */
function tieneClavePrimaria_(esquema, fila) {
  const v = fila[esquema.clavePrimaria];
  return v !== null && v !== undefined && v !== '';
}

function quitarFila_(objeto) {
  const copia = Object.assign({}, objeto);
  delete copia._fila;
  return copia;
}

/** Arreglo de longitud `ancho`; las columnas no mapeadas se conservan de filaBase o quedan vacías. */
function construirFilaDesdeModelo_(tabla, modelo, filaBase) {
  const fila = filaBase ? filaBase.slice() : new Array(tabla.ancho).fill('');
  tabla.esquema.columnas.forEach(c => {
    if (c.clave in modelo && c.clave in tabla.indices) {
      fila[tabla.indices[c.clave]] = valorParaCelda_(modelo[c.clave], c.tipo);
    }
  });
  return fila;
}

/**
 * Agrega filas al final en UN solo setValues. `clavesTexto` lista las
 * columnas lógicas que deben forzarse a formato texto ("@") ANTES de escribir
 * (p. ej. Fecha, para que Sheets no la reinterprete).
 * Devuelve la fila donde comenzó la escritura.
 */
function agregarFilasAlFinal_(tabla, filas, clavesTexto) {
  if (!filas.length) return null;
  const filaDestino = tabla.hoja.getLastRow() + 1;
  (clavesTexto || []).forEach(clave => {
    if (clave in tabla.indices) {
      tabla.hoja.getRange(filaDestino, tabla.indices[clave] + 1, filas.length, 1).setNumberFormat('@');
    }
  });
  tabla.hoja.getRange(filaDestino, 1, filas.length, tabla.ancho).setValues(filas);
  SpreadsheetApp.flush();
  return filaDestino;
}

/** Reescribe UNA fila completa, forzando formato texto en las columnas indicadas. */
function escribirFila_(tabla, numeroFila, fila, clavesTexto) {
  (clavesTexto || []).forEach(clave => {
    if (clave in tabla.indices) tabla.hoja.getRange(numeroFila, tabla.indices[clave] + 1).setNumberFormat('@');
  });
  tabla.hoja.getRange(numeroFila, 1, 1, tabla.ancho).setValues([fila]);
  SpreadsheetApp.flush();
}

function leerFilaCruda_(tabla, numeroFila) {
  return tabla.hoja.getRange(numeroFila, 1, 1, tabla.ancho).getValues()[0];
}

/**
 * Reemplaza TODO el contenido de la hoja del esquema (encabezados + filas)
 * con la estructura nueva. Usa clearContents() para conservar formato y
 * validaciones de datos. Solo lo usa la migración de catálogos.
 */
function reemplazarContenidoTabla_(esquema, modelos, opciones) {
  opciones = opciones || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(esquema.hoja);
  if (!hoja) {
    if (!opciones.crearSiNoExiste) throw new Error(`No existe la hoja "${esquema.hoja}".`);
    hoja = ss.insertSheet(esquema.hoja);
  }
  // Solo las columnas REQUERIDAS: las opcionales (requerida:false) no se crean ni se escriben aquí.
  const columnas = esquema.columnas.filter(c => c.requerida !== false);
  const encabezados = columnas.map(c => c.encabezado);
  const filas = modelos.map(m => columnas.map(c => valorParaCelda_(m[c.clave], c.tipo)));
  hoja.clearContents();
  hoja.getRange(1, 1, 1 + filas.length, encabezados.length).setValues([encabezados].concat(filas));
  SpreadsheetApp.flush();
}

/** Crea la hoja con solo los encabezados canónicos si no existe. No toca una existente. */
function crearHojaVaciaDeEsquema_(esquema) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(esquema.hoja)) return false;
  const hoja = ss.insertSheet(esquema.hoja);
  const encabezados = esquema.columnas.filter(c => c.requerida !== false).map(c => c.encabezado);
  hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  SpreadsheetApp.flush();
  return true;
}

/**
 * Agrega al FINAL de la fila de encabezados las columnas indicadas (por clave del esquema)
 * que aún no existan. Idempotente y NO destructiva: no toca ninguna fila de datos ni las
 * columnas existentes. Exige que las columnas requeridas del esquema ya estén presentes.
 * Devuelve { agregadas: [encabezados], yaExistian: [encabezados] }.
 */
function agregarColumnasFaltantes_(esquema, claves) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(esquema.hoja);
  if (!hoja) throw new Error(`No existe la hoja "${esquema.hoja}".`);
  const ancho = hoja.getLastColumn();
  if (hoja.getLastRow() < 1 || ancho < 1) throw new Error(`La hoja "${esquema.hoja}" está vacía (sin encabezados).`);
  const encabezados = hoja.getRange(1, 1, 1, ancho).getValues()[0];
  const loc = localizarColumnas_(esquema, encabezados);
  if (loc.faltantes.length) throw errorEstructura_(esquema, loc.faltantes);

  const pedidas = esquema.columnas.filter(c => claves.includes(c.clave));
  const nuevas = pedidas.filter(c => !(c.clave in loc.indices));
  if (nuevas.length) {
    hoja.getRange(1, ancho + 1, 1, nuevas.length).setValues([nuevas.map(c => c.encabezado)]);
    SpreadsheetApp.flush();
  }
  return { agregadas: nuevas.map(c => c.encabezado), yaExistian: pedidas.filter(c => c.clave in loc.indices).map(c => c.encabezado) };
}