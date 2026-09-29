// Minimal inline SVG icons — no icon library dependency, matching how the
// rest of this app already avoids pulling one in. Deliberately plain
// (24x24, single stroke, no fills) rather than trying to match any
// particular icon set exactly.
type IconProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function DashboardIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="12" width="8" height="9" rx="1.5" />
      <rect x="3" y="15" width="8" height="6" rx="1.5" />
    </svg>
  );
}

export function CampaignsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 10v4a1 1 0 0 0 1 1h2l4 4v-14l-4 4H4a1 1 0 0 0-1 1Z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
      <path d="M18.5 6.5a7 7 0 0 1 0 11" />
    </svg>
  );
}

export function InventoryIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-6h6v6" />
      <path d="M9 12h.01M15 12h.01M12 8h.01" />
    </svg>
  );
}

export function ClientsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="8" r="2.4" />
      <path d="M15.5 14.2c2.4.4 4.5 2.6 4.5 5.8" />
    </svg>
  );
}

export function InsightsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function AiIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    </svg>
  );
}

export function ReportsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

export function AreasIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" />
      <path d="M9 4v13M15 6.5v13" />
    </svg>
  );
}

export function ShortlistIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
    </svg>
  );
}

export function RecentIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function SearchIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function BellIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function ExportIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ExpandIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}

export function FilterIcon({ size = 15 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 5h16M7 12h10M10 19h4" />
    </svg>
  );
}

export function PlusIcon({ size = 15 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SidebarCollapseIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M14.5 9l-2.5 3 2.5 3" />
    </svg>
  );
}
