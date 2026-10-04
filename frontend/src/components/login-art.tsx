import { useId } from "react";

/** The picture beside the login form: violet hills with terraces, a sun and clouds, and in front
 * the building the app is about (a shop for the POS, a warehouse for the ERP). Drawn inline, so
 * there are no image files to load; its colours are fixed, it sits on its own panel in both themes.
 * Kept identical in the ERP and the POS (components/login-art.tsx). */
export function LoginArt({ variant, anchor = "center" }: { variant: "erp" | "pos"; anchor?: "center" | "bottom" }) {
  // Gradient ids are per picture: the page may hold two (a phone banner and the side panel), and
  // a reference into the hidden one would leave the visible one without colours.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `${uid}-${name}`;
  return (
    <svg
      // A wide, short strip frames just the building and the hills around it, roof to ground.
      viewBox={anchor === "bottom" ? "0 280 400 190" : "0 0 400 520"}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 size-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b4bdb" />
          <stop offset="0.55" stopColor="#8b6cf0" />
          <stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
        <linearGradient id={id("far")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id={id("mid")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c5ce8" />
          <stop offset="1" stopColor="#5b3fc4" />
        </linearGradient>
        <linearGradient id={id("near")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4c33b0" />
          <stop offset="1" stopColor="#2e1d78" />
        </linearGradient>
      </defs>

      <rect width="400" height="520" fill={`url(#${id("sky")})`} />
      <circle cx="300" cy="196" r="44" fill="#fde68a" opacity="0.9" />
      <circle cx="300" cy="196" r="66" fill="#fde68a" opacity="0.15" />
      <g fill="#ffffff" opacity="0.75">
        <rect x="40" y="236" width="96" height="22" rx="11" />
        <rect x="66" y="222" width="52" height="26" rx="13" />
        <rect x="236" y="246" width="84" height="18" rx="9" opacity="0.8" />
        <rect x="258" y="235" width="40" height="20" rx="10" opacity="0.8" />
      </g>

      <path d="M0 300 C70 250 130 270 190 240 C250 210 320 250 400 220 L400 520 L0 520 Z" fill={`url(#${id("far")})`} />
      <path d="M0 360 C80 300 150 330 220 300 C290 270 340 300 400 285 L400 520 L0 520 Z" fill={`url(#${id("mid")})`} />
      {/* terraces on the middle hill */}
      <g fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round">
        <path d="M20 372 C90 326 150 352 220 324 C280 300 330 322 390 306" />
        <path d="M30 392 C100 348 160 372 228 346 C288 322 336 342 392 328" />
        <path d="M40 412 C108 370 170 392 236 368 C294 346 340 362 394 350" />
        <path d="M52 432 C116 392 178 412 244 390 C300 370 344 384 396 372" />
      </g>
      <path d="M0 440 C90 400 160 430 240 410 C310 392 350 410 400 400 L400 520 L0 520 Z" fill={`url(#${id("near")})`} />

      {variant === "pos" ? <Shop /> : <Warehouse />}
    </svg>
  );
}

function Shop() {
  return (
    <g transform="translate(118 318)">
      <ellipse cx="82" cy="134" rx="104" ry="10" fill="#1e1356" opacity="0.45" />
      <rect x="6" y="30" width="152" height="104" rx="6" fill="#f5f3ff" />
      <rect x="0" y="0" width="164" height="22" rx="5" fill="#312e81" />
      <text x="82" y="15.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fde68a" fontFamily="sans-serif">
        STORE
      </text>
      {/* awning */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <path
          key={i}
          d={`M${i * 20.5} 22 h20.5 v12 a10.25 10.25 0 0 1 -20.5 0 Z`}
          fill={i % 2 ? "#ffffff" : "#f472b6"}
        />
      ))}
      <rect x="20" y="58" width="66" height="50" rx="4" fill="#c7d2fe" />
      <path d="M28 98 l14 -22 l12 16 l8 -10 l16 16 Z" fill="#818cf8" opacity="0.8" />
      <rect x="100" y="58" width="44" height="76" rx="4" fill="#4c1d95" />
      <rect x="106" y="64" width="32" height="30" rx="3" fill="#a78bfa" />
      <circle cx="134" cy="102" r="2.5" fill="#fde68a" />
      <rect x="28" y="114" width="50" height="14" rx="3" fill="#fde68a" />
      <text x="53" y="124.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#312e81" fontFamily="sans-serif">
        OPEN
      </text>
    </g>
  );
}

function Warehouse() {
  return (
    <g transform="translate(100 306)">
      <ellipse cx="100" cy="146" rx="124" ry="11" fill="#1e1356" opacity="0.45" />
      <path d="M0 52 L92 8 L184 52 Z" fill="#312e81" />
      <rect x="10" y="50" width="164" height="96" rx="4" fill="#f5f3ff" />
      <rect x="44" y="76" width="96" height="70" rx="3" fill="#4c1d95" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="48" y={82 + i * 12} width="88" height="7" rx="2" fill="#6d28d9" />
      ))}
      <rect x="20" y="62" width="16" height="10" rx="2" fill="#c7d2fe" />
      <rect x="148" y="62" width="16" height="10" rx="2" fill="#c7d2fe" />
      {/* boxes stacked by the door */}
      <g>
        <rect x="186" y="110" width="36" height="36" rx="3" fill="#fbbf24" />
        <rect x="201" y="110" width="6" height="36" fill="#f59e0b" />
        <rect x="190" y="78" width="30" height="32" rx="3" fill="#fcd34d" />
        <rect x="202" y="78" width="6" height="32" fill="#f59e0b" />
        <rect x="-26" y="118" width="30" height="28" rx="3" fill="#fcd34d" />
        <rect x="-14" y="118" width="6" height="28" fill="#f59e0b" />
      </g>
    </g>
  );
}
