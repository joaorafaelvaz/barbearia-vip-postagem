import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: "sm" | "md" };

function I({ size = "md", className = "", children, ...rest }: P) {
  return (
    <svg className={`icon ${size === "sm" ? "sm" : ""} ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

/* Ícones com traços no estilo Lucide (ISC). */
export const IconDashboard = (p: P) => <I {...p}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></I>;
export const IconPlus = (p: P) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const IconStore = (p: P) => <I {...p}><path d="M3 9l1.5-5h15L21 9" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /><path d="M5 11v9h14v-9" /><path d="M10 20v-5h4v5" /></I>;
export const IconCalendar = (p: P) => <I {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></I>;
export const IconClock = (p: P) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>;
export const IconImage = (p: P) => <I {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></I>;
export const IconVideo = (p: P) => <I {...p}><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3z" /></I>;
export const IconUpload = (p: P) => <I {...p}><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></I>;
export const IconCheck = (p: P) => <I {...p}><path d="M20 6L9 17l-5-5" /></I>;
export const IconX = (p: P) => <I {...p}><path d="M18 6L6 18M6 6l12 12" /></I>;
export const IconAlert = (p: P) => <I {...p}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></I>;
export const IconInfo = (p: P) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></I>;
export const IconRetry = (p: P) => <I {...p}><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 21v-5h5" /></I>;
export const IconLogout = (p: P) => <I {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></I>;
export const IconChevronLeft = (p: P) => <I {...p}><path d="M15 18l-6-6 6-6" /></I>;
export const IconChevronRight = (p: P) => <I {...p}><path d="M9 18l6-6-6-6" /></I>;
export const IconLink = (p: P) => <I {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></I>;
export const IconMegaphone = (p: P) => <I {...p}><path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M14 9a4 4 0 0 1 0 6M17 6a8 8 0 0 1 0 12" /></I>;
export const IconFacebook = (p: P) => <I {...p}><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></I>;
export const IconInstagram = (p: P) => <I {...p}><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></I>;
export const IconMapPin = (p: P) => <I {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></I>;

export function PlatformIcon({ platform, size }: { platform: string; size?: "sm" | "md" }) {
  if (platform === "FACEBOOK_PAGE") return <IconFacebook size={size} />;
  if (platform === "INSTAGRAM") return <IconInstagram size={size} />;
  return <IconMapPin size={size} />;
}
