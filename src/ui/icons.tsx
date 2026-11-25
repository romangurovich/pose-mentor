/** Small inline icon set (stroke icons, 24px grid). */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 20, ...p }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const Icon = {
  Logo: (p: P) => (
    <svg {...base(p)} strokeWidth={2}>
      <circle cx="12" cy="4.5" r="2" fill="currentColor" stroke="none" />
      <path d="M12 7.5v6M12 13.5l-3.5 6.5M12 13.5l3.5 6.5M5.5 9.5 12 8.5l6.5-2" />
    </svg>
  ),
  Back: (p: P) => (
    <svg {...base(p)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  Close: (p: P) => (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  Camera: (p: P) => (
    <svg {...base(p)}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  Volume: (p: P) => (
    <svg {...base(p)}>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  ),
  Mute: (p: P) => (
    <svg {...base(p)}>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M17 9l5 6M22 9l-5 6" />
    </svg>
  ),
  Mirror: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5" />
    </svg>
  ),
  Side: (p: P) => (
    <svg {...base(p)}>
      <circle cx="13" cy="4.5" r="2" />
      <path d="M13 7.5 12 14l3 6M12 14l-3 6M12.5 9l4 3" />
    </svg>
  ),
  Front: (p: P) => (
    <svg {...base(p)}>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 7.5v6.5M12 14l-3 6M12 14l3 6M6 9.5h12" />
    </svg>
  ),
  Check: (p: P) => (
    <svg {...base(p)}>
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  ),
  Alert: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </svg>
  ),
  Spark: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </svg>
  ),
  Timer: (p: P) => (
    <svg {...base(p)}>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4l2.5 2M9.5 2.5h5" />
    </svg>
  ),
  Repeat: (p: P) => (
    <svg {...base(p)}>
      <path d="M17 2.5 20.5 6 17 9.5" />
      <path d="M3.5 11V9a3 3 0 0 1 3-3h14M7 21.5 3.5 18 7 14.5" />
      <path d="M20.5 13v2a3 3 0 0 1-3 3h-14" />
    </svg>
  ),
  Shield: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  ),
  Data: (p: P) => (
    <svg {...base(p)}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
    </svg>
  ),
  Play: (p: P) => (
    <svg {...base(p)}>
      <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
    </svg>
  ),
  Pause: (p: P) => (
    <svg {...base(p)}>
      <path d="M8 5v14M16 5v14" strokeWidth={3} />
    </svg>
  ),
  Info: (p: P) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </svg>
  ),
  Arrow: (p: P) => (
    <svg {...base(p)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  Lock: (p: P) => (
    <svg {...base(p)}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  ),
};
