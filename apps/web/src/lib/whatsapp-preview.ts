const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/**
 * Prévia com a formatação do WhatsApp: escapa HTML antes de aplicar *negrito* e _itálico_.
 * Itálico só quando o `_..._` está isolado por espaço/início/fim (regra do próprio WhatsApp):
 * snake_case e URLs com `_` não viram itálico.
 */
export function previewHtml(text: string): string {
  return text
    .replace(/[&<>]/g, (c) => HTML_ESCAPE[c] ?? c)
    .replace(/\*(.+?)\*/g, "<b>$1</b>")
    .replace(/(^|\s)_([^_\s](?:[^_]*?[^_\s])?)_(?=\s|$)/g, "$1<i>$2</i>")
    .replace(/\n/g, "<br>");
}
