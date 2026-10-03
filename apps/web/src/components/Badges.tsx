import { STATUS_LABELS, platformLabel } from "@/lib/format";
import { PlatformIcon } from "./Icons";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className="badge platform">
      <PlatformIcon platform={platform} size="sm" />
      {platformLabel(platform)}
    </span>
  );
}
