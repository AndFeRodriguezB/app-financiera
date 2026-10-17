/**
 * Code.gs
 * Responsabilidad única: servir el HTML de la aplicación (routing) y exponer
 * el helper "include" que usan todas las plantillas HTML para componerse.
 * NO SE MODIFICÓ este archivo: ya cumplía correctamente su única responsabilidad.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('Mi App Financiera')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
