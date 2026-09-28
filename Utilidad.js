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
  const emailActivo = Session.getActiveUser().getEmail();
  const encontrado = usuarios.find(u => {
    const correo = obtenerCampo_(u, 'Correo', 'correo') || '';
    return correo.split(',').map(e => e.trim()).includes(emailActivo);
  });
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
