import logoMark from "./assets/logo-mark.png";
import { useEffect, useState, type ReactNode } from "react";
import { DIM_LABEL, type FaceView } from "./api";
import { faceUrl } from "./faces";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={"brand" + (small ? " small" : "")}>
      <img className="brand-logo" src={logoMark} alt="" aria-hidden="true" />
      <span className="brand-word">soulplex</span>
    </div>
  );
}

/** An agent's avatar: their chosen face inside a glow ring in their colour. */
export function Wisp({
  hue,
  size = 44,
  self = false,
  name,
  face,
  seed,
}: {
  hue: number;
  size?: number;
  self?: boolean;
  name?: string;
  face?: FaceView | null;
  seed?: string;
}) {
  const url = faceUrl(face, seed ?? name ?? String(hue), hue);
  const locked = (face as any)?.locked;
  return (
    <span
      className={"wisp" + (self ? " self" : "") + (locked ? " locked" : "")}
      style={{ "--h": hue, width: size, height: size } as React.CSSProperties}
      aria-label={name ? name + "'s agent" : undefined}
      role={name ? "img" : undefined}
      title={locked ? "Photo revealed after a mutual match" : undefined}
    >
      <i />
      <img src={url} alt="" draggable={false} />
    </span>
  );
}

export function useCountUp(target: number, ms = 1400, run = true) {
  const [v, setV] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, run]);
  return v;
}

export function Ring({
  value,
  size = 140,
  stroke = 10,
  label,
  sub,
  animate = true,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  sub?: string;
  animate?: boolean;
}) {
  const shown = useCountUp(value, 1500, animate);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const id = "rg" + size + stroke;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffc59e" />
            <stop offset=".5" stopColor="#ff7eb6" />
            <stop offset="1" stopColor="#a98bff" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-text">
        <strong style={{ fontSize: size * 0.24 }}>
          {shown}
          <small>%</small>
        </strong>
        {label && <span>{label}</span>}
        {sub && <em>{sub}</em>}
      </div>
    </div>
  );
}

export function Meter({ value, tone = "grad" }: { value: number; tone?: "grad" | "mint" | "gold" }) {
  return (
    <span className={"meter " + tone}>
      <i style={{ width: Math.max(2, Math.min(100, value)) + "%" }} />
    </span>
  );
}

export function Radar({ values, size = 240 }: { values: Record<string, number>; size?: number }) {
  const dims = Object.keys(DIM_LABEL);
  const c = size / 2,
    R = size / 2 - 40;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / dims.length) * Math.PI * 2;
    return [c + Math.cos(a) * R * v, c + Math.sin(a) * R * v];
  };
  const poly = dims.map((d, i) => pt(i, (values[d] ?? 0) / 100).join(",")).join(" ");
  return (
    <svg className="radar" width="100%" viewBox={`-24 -6 ${size + 48} ${size + 12}`} role="img" aria-label="Resonance by dimension">
      <defs>
        <linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb38a" stopOpacity=".55" />
          <stop offset="1" stopColor="#a98bff" stopOpacity=".55" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon
          key={k}
          points={dims.map((_, i) => pt(i, k).join(",")).join(" ")}
          fill="none"
          stroke="rgba(255,255,255,.12)"
        />
      ))}
      {dims.map((d, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.2);
        return (
          <g key={d}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="rgba(255,255,255,.1)" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="radar-label">
              {DIM_LABEL[d]}
            </text>
          </g>
        );
      })}
      <polygon className="radar-shape" points={poly} fill="url(#radarFill)" stroke="#ffb3d1" strokeWidth="2" />
      {dims.map((d, i) => {
        if (values[d] === undefined) return null;
        const [x, y] = pt(i, values[d] / 100);
        return <circle key={d} cx={x} cy={y} r="4" fill="#fff" />;
      })}
    </svg>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Typing() {
  return (
    <span className="typing" aria-label="typing">
      <i />
      <i />
      <i />
    </span>
  );
}

export function timeAgo(ts: number) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
