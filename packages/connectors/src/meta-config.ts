/** Constantes da Graph API, em módulo sem dependências para evitar ciclos de importação. */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v26.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const RUPLOAD_BASE = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`;
