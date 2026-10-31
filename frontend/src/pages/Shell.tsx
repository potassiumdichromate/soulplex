import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Globe2, Brain, Compass, Coffee, LineChart, Settings, ShieldCheck, LogOut } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Brand, Wisp } from "../ui";
import { withWorld } from "../world/WorldCanvas";
import { faceUrl, headUrl, bodyColors } from "../faces";
const SetupWizard = lazy(() => import("./SetupWizard").then((m) => ({ default: m.SetupWizard })));
import { startIslandFeed, stopIslandFeed } from "../islandFeed";

const NAV = [
  { id: "home", label: "World", icon: Globe2 },
  { id: "agent", label: "My agent", icon: Brain },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "dates", label: "Dates", icon: Coffee },
  { id: "insights", label: "Insights", icon: LineChart },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, page, go, scenes, candidates, mode, perform, applySession, logout, memories, setup, openSetup } = useStore();
  const pending = scenes.filter(
    (s) => s.status === "completed" && !s.stale && !s.mine.reviewed && s.mine.decision === "pending",
  ).length;
  const proposals = memories.filter((m) => m.status === "proposed").length;

  // dates happening across the islands (kept in sync with the 3D world on every page)
  useEffect(() => {
    if (!user) return;
    startIslandFeed();
    return () => stopIslandFeed();
  }, [user?.id]);

  // keep the island populated with real agents
  useEffect(() => {
    if (!user) return;
    withWorld((w) =>
      w.setAgents([
        { id: user.id, name: user.name, hue: user.hue, self: true, face: headUrl(user.face, user.id, user.hue), ...bodyColors(user.face, user.id, user.hue) },
        ...candidates.slice(0, 10).map((c) => ({ id: c.id, name: c.name, hue: c.hue, face: headUrl(c.face, c.id, c.hue), ...bodyColors(c.face, c.id, c.hue) })),
      ]),
    );
  }, [user?.id, user?.name, user?.face, candidates]);

  useEffect(() => {
    if (page !== "dates")
      withWorld((w) => {
        w.setDate(null);
        w.setMode(page === "home" ? "home" : "calm");
      });
  }, [page]);

  const nav = user?.role === "admin" ? [...NAV, { id: "operator", label: "Operator", icon: ShieldCheck }] : NAV;

  return (
    <div className={"shell page-" + page}>
      <aside className="rail glass">
        <button className="rail-brand" onClick={() => go("home")} aria-label="Soulplex home">
          <Brand small />
        </button>
        <nav>
          {nav.map((n) => (
            <button key={n.id} className={page === n.id ? "on" : ""} onClick={() => go(n.id)}>
              <n.icon size={20} />
              <span>{n.label}</span>
              {n.id === "dates" && pending > 0 && <em className="badge">{pending}</em>}
              {n.id === "agent" && proposals > 0 && <em className="badge">{proposals}</em>}
            </button>
          ))}
        </nav>
        <div className="rail-me">
          <Wisp hue={user!.hue} size={40} self name={user!.name} face={user!.face} seed={user!.id} />
          <div>
            <strong>{user!.name}</strong>
            <span>{user!.city}</span>
          </div>
          <button className="icon-btn" aria-label="Sign out" onClick={logout}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {mode === "demo" && (
        <div className="demo-bar glass">
          <span className="dot" /> Fictional demo
          <span className="sep" />
          <span className="muted">View as</span>
          {["maya", "arjun", "operator"].map((p) => (
            <button
              key={p}
              className={user!.email.startsWith(p + "@") ? "on" : ""}
              onClick={() =>
                perform(async () => {
                  applySession(await api("/auth/demo/" + p, "POST"));
                  go(p === "operator" ? "operator" : "home");
                })
              }
            >
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      )}
      <main className="stage">{children}</main>
      {setup !== null && (
        <Suspense fallback={null}>
          <SetupWizard start={setup} onClose={() => openSetup(null)} />
        </Suspense>
      )}
    </div>
  );
}

export function Panel({ children, wide = false, className = "" }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <section className={"panel glass " + (wide ? "wide " : "") + className}>
      <div className="panel-scroll">{children}</div>
    </section>
  );
}

export function Head({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="phead">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {children && <div className="phead-actions">{children}</div>}
    </header>
  );
}
