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

/**
 * Regras do formato: Story = exatamente uma mídia (imagem ou vídeo), legenda ignorada;
 * Reel = exatamente um vídeo; ambos só em Facebook e Instagram.
 */
export function validateFormat(
  format: PostFormat,
  platforms: readonly Platform[],
  mediaKinds: readonly ("IMAGE" | "VIDEO")[],
): FormatIssue[] {
  const issues: FormatIssue[] = [];
  if (format === "FEED") return issues;
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
  return issues;
}
