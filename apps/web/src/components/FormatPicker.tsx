"use client";

import { POST_FORMAT_LABELS, type PostFormat } from "@fsp/core/platforms";
import { IconImage, IconMegaphone, IconVideo } from "./Icons";

const OPTIONS: Array<{ value: PostFormat; icon: React.ReactNode; hint: string }> = [
  { value: "FEED", icon: <IconImage size="sm" />, hint: "Imagens, carrossel ou vídeo no feed. Única opção para o Google Meu Negócio." },
  { value: "STORY", icon: <IconMegaphone size="sm" />, hint: "Uma imagem ou um vídeo, some em 24h. Vídeos acima de 60s são divididos em partes automaticamente. A legenda não é enviada." },
  { value: "REEL", icon: <IconVideo size="sm" />, hint: "Um vídeo vertical: até 90s no Facebook, até 15min no Instagram." },
];

export function FormatPicker({ value, onChange }: { value: PostFormat; onChange: (f: PostFormat) => void }) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0]!;
  return (
    <div className="field">
      <span className="label-text" style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-2)", marginBottom: 6, display: "block" }}>Formato</span>
      <div className="row" role="radiogroup" aria-label="Formato da postagem">
        {OPTIONS.map((o) => (
          <label key={o.value} className={`chip ${value === o.value ? "on" : ""}`}>
            <input type="radio" name="format" value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} style={{ accentColor: "var(--accent)" }} />
            {o.icon} {POST_FORMAT_LABELS[o.value]}
          </label>
        ))}
      </div>
      <small className="hint">{current.hint}</small>
    </div>
  );
}
