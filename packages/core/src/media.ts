import type { Platform } from "./platforms.js";
import { PLATFORM_LABELS } from "./platforms.js";

export type MediaKind = "IMAGE" | "VIDEO";

export interface MediaInfo {
  kind: MediaKind;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  /** Só para vídeo; 0 quando desconhecida. */
  durationSec?: number;
}

export interface MediaIssue {
  platform: Platform;
  message: string;
}

interface ImageRule {
  mimeTypes: readonly string[];
  minWidth: number;
  minHeight: number;
  maxBytes: number;
  /** [min, max] largura/altura; undefined = sem restrição */
  aspectRange?: readonly [number, number];
}

interface VideoRule {
  mimeTypes: readonly string[];
  maxBytes: number;
  minSeconds: number;
  maxSeconds: number;
  aspectRange?: readonly [number, number];
}

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"] as const;

/** Regras de imagem por plataforma (documentação oficial de cada API). */
export const IMAGE_RULES: Record<Platform, ImageRule> = {
  INSTAGRAM: { mimeTypes: ["image/jpeg"], minWidth: 320, minHeight: 320, maxBytes: 8 * 1024 * 1024, aspectRange: [0.8, 1.91] },
  FACEBOOK_PAGE: { mimeTypes: ["image/jpeg", "image/png", "image/gif"], minWidth: 200, minHeight: 200, maxBytes: 10 * 1024 * 1024 },
  GOOGLE_BUSINESS_PROFILE: { mimeTypes: ["image/jpeg", "image/png"], minWidth: 250, minHeight: 250, maxBytes: 5 * 1024 * 1024 },
};

/**
 * Regras de vídeo. Instagram publica como Reels (MP4/MOV, H.264 + AAC, 3s a 15min,
 * proporção 9:16 recomendada, aceita de 0.01:1 a 10:1). Facebook Page: MP4/MOV até 1GB.
 * Google Business Profile: a API de posts NÃO aceita vídeo (só a galeria de fotos).
 */
export const VIDEO_RULES: Partial<Record<Platform, VideoRule>> = {
  INSTAGRAM: { mimeTypes: [...VIDEO_MIME_TYPES], maxBytes: 1024 * 1024 * 1024, minSeconds: 3, maxSeconds: 15 * 60, aspectRange: [0.01, 10] },
  FACEBOOK_PAGE: { mimeTypes: [...VIDEO_MIME_TYPES], maxBytes: 1024 * 1024 * 1024, minSeconds: 1, maxSeconds: 240 * 60 },
};

export function supportsVideo(platform: Platform): boolean {
  return VIDEO_RULES[platform] !== undefined;
}

function formatList(mimeTypes: readonly string[]): string {
  return mimeTypes.map((m) => (m.split("/")[1] ?? m).replace("quicktime", "mov").toUpperCase()).join(", ");
}

export function validateImage(info: MediaInfo, platforms: readonly Platform[]): MediaIssue[] {
  const issues: MediaIssue[] = [];
  for (const platform of platforms) {
    const rule = IMAGE_RULES[platform];
    const label = PLATFORM_LABELS[platform];
    if (!rule.mimeTypes.includes(info.mimeType)) {
      issues.push({ platform, message: `${label} aceita apenas ${formatList(rule.mimeTypes)}.` });
    }
    if (info.width < rule.minWidth || info.height < rule.minHeight) {
      issues.push({ platform, message: `${label} exige no mínimo ${rule.minWidth}x${rule.minHeight}px.` });
    }
    if (info.bytes > rule.maxBytes) {
      issues.push({ platform, message: `${label} aceita até ${Math.round(rule.maxBytes / 1024 / 1024)}MB por imagem.` });
    }
    if (rule.aspectRange && info.height > 0) {
      const ratio = info.width / info.height;
      const [min, max] = rule.aspectRange;
      if (ratio < min - 0.005 || ratio > max + 0.005) {
        issues.push({ platform, message: `${label} exige proporção entre 4:5 e 1.91:1 (atual ${ratio.toFixed(2)}).` });
      }
    }
  }
  return issues;
}

export function validateVideo(info: MediaInfo, platforms: readonly Platform[]): MediaIssue[] {
  const issues: MediaIssue[] = [];
  for (const platform of platforms) {
    const label = PLATFORM_LABELS[platform];
    const rule = VIDEO_RULES[platform];
    if (!rule) {
      issues.push({ platform, message: `${label} não aceita vídeo em postagens.` });
      continue;
    }
    if (!rule.mimeTypes.includes(info.mimeType)) {
      issues.push({ platform, message: `${label} aceita vídeo apenas em ${formatList(rule.mimeTypes)}.` });
    }
    if (info.bytes > rule.maxBytes) {
      issues.push({ platform, message: `${label} aceita vídeo até ${Math.round(rule.maxBytes / 1024 / 1024)}MB.` });
    }
    const dur = info.durationSec ?? 0;
    if (dur > 0 && (dur < rule.minSeconds || dur > rule.maxSeconds)) {
      issues.push({ platform, message: `${label} exige vídeo entre ${rule.minSeconds}s e ${Math.round(rule.maxSeconds / 60)}min (atual ${Math.round(dur)}s).` });
    }
    if (rule.aspectRange && info.width > 0 && info.height > 0) {
      const ratio = info.width / info.height;
      const [min, max] = rule.aspectRange;
      if (ratio < min || ratio > max) {
        issues.push({ platform, message: `${label} não aceita a proporção ${ratio.toFixed(2)} para vídeo.` });
      }
    }
  }
  return issues;
}

/** Despacha para a regra certa pelo tipo da mídia. */
export function validateMedia(info: MediaInfo, platforms: readonly Platform[]): MediaIssue[] {
  return info.kind === "VIDEO" ? validateVideo(info, platforms) : validateImage(info, platforms);
}

/**
 * Regras do conjunto de mídias de um post: no máximo um vídeo, sem misturar vídeo com
 * imagens (nenhuma das plataformas aceita a mistura em um post único) e só em
 * plataformas que suportam vídeo.
 */
export function validateMediaSet(kinds: readonly MediaKind[], platforms: readonly Platform[]): MediaIssue[] {
  const videos = kinds.filter((k) => k === "VIDEO").length;
  const images = kinds.length - videos;
  const issues: MediaIssue[] = [];
  if (videos === 0) return issues;
  for (const platform of platforms) {
    const label = PLATFORM_LABELS[platform];
    if (!supportsVideo(platform)) {
      issues.push({ platform, message: `${label} não aceita vídeo em postagens: desmarque essas contas ou use só imagens.` });
      continue;
    }
    if (videos > 1) issues.push({ platform, message: `${label}: envie apenas um vídeo por postagem.` });
    if (images > 0) issues.push({ platform, message: `${label}: não é possível misturar vídeo e imagens na mesma postagem.` });
  }
  return issues;
}
