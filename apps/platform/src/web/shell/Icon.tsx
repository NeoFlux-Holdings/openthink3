/* Icon set ported from the design handoff (icons.jsx).
 * 24x24 viewBox · 1.5 stroke · round caps/joins · currentColor.
 * Each path is intentionally hand-drawn so we never depend on an icon font.
 */
import type { CSSProperties, ReactElement } from 'react';

export type IconName =
  | 'sparkle' | 'plus' | 'minus' | 'search' | 'library' | 'brain' | 'bolt'
  | 'settings' | 'help' | 'arrow_right' | 'arrow_left' | 'arrow_up' | 'arrow_down'
  | 'check' | 'x' | 'code' | 'doc' | 'table' | 'image' | 'slides' | 'chart'
  | 'browser' | 'grid' | 'list' | 'layers' | 'expand' | 'collapse' | 'popout'
  | 'edit' | 'paperclip' | 'send' | 'flame' | 'web' | 'cpu' | 'git' | 'pr'
  | 'user' | 'folder' | 'lock' | 'refresh' | 'chevron_down' | 'chevron_right'
  | 'chevron_left' | 'chevron_up' | 'drag' | 'play' | 'pause' | 'download'
  | 'copy' | 'star' | 'eye' | 'cmd' | 'mail' | 'calendar' | 'slack' | 'coin'
  | 'cloud' | 'terminal' | 'book' | 'sun' | 'moon' | 'shield' | 'flow' | 'info'
  | 'sort' | 'filter' | 'more' | 'mic' | 'bell' | 'qr' | 'home' | 'plug'
  | 'history' | 'trash' | 'pin' | 'at';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
  'aria-hidden'?: boolean;
  'aria-label'?: string;
}

const PATHS: Record<IconName, ReactElement> = {
  sparkle: (<><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></>),
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  search: (<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>),
  library: (<><path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14"/><path d="M4 19a2 2 0 002 2h12a2 2 0 002-2"/><path d="M9 7v10M14 7v10"/></>),
  brain: (<><path d="M9.5 2A2.5 2.5 0 007 4.5v0A2.5 2.5 0 004.5 7 2.5 2.5 0 002 9.5v3A2.5 2.5 0 004.5 15v0A2.5 2.5 0 007 17.5v0A2.5 2.5 0 009.5 20H12V2H9.5z"/><path d="M14.5 2A2.5 2.5 0 0117 4.5v0A2.5 2.5 0 0019.5 7 2.5 2.5 0 0122 9.5v3a2.5 2.5 0 01-2.5 2.5v0a2.5 2.5 0 01-2.5 2.5v0A2.5 2.5 0 0114.5 20H12V2h2.5z"/></>),
  bolt: <path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"/>,
  settings: (<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.7-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.7.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.7 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/></>),
  help: (<><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01"/></>),
  arrow_right: <path d="M5 12h14M13 5l7 7-7 7"/>,
  arrow_left: <path d="M19 12H5M11 19l-7-7 7-7"/>,
  arrow_up: <path d="M12 19V5M5 12l7-7 7 7"/>,
  arrow_down: <path d="M12 5v14M5 12l7 7 7-7"/>,
  check: <path d="M5 12l5 5L20 7"/>,
  x: <path d="M18 6L6 18M6 6l12 12"/>,
  code: <path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>,
  doc: (<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>),
  table: (<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></>),
  image: (<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>),
  slides: (<><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></>),
  chart: (<><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 6-6"/></>),
  browser: (<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><circle cx="6" cy="6" r="0.5"/><circle cx="8" cy="6" r="0.5"/></>),
  grid: (<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>,
  layers: (<><path d="M12 2l-10 5 10 5 10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></>),
  expand: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>,
  collapse: <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>,
  popout: <path d="M15 3h6v6M10 14L21 3M21 14v7H3V3h7"/>,
  edit: (<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>),
  paperclip: <path d="M21.4 11.05l-9.18 9.18a6 6 0 11-8.49-8.48l9.18-9.19a4 4 0 015.66 5.66l-9.2 9.18a2 2 0 11-2.83-2.83l8.49-8.48"/>,
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>,
  flame: <path d="M14 4c0 4 5 5 5 11a7 7 0 11-14 0c0-3 2-4 2-7 0 1 1 2 2 2 0-3 2-4 2-6 1 1 3 1 3 0z"/>,
  web: (<><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></>),
  cpu: (<><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></>),
  git: (<><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="6" cy="18" r="3"/><path d="M9 6h6a3 3 0 013 3v6M6 9v6"/></>),
  pr: (<><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v6M21 11.5V9a3 3 0 00-3-3h-3l2-2m0 4l-2-2"/></>),
  user: (<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
  folder: <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>,
  lock: (<><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>),
  refresh: (<><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></>),
  chevron_down: <path d="M6 9l6 6 6-6"/>,
  chevron_right: <path d="M9 6l6 6-6 6"/>,
  chevron_left: <path d="M15 6l-6 6 6 6"/>,
  chevron_up: <path d="M18 15l-6-6-6 6"/>,
  drag: (<><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></>),
  play: <path d="M5 3l14 9-14 9V3z"/>,
  pause: (<><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>),
  download: <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>,
  copy: (<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>),
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
  eye: (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>),
  cmd: <path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z"/>,
  mail: (<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>),
  slack: (<><rect x="3" y="9" width="6" height="6" rx="1"/><rect x="15" y="9" width="6" height="6" rx="1"/><rect x="9" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/></>),
  coin: (<><circle cx="12" cy="12" r="10"/><path d="M12 7v10M9 9.5a2.5 2.5 0 015 0c0 1.4-1 2.5-2.5 2.5S9 13 9 14.5a2.5 2.5 0 005 0"/></>),
  cloud: <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>,
  terminal: (<><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>),
  book: (<><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></>),
  sun: (<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>),
  moon: <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
  flow: (<><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 6h8M8 18h8M6 8v8M18 8v8"/></>),
  info: (<><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>),
  sort: <path d="M3 6h13M3 12h9M3 18h5M18 6v12M14 14l4 4 4-4"/>,
  filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>,
  more: (<><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>),
  mic: (<><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3"/></>),
  bell: (<><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>),
  qr: (<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3M20 14v3M14 17v4M17 20h4"/></>),
  home: (<><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2z"/></>),
  plug: <path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 01-12 0zM12 18v4"/>,
  history: (<><path d="M3 12a9 9 0 109-9 9 9 0 00-7.5 4M3 4v5h5"/><path d="M12 7v5l3 2"/></>),
  trash: <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>,
  pin: <path d="M12 17v5M9 10.76V6a2 2 0 012-2h2a2 2 0 012 2v4.76L17 13H7z"/>,
  at: (<><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94"/></>),
};

export function Icon({
  name,
  size = 16,
  color = 'currentColor',
  strokeWidth = 1.5,
  style,
  className = '',
  'aria-hidden': ariaHidden = true,
  'aria-label': ariaLabel,
}: IconProps) {
  const role = ariaLabel ? 'img' : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden={ariaLabel ? undefined : ariaHidden}
      aria-label={ariaLabel}
      role={role}
    >
      {PATHS[name]}
    </svg>
  );
}
