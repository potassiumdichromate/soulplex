import type React from "react";
import { lazy, Suspense, useRef, useState } from "react";
import { useStore, StoreProvider } from "./store";
import { WorldCanvas } from "./world/WorldCanvas";
import { Landing } from "./pages/Landing";
import { Shell } from "./pages/Shell";
import { Home } from "./pages/Home";

// Everything beyond the first screen loads on demand, so the start page arrives fast on slow networks.
const Guest = lazy(() => import("./pages/Guest").then((m) => ({ default: m.Guest })));
const Agent = lazy(() => import("./pages/Agent").then((m) => ({ default: m.Agent })));
const Discover = lazy(() => import("./pages/Discover").then((m) => ({ default: m.Discover })));
const Dates = lazy(() => import("./pages/Dates").then((m) => ({ default: m.Dates })));
const Insights = lazy(() => import("./pages/Insights").then((m) => ({ default: m.Insights })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Operator = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Operator })));

function Loading() {
  return <div className="page-loading" aria-label="Loading" />;
}
import { Brand } from "./ui";

/** A notification you swipe away (left or right), or close with ×. */
function SwipeToast({ text, tone, onClose }: { text: string; tone: string; onClose: () => void }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(0);
  const start = useRef<{ x: number; id: number } | null>(null);
  const end = (x: number) => {
    if (!start.current) return;
    const d = x - start.current.x;
    start.current = null;
    if (Math.abs(d) > 70) {
      setGone(Math.sign(d));
      setTimeout(onClose, 180);
    } else setDx(0);
  };
  return (
    <div
      className={"toast glass " + tone + (gone ? " gone" : "")}
      style={{ transform: gone ? `translateX(${gone * 120}%)` : dx ? `translateX(${dx}px)` : undefined, opacity: gone ? 0 : 1 - Math.min(0.7, Math.abs(dx) / 260) }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        start.current = { x: e.clientX, id: e.pointerId };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => start.current && setDx(e.clientX - start.current.x)}
      onPointerUp={(e) => end(e.clientX)}
      onPointerCancel={() => ((start.current = null), setDx(0))}
    >
      <span>{text}</span>
      <button className="toast-x" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <SwipeToast key={t.id} text={t.text} tone={t.tone} onClose={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function Router() {
  const { user, loading, page, guest } = useStore();
  if (loading)
    return (
      <div className="boot">
        <Brand />
        <p>Waking up the island…</p>
      </div>
    );
  if (!user)
    return guest ? (
      <Suspense fallback={<Loading />}>
        <Guest />
      </Suspense>
    ) : (
      <Landing />
    );
  const pages: Record<string, React.FC> = {
    home: Home,
    agent: Agent,
    discover: Discover,
    dates: Dates,
    insights: Insights,
    settings: Settings,
    operator: Operator,
  };
  const Page = pages[page] ?? Home;
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Page key={page} />
      </Suspense>
    </Shell>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <WorldCanvas />
      <Router />
      <Toasts />
    </StoreProvider>
  );
}
