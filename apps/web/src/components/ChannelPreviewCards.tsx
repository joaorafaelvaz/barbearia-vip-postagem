"use client";

import { STORY_MAX_VIDEO_SECONDS, planStorySegments, type Platform } from "@fsp/core/platforms";
import { IconMapPin } from "./Icons";
import type { Uploaded } from "./MediaPicker";

function shortenAt(text: string, max: number, more: string): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join("").trimEnd()}… ${more}`;
}

function Media({ m, poster, className }: { m: Uploaded | undefined; poster?: string; className?: string }) {
  if (!m) return <div className={`pv-media empty ${className ?? ""}`}><span>sem mídia</span></div>;
  if (m.kind === "VIDEO") return <video className={`pv-media ${className ?? ""}`} src={m.publicUrl} muted playsInline preload="metadata" poster={poster} />;
  return <img className={`pv-media ${className ?? ""}`} src={m.publicUrl} alt="" />;
}

function Avatar({ label }: { label: string }) {
  return <span className="pv-avatar" aria-hidden="true">{label.replace(/^@/, "").slice(0, 1).toUpperCase()}</span>;
}

const handle = (name: string) => name.replace(/^@/, "");

export function InstagramFeed({ name, caption, media }: { name: string; caption: string; media: Uploaded[] }) {
  const first = media[0];
  const ratio = first && first.width && first.height ? first.width / first.height : 1;
  const aspect = ratio < 1 ? "4 / 5" : ratio > 1.2 ? "1.91 / 1" : "1 / 1";
  return (
    <div className="pv-card ig">
      <div className="pv-head"><Avatar label={name} /><strong>{handle(name)}</strong></div>
      <div className="pv-square" style={{ aspectRatio: aspect }}><Media m={first} />{media.length > 1 && <span className="pv-count">1/{media.length}</span>}</div>
      <div className="pv-actions" aria-hidden="true"><span>♡</span><span>◯</span><span>➤</span></div>
      <p className="pv-caption"><strong>{handle(name)}</strong> {caption ? shortenAt(caption, 125, "mais") : <span className="muted">(sem legenda)</span>}</p>
    </div>
  );
}

export function FacebookFeed({ name, caption, media }: { name: string; caption: string; media: Uploaded[] }) {
  return (
    <div className="pv-card fb">
      <div className="pv-head"><Avatar label={name} /><span><strong>{name}</strong><br /><small>Agora · 🌐</small></span></div>
      <p className="pv-text">{caption ? shortenAt(caption, 400, "Ver mais") : <span className="muted">(sem texto)</span>}</p>
      {media.length > 0 && (
        <div className={`pv-fbgrid n${Math.min(media.length, 4)}`}>
          {media.slice(0, 4).map((m, i) => <div key={m.id} className="pv-cell"><Media m={m} />{i === 3 && media.length > 4 && <span className="pv-more">+{media.length - 4}</span>}</div>)}
        </div>
      )}
      <div className="pv-actions" aria-hidden="true"><span>👍 Curtir</span><span>💬 Comentar</span><span>↗ Compartilhar</span></div>
    </div>
  );
}

export function GoogleCard({ name, caption, media }: { name: string; caption: string; media: Uploaded[] }) {
  return (
    <div className="pv-card gbp">
      <div className="pv-head"><IconMapPin size="sm" /><span><strong>{name}</strong><br /><small>Novidade · agora</small></span></div>
      <div className="pv-gbpmedia"><Media m={media[0]} /></div>
      <p className="pv-text">{caption ? shortenAt(caption, 300, "") : <span className="muted">(sem texto)</span>}</p>
      <span className="pv-link">Saiba mais</span>
    </div>
  );
}

export function Vertical({ kind, platform, name, caption, media, coverUrl }: { kind: "STORY" | "REEL"; platform: Platform; name: string; caption: string; media: Uploaded[]; coverUrl?: string }) {
  const first = media[0];
  const parts = kind === "STORY" && first?.kind === "VIDEO" && (first.durationSec ?? 0) > STORY_MAX_VIDEO_SECONDS ? planStorySegments(first.durationSec ?? 0).length : 1;
  return (
    <div className={`pv-phone ${kind.toLowerCase()}`}>
      <Media m={first} className="fill" poster={kind === "REEL" ? coverUrl : undefined} />
      {kind === "STORY" && (
        <>
          <div className="pv-bars" aria-hidden="true">{Array.from({ length: parts }, (_, i) => <span key={i} className={i === 0 ? "on" : ""} />)}</div>
          <div className="pv-story-head"><Avatar label={name} /><strong>{handle(name)}</strong><small>agora</small></div>
          {parts > 1 && <span className="pv-parts">{parts} partes</span>}
          <div className="pv-reply">{platform === "INSTAGRAM" ? "Enviar mensagem" : "Responder..."}</div>
        </>
      )}
      {kind === "REEL" && (
        <>
          <div className="pv-reel-side" aria-hidden="true"><span>♡</span><span>◯</span><span>➤</span><span>⋯</span></div>
          <div className="pv-reel-foot"><div className="pv-head light"><Avatar label={name} /><strong>{handle(name)}</strong></div><p>{shortenAt(caption, 90, "mais")}</p></div>
          {coverUrl && <span className="pv-parts">Capa personalizada</span>}
        </>
      )}
    </div>
  );
}
