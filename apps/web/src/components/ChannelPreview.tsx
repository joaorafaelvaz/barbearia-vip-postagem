"use client";

import { FORMAT_SUPPORT, PLATFORM_LABELS, POST_FORMAT_LABELS, type Platform, type PostFormat } from "@fsp/core/platforms";
import { FacebookFeed, GoogleCard, InstagramFeed, Vertical } from "./ChannelPreviewCards";
import { IconFacebook, IconInstagram, IconMapPin } from "./Icons";
import type { Uploaded } from "./MediaPicker";

interface Props {
  format: PostFormat;
  caption: string;
  media: Uploaded[];
  /** Plataformas das contas selecionadas; vazio mostra todas que aceitam o formato. */
  platforms: Platform[];
  /** Nome exibido por plataforma (primeira conta selecionada). */
  names: Partial<Record<Platform, string>>;
  coverUrl?: string;
}

const FALLBACK_NAME: Record<Platform, string> = { INSTAGRAM: "@suaconta", FACEBOOK_PAGE: "Sua Página", GOOGLE_BUSINESS_PROFILE: "Sua unidade" };

/** Como a postagem deve aparecer em cada canal. É uma aproximação visual, não a renderização real. */
export function ChannelPreview({ format, caption, media, platforms, names, coverUrl }: Props) {
  const supported = FORMAT_SUPPORT[format];
  const shown = (platforms.length > 0 ? platforms : [...supported]).filter((p) => supported.includes(p));
  if (shown.length === 0) return null;
  return (
    <div className="preview-strip" aria-label="Pré-visualização por canal">
      {shown.map((p) => {
        const name = names[p] ?? FALLBACK_NAME[p];
        const icon = p === "INSTAGRAM" ? <IconInstagram size="sm" /> : p === "FACEBOOK_PAGE" ? <IconFacebook size="sm" /> : <IconMapPin size="sm" />;
        return (
          <figure key={p} className="preview-item">
            <figcaption className="row" style={{ gap: 6 }}>{icon}<span>{PLATFORM_LABELS[p]} · {POST_FORMAT_LABELS[format]}</span></figcaption>
            {format === "FEED" && p === "INSTAGRAM" && <InstagramFeed name={name} caption={caption} media={media} />}
            {format === "FEED" && p === "FACEBOOK_PAGE" && <FacebookFeed name={name} caption={caption} media={media} />}
            {format === "FEED" && p === "GOOGLE_BUSINESS_PROFILE" && <GoogleCard name={name} caption={caption} media={media} />}
            {format !== "FEED" && <Vertical kind={format} platform={p} name={name} caption={caption} media={media} coverUrl={coverUrl} />}
          </figure>
        );
      })}
    </div>
  );
}
