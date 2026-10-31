import { useEffect, useRef, useState } from "react";
import { Send, Brain, Check, ChevronRight, Sparkles, MousePointerClick, Map as MapIcon } from "lucide-react";
import { api, VENUES } from "../api";
import { useIslandActivity, placeOf } from "../islandFeed";
import { IslandGrid, IslandCard, LiveDates } from "./LiveDates";
import { SheetTabs, useSheetInsets } from "./SheetTabs";
import { useStore } from "../store";
import { Wisp, Meter, Typing, timeAgo } from "../ui";
import { withWorld } from "../world/WorldCanvas";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function ExploreButton({ big = false }: { big?: boolean }) {
  const { perform, busy, loadScenes, notify, blocker } = useStore();
  return (
    <button
      className={"btn primary glow" + (big ? " lg" : "")}
      disabled={busy}
      onClick={() =>
        perform(async () => {
          if (blocker) throw new Error(blocker);
          const r = await api("/agent/explore", "POST", { count: 3 });
          notify(r.message);
          await loadScenes();
        })
      }
    >
      <Send size={big ? 18 : 16} /> Send my agent out
    </button>
  );
}

export function Readiness() {
  const { user, memories, go, openSetup } = useStore();
  const shareable = memories.filter((m) => m.status === "approved" && m.visibility === "shareable").length;
  const steps = [
    { done: (user?.about_complete ?? 0) >= 60, label: `Complete your profile (${user?.about_complete ?? 0}%)`, to: "setup" },
    { done: !!(user?.face as any)?.kind, label: "Give your agent a face: a photo or an illustration", to: "agent", arg: "face" },
    { done: shareable >= 3, label: `Teach your agent at least 3 shareable traits (${Math.min(shareable, 3)}/3)`, to: "agent" },
    { done: !!user?.verified, label: "Eligibility verified by the operator", to: "settings" },
    { done: !!user?.discovery, label: "Turn on discovery so agents can meet yours", to: "settings" },
    { done: !!user?.contact, label: "Add a private contact for mutual introductions", to: "settings" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <div className="glass card ready-card">
      <h3>
        <Sparkles size={16} /> Get your agent ready
      </h3>
      <ul>
        {steps.map((s) => (
          <li key={s.label} className={s.done ? "done" : ""}>
            <span className="tick">{s.done && <Check size={12} />}</span>
            <span>{s.label}</span>
            {!s.done && (
              <button className="link" onClick={() => (s.to === "setup" ? openSetup(0) : go(s.to, (s as any).arg))}>
                Do it <ChevronRight size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Home() {
  const { user, insights, scenes, go, candidates } = useStore();
  const d = useIslandActivity();
  const [island, setIsland] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState("agent"); // phone / tablet bottom-sheet tab
  const [folded, setFolded] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useSheetInsets(sheet);
  const openTab = (t: string) => {
    setTab(t);
    setFolded(false);
  };

  // clicks in the 3D world
  useEffect(() => {
    withWorld((w) => {
      w.onIsland = (id) => {
        setSel(null);
        setIsland(id);
        openTab("islands");
      };
      w.onCouple = (id) => {
        setSel(id);
        openTab("live");
      };
    });
    return () =>
      withWorld((w) => {
        w.onIsland = undefined;
        w.onCouple = undefined;
      });
  }, []);

  // drive the camera: a watched couple, else an island, else the whole archipelago
  useEffect(() => {
    withWorld((w) => {
      if (sel && w.focusCouple(sel, 0)) return;
      w.focusCouple(null);
      w.focusIsland(island, 0);
    });
  }, [sel, island]);

  // a watched date that ended: fall back to its island
  useEffect(() => {
    if (sel && d && !d.live.some((l) => l.id === sel)) setSel(null);
  }, [d, sel]);

  const pick = (id: string | null) => {
    setSel(id);
    if (id) openTab("live");
    const l = d?.live.find((x) => x.id === id);
    if (l) setIsland(l.type);
  };

  const active = scenes.filter((s) => s.status === "queued" || s.status === "running");
  const feed = scenes.slice(0, 4);
  const invites = scenes.filter((s) => s.incoming && s.status === "invited");
  const status = active.length
    ? `On ${active.length === 1 ? "a date with " + active[0].partner.name : active.length + " dates"} right now`
    : scenes.length
      ? `Back from ${scenes.length} date${scenes.length > 1 ? "s" : ""}, wandering the island`
      : "Wandering the island, waiting to meet someone";

  return (
    <div ref={sheet} className={"home tab-" + tab + (folded ? " folded" : "")}>
      <SheetTabs
        tab={tab}
        onTab={openTab}
        collapsed={folded}
        onToggle={() => setFolded((f) => !f)}
        tabs={[
          ["agent", "Your agent"],
          ["islands", "Islands"],
          ["live", <>Live{d ? <em className="count">{d.active}</em> : null}</>],
        ]}
      />
      <div className="home-left">
        <div className="glass card agent-card">
          <div className="agent-top">
            <Wisp hue={user!.hue} size={64} self face={user!.face} seed={user!.id} />
            <div>
              <span className="eyebrow">{greeting()}, {user!.name}</span>
              <h2>Your agent</h2>
              <p className="status">
                <span className={"live" + (active.length ? " on" : "")} /> {status}
              </p>
            </div>
          </div>
          <div className="knows">
            <div>
              <span>Knows you</span>
              <strong>{insights?.knowledge ?? 0}%</strong>
            </div>
            <Meter value={insights?.knowledge ?? 0} />
            <small>
              {insights?.traits.approved ?? 0} traits · {insights?.funnel.dates ?? 0} dates ·{" "}
              {insights?.average != null ? insights.average + "% avg resonance" : "no resonance yet"}
            </small>
          </div>
          <div className="agent-actions">
            <ExploreButton />
            <button className="btn ghost" onClick={() => go("agent")}>
              <Brain size={16} /> Teach it
            </button>
          </div>
        </div>
        {invites.length > 0 && (
          <div className="glass card inbox-card">
            <h3>💌 {invites.length === 1 ? "An invitation for you" : `${invites.length} invitations for you`}</h3>
            {invites.map((s) => (
              <button key={s.id} className="feed-item" onClick={() => go("dates", s.id)}>
                <Wisp hue={s.partner.hue} size={36} face={s.partner.face} seed={s.partner.id} />
                <span className="feed-text">
                  <strong>
                    {s.partner.name}'s agent · {VENUES[s.venue]?.name}
                  </strong>
                  <small>Tap to see their profile and accept or decline</small>
                </span>
              </button>
            ))}
          </div>
        )}
        <Readiness />
        {island ? (
          <IslandCard id={island} d={d} selected={sel} onSelect={pick} onClose={() => (setSel(null), setIsland(null))} />
        ) : (
          <div className="glass card ideas">
            <h3>
              <MapIcon size={15} /> 10 date islands
            </h3>
            <IslandGrid d={d} island={island} onIsland={(id) => (setSel(null), setIsland(id))} />
            <p className="fine">Each island hosts one kind of date at 2-3 spots. Tap one to fly there.</p>
          </div>
        )}
      </div>

      <div className="home-right">
        <LiveDates d={d} island={island} selected={sel} onSelect={pick} onIsland={(id) => (setSel(null), setIsland(id))} max={30} />
        <div className="glass card feed">
          <div className="feed-head">
            <h3>Your dates</h3>
            <button className="link" onClick={() => go("dates")}>
              All dates <ChevronRight size={14} />
            </button>
          </div>
          {!feed.length && (
            <div className="feed-empty">
              <p>No dates yet. {candidates.length ? `${candidates.length} agents nearby are open to meeting yours.` : ""}</p>
              <ExploreButton />
            </div>
          )}
          {feed.map((s) => {
            const a = s.output?.assessment;
            return (
              <button key={s.id} className="feed-item" onClick={() => go("dates", s.id)}>
                <span className="pair">
                  <Wisp hue={user!.hue} size={30} self face={user!.face} seed={user!.id} />
                  <Wisp hue={s.partner.hue} size={30} face={s.partner.face} seed={s.partner.id} />
                </span>
                <span className="feed-text">
                  <strong>
                    {s.incoming ? "From " : ""}
                    {s.partner.name} · {VENUES[s.venue]?.name}
                  </strong>
                  <small>
                    {s.status !== "invited" && s.status !== "declined" && <>📍 {placeOf(s.venue, s.spot)} · </>}
                    {s.status === "invited"
                      ? s.incoming
                        ? "💌 Invited you · tap to respond"
                        : "Invitation sent · waiting for them"
                      : s.status === "declined"
                        ? "Declined"
                        : s.stale
                      ? "Profiles changed. Start a fresh date"
                      : s.status === "queued"
                        ? "Walking over…"
                        : s.status === "running"
                          ? "In conversation"
                          : s.status === "failed"
                            ? s.error || "Didn't happen"
                            : s.mutual
                              ? "You both said yes 💞"
                              : s.mine.decision === "pending"
                                ? "Replay & decide · " + timeAgo(s.created)
                                : "You chose " + s.mine.decision}
                  </small>
                </span>
                {s.status === "running" || s.status === "queued" ? (
                  <Typing />
                ) : a && !s.stale ? (
                  <span className="score">{a.score}%</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="hint">
          <MousePointerClick size={14} /> Drag to look around · click an island or a couple
        </p>
      </div>
    </div>
  );
}
