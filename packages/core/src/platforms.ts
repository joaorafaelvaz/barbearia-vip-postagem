/** Plataformas suportadas. Espelha o enum Platform do Prisma. */
export type Platform = "FACEBOOK_PAGE" | "INSTAGRAM" | "GOOGLE_BUSINESS_PROFILE";

export const PLATFORMS: readonly Platform[] = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "GOOGLE_BUSINESS_PROFILE",
];

export const PLATFORM_LABELS: Record<Platform, string> = {
  FACEBOOK_PAGE: "Facebook",
  INSTAGRAM: "Instagram",
  GOOGLE_BUSINESS_PROFILE: "Google Meu Negócio",
};

/** Limite de caracteres do texto por plataforma (valores publicados pelas plataformas). */
export const CAPTION_LIMITS: Record<Platform, number> = {
  FACEBOOK_PAGE: 63_206,
  INSTAGRAM: 2_200,
  GOOGLE_BUSINESS_PROFILE: 1_500,
};

/** Instagram exige mídia (imagem ou vídeo); Facebook e GBP aceitam só texto. */
export const REQUIRES_MEDIA: Record<Platform, boolean> = {
  FACEBOOK_PAGE: false,
  INSTAGRAM: true,
  GOOGLE_BUSINESS_PROFILE: false,
};

export interface CaptionIssue {
  platform: Platform;
  message: string;
}

/**
 * Valida o texto e a presença de mídia contra os limites de cada plataforma alvo.
 * Retorna lista vazia quando o post é válido em todas.
 */
export function validateCaption(
  caption: string,
  platforms: readonly Platform[],
  hasMedia: boolean,
): CaptionIssue[] {
  const issues: CaptionIssue[] = [];
  const length = [...caption].length; // conta code points, não bytes
  for (const platform of platforms) {
    const limit = CAPTION_LIMITS[platform];
    if (length > limit) {
      issues.push({
        platform,
        message: `${PLATFORM_LABELS[platform]} permite até ${limit} caracteres (texto tem ${length}).`,
      });
    }
    if (REQUIRES_MEDIA[platform] && !hasMedia) {
      issues.push({
        platform,
        message: `${PLATFORM_LABELS[platform]} exige pelo menos uma imagem.`,
      });
    }
    if (!hasMedia && caption.trim().length === 0) {
      issues.push({ platform, message: "Post vazio: informe texto ou mídia." });
    }
  }
  return issues;
}

/** Formato da postagem. Espelha o enum PostFormat do Prisma. */
export type PostFormat = "FEED" | "STORY" | "REEL";

export const POST_FORMAT_LABELS: Record<PostFormat, string> = {
  FEED: "Feed",
  STORY: "Story",
  REEL: "Reel",
};

/** Quais plataformas aceitam cada formato via API. */
export const FORMAT_SUPPORT: Record<PostFormat, readonly Platform[]> = {
  FEED: ["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS_PROFILE"],
  STORY: ["FACEBOOK_PAGE", "INSTAGRAM"],
  REEL: ["FACEBOOK_PAGE", "INSTAGRAM"],
};

export interface FormatIssue {
  platform: Platform | null;
  message: string;
}

/** Mídia com o que a regra de formato precisa; strings são aceitas para compatibilidade. */
export interface FormatMedia {
  kind: "IMAGE" | "VIDEO";
  /** Duração em segundos (vídeo); 0/null quando desconhecida. */
  durationSec?: number | null;
  bytes?: number;
}

interface FormatVideoRule {
  maxSeconds: number;
  maxBytes?: number;
  /** Acima de maxSeconds o vídeo é cortado automaticamente em partes, em vez de rejeitado. */
  split?: boolean;
}

/** Stories aceitam vídeo de até 60s (Instagram e Facebook). */
export const STORY_MAX_VIDEO_SECONDS = 60;
/** Alvo de cada parte no corte automático: folga para o arquivo gerado nunca passar de 60s. */
export const STORY_SEGMENT_TARGET_SECONDS = 59;
/** Teto de partes geradas por vídeo (10 Stories seguidos). */
export const STORY_MAX_PARTS = 10;

export interface VideoSegment {
  index: number;
  startSec: number;
  lengthSec: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Plano de corte para Stories: partes iguais de até ~59s. Partes iguais evitam um
 * último pedaço curto demais (o Instagram exige no mínimo 3s).
 */
export function planStorySegments(durationSec: number): VideoSegment[] {
  if (!(durationSec > STORY_MAX_VIDEO_SECONDS)) return [{ index: 0, startSec: 0, lengthSec: round2(durationSec) }];
  const parts = Math.ceil(durationSec / STORY_SEGMENT_TARGET_SECONDS);
  const len = durationSec / parts;
  return Array.from({ length: parts }, (_, i) => ({ index: i, startSec: round2(i * len), lengthSec: round2(len) }));
}

/**
 * Limites de vídeo por formato e plataforma (documentação oficial da Meta):
 * Story IG/FB até 60s (IG até 100MB); Reel IG até 15min/300MB, Reel FB até 90s.
 */
export const FORMAT_VIDEO_RULES: Partial<Record<PostFormat, Partial<Record<Platform, FormatVideoRule>>>> = {
  STORY: {
    INSTAGRAM: { maxSeconds: STORY_MAX_VIDEO_SECONDS, maxBytes: 100 * 1024 * 1024, split: true },
    FACEBOOK_PAGE: { maxSeconds: STORY_MAX_VIDEO_SECONDS, split: true },
  },
  REEL: {
    INSTAGRAM: { maxSeconds: 15 * 60, maxBytes: 300 * 1024 * 1024 },
    FACEBOOK_PAGE: { maxSeconds: 90 },
  },
};

function toFormatMedia(m: "IMAGE" | "VIDEO" | FormatMedia): FormatMedia {
  return typeof m === "string" ? { kind: m } : m;
}

export function formatSeconds(sec: number): string {
  if (sec < 120) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return r === 0 ? `${m}min` : `${m}min${r}s`;
}

/**
 * Regras do formato: Story = exatamente uma mídia (imagem ou vídeo), legenda ignorada;
 * Reel = exatamente um vídeo; ambos só em Facebook e Instagram. Vídeos respeitam a
 * duração e o tamanho máximos de cada plataforma para o formato.
 */
export function validateFormat(
  format: PostFormat,
  platforms: readonly Platform[],
  media: readonly ("IMAGE" | "VIDEO" | FormatMedia)[],
): FormatIssue[] {
  const issues: FormatIssue[] = [];
  if (format === "FEED") return issues;
  const items = media.map(toFormatMedia);
  const mediaKinds = items.map((m) => m.kind);
  for (const p of platforms) {
    if (!FORMAT_SUPPORT[format].includes(p)) {
      issues.push({ platform: p, message: `${PLATFORM_LABELS[p]} não aceita ${POST_FORMAT_LABELS[format]}: desmarque essas contas.` });
    }
  }
  if (format === "STORY") {
    if (mediaKinds.length !== 1) issues.push({ platform: null, message: "Story precisa de exatamente uma imagem ou um vídeo." });
  }
  if (format === "REEL") {
    if (mediaKinds.length !== 1 || mediaKinds[0] !== "VIDEO") issues.push({ platform: null, message: "Reel precisa de exatamente um vídeo." });
  }
  const video = items.find((m) => m.kind === "VIDEO");
  const rules = FORMAT_VIDEO_RULES[format];
  if (video && rules) {
    const dur = video.durationSec ?? 0;
    for (const p of platforms) {
      const rule = rules[p];
      if (!rule) continue;
      const label = `${POST_FORMAT_LABELS[format]} no ${PLATFORM_LABELS[p]}`;
      if (dur > 0 && dur > rule.maxSeconds) {
        if (rule.split) {
          const parts = planStorySegments(dur).length;
          if (parts > STORY_MAX_PARTS) {
            issues.push({ platform: p, message: `Story: vídeo de ${formatSeconds(dur)} viraria ${parts} partes; o máximo é ${STORY_MAX_PARTS} (${formatSeconds(STORY_MAX_PARTS * STORY_SEGMENT_TARGET_SECONDS)}). Corte o vídeo ou publique como Reel.` });
          }
        } else {
          issues.push({ platform: p, message: `${label} aceita vídeo de até ${formatSeconds(rule.maxSeconds)} (atual ${formatSeconds(dur)}). Corte o vídeo ou publique como Feed.` });
        }
      }
      // Partes cortadas ficam bem abaixo do limite de tamanho; só vale para o vídeo inteiro.
      if (rule.maxBytes && video.bytes && video.bytes > rule.maxBytes && !(rule.split && dur > rule.maxSeconds)) {
        issues.push({ platform: p, message: `${label} aceita vídeo de até ${Math.round(rule.maxBytes / 1024 / 1024)}MB (atual ${Math.round(video.bytes / 1024 / 1024)}MB).` });
      }
    }
  }
  return issues;
}
