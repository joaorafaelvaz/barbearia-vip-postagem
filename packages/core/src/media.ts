import type { Platform } from "./platforms.js";
import { PLATFORM_LABELS } from "./platforms.js";

export interface MediaInfo {
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
}

export interface MediaIssue {
  platform: Platform;
  message: string;
}

interface Rule {
  mimeTypes: readonly string[];
  minWidth: number;
  minHeight: number;
  maxBytes: number;
  /** [min, max] largura/altura; undefined = sem restrição */
  aspectRange?: readonly [number, number];
}

/** Regras de imagem por plataforma (documentação oficial de cada API). */
export const IMAGE_RULES: Record<Platform, Rule> = {
  INSTAGRAM: {
    mimeTypes: ["image/jpeg"],
    minWidth: 320,
    minHeight: 320,
    maxBytes: 8 * 1024 * 1024,
    aspectRange: [0.8, 1.91],
  },
  FACEBOOK_PAGE: {
    mimeTypes: ["image/jpeg", "image/png", "image/gif"],
    minWidth: 200,
    minHeight: 200,
    maxBytes: 10 * 1024 * 1024,
  },
  GOOGLE_BUSINESS_PROFILE: {
    mimeTypes: ["image/jpeg", "image/png"],
    minWidth: 250,
    minHeight: 250,
    maxBytes: 5 * 1024 * 1024,
  },
};

function formatList(mimeTypes: readonly string[]): string {
  return mimeTypes.map((m) => (m.split("/")[1] ?? m).toUpperCase()).join(", ");
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
      const mb = Math.round(rule.maxBytes / 1024 / 1024);
      issues.push({ platform, message: `${label} aceita até ${mb}MB por imagem.` });
    }
    if (rule.aspectRange && info.height > 0) {
      const ratio = info.width / info.height;
      const [min, max] = rule.aspectRange;
      if (ratio < min - 0.005 || ratio > max + 0.005) {
        issues.push({
          platform,
          message: `${label} exige proporção entre 4:5 e 1.91:1 (atual ${ratio.toFixed(2)}).`,
        });
      }
    }
  }
  return issues;
}
