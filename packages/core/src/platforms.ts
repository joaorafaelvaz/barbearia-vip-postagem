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
