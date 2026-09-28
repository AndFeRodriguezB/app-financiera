/**
 * RepositorioCatalogos.gs
 * Responsabilidad única: leer las hojas de catálogo (Usuarios, Cuentas,
 * Categorias, Presupuesto) y convertirlas en arreglos de objetos.
 *
 * Es la capa "Repositorio": lo único en todo el proyecto que sabe cómo
 * está organizada la hoja de cálculo para estas tablas. Ninguna otra capa
 * (UI, Service, API) debe leer un Sheet directamente: todo pasa por aquí.
 *
 * Usa getDisplayValues() porque estas tablas son catálogos de texto/etiquetas
 * (nombres, correos, porcentajes) donde el valor mostrado en la hoja ya es
 * el valor útil. Los LOGS (fechas y montos reales) se leen aparte, en
 * RepositorioMovimientos.gs, con getValues() para preservar tipos.
 */

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
 * Agrupa los 4 catálogos que la aplicación necesita cargar una sola vez
 * al iniciar (ver sección 8 del documento maestro: "Los catálogos deberán
 * cargarse únicamente una vez al iniciar la aplicación").
 */
function obtenerCatalogos_() {
  return {
    usuarios: obtenerDatosDinamicos_('Usuarios'),
    cuentas: obtenerDatosDinamicos_('Cuentas'),
    categorias: obtenerDatosDinamicos_('Categorias'),
    presupuestos: obtenerDatosDinamicos_('Presupuesto')
  };
}
