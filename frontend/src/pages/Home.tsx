import { useEffect, useRef, useState } from "react";
import { Send, Brain, Check, ChevronRight, Sparkles, MousePointerClick, Map as MapIcon } from "lucide-react";
import { api, VENUES } from "../api";
import { useIslandActivity, placeOf } from "../islandFeed";
import { IslandGrid, IslandCard, LiveDates, SceneControls } from "./LiveDates";
import { SheetTabs, useSheetInsets } from "./SheetTabs";
import { useStore } from "../store";
import { Wisp, Typing, timeAgo } from "../ui";
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
      <Send size={big ? 18 : 16} /> Let my twin explore
    </button>
  );
}

type Step = { done: boolean; label: string; act: () => void; cta?: string };

/** Required steps gate dates (the server checks the same: verified email, a chosen face, discovery on).
 *  Optional steps only make the agent a better representative. */
export function Readiness() {
  const { user, memories, go, openSetup, perform } = useStore();
  const shareable = memories.filter((m) => m.status === "approved" && m.visibility === "shareable").length;
  const face = (user?.face ?? {}) as { kind?: string; auto?: boolean };
  const required: Step[] = [
    {
      done: !!user?.email_verified,
      label: "Verify your email",
      cta: "Resend link",
      act: () => perform(async () => void (await api("/auth/resend-verification", "POST")), "Verification link sent."),
    },
    {
      done: !!face.kind && !face.auto, // the automatic placeholder doesn't count
      label: "Give your twin a face: a photo or an illustration",
      act: () => go("agent", "face"),
    },
  ];
  // discovery switches on by itself once they're ready; only ask if they turned it off
  if (user?.email_verified && face.kind && !face.auto && !user?.discovery)
    required.push({ done: false, label: "Turn on discovery so other twins can meet yours", act: () => go("settings") });
  const optional: Step[] = [
    { done: (user?.about_complete ?? 0) >= 60, label: `Complete your profile (${user?.about_complete ?? 0}%)`, act: () => openSetup(0) },
    { done: shareable >= 3, label: `Mark 3 things your twin may share on dates (${Math.min(shareable, 3)}/3)`, act: () => go("agent") },
  ];
  if ([...required, ...optional].every((s) => s.done)) return null;
  const ready = required.every((s) => s.done);
  const list = (steps: Step[]) => (
    <ul>
      {steps.map((s) => (
        <li key={s.label} className={s.done ? "done" : ""}>
          <span className="tick">{s.done && <Check size={12} />}</span>
          <span>{s.label}</span>
          {!s.done && (
            <button className="link" onClick={s.act}>
              {s.cta ?? "Do it"} <ChevronRight size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="glass card ready-card">
      <h3>
        <Sparkles size={16} /> {ready ? "Your twin can go on dates" : "Get your twin ready"}
      </h3>
      <p className="ready-group">
        <span className="ready-tag req">Required</span> {ready ? "All done." : "Needed before your twin can go on dates."}
      </p>
      {list(required)}
      <p className="ready-group">
        <span className="ready-tag opt">Optional</span> Helps your twin represent you better.
      </p>
      {list(optional)}
    </div>
  );
}

type Essential = { done: boolean; label: string; cta: string; act: () => void };

/** The five things a twin needs before it can date for you. A countable list, not a score. */
export function useEssentials(): Essential[] {
  const { user, memories, go, openSetup, perform } = useStore();
  const face = (user?.face ?? {}) as { kind?: string; auto?: boolean };
  const known = memories.filter((m) => m.status === "approved").length;
  return [
    { done: !!user?.email_verified, label: "Email verified", cta: "Resend my link", act: () => perform(async () => void (await api("/auth/resend-verification", "POST")), "Verification link sent.") },
    { done: !!face.kind && !face.auto, label: "A face for your twin", cta: "Choose a face", act: () => go("agent", "face") },
    { done: (user?.about_complete ?? 0) >= 60, label: "Starter questions answered", cta: "Answer the starter questions", act: () => openSetup(0) },
    { done: known >= 3, label: `3 things your twin knows (${Math.min(known, 3)}/3)`, cta: "Answer a quick question", act: () => go("agent") },
    { done: !!user?.discovery, label: "Discovery switched on", cta: "Review discovery", act: () => go("settings") },
  ];
}

export function Essentials({ compact = false }: { compact?: boolean }) {
  const list = useEssentials();
  const have = list.filter((e) => e.done).length;
  return (
    <div className={"essentials" + (compact ? " compact" : "")}>
      <p className="essentials-head">
        <strong>Your twin has {have} of {list.length} essentials</strong>
        <span className="essentials-dots" aria-hidden="true">{list.map((e, i) => <i key={i} className={e.done ? "on" : ""} />)}</span>
      </p>
      {!compact && (
        <ul>
          {list.map((e) => (
            <li key={e.label} className={e.done ? "done" : ""}>
              <span className="tick">{e.done && <Check size={12} />}</span>
              <span>{e.label}</span>
              {!e.done && <button className="link" onClick={e.act}>{e.cta} <ChevronRight size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Home() {
  const { user, scenes, go, candidates } = useStore();
  const nextStep = useEssentials().find((e) => !e.done);
  const d = useIslandActivity();
  const [island, setIsland] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState("agent"); // phone / tablet bottom-sheet tab
  const [folded, setFolded] = useState(false);
  const [theatre, setTheatre] = useState(false);
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
    <div ref={sheet} className={"home tab-" + tab + (folded ? " folded" : "") + (theatre ? " theatre" : "")}>
      <SheetTabs
        tab={tab}
        onTab={openTab}
        collapsed={folded}
        onToggle={() => setFolded((f) => !f)}
        tabs={[
          ["agent", "Your twin"],
          ["islands", "Islands"],
          ["live", <>Live{d ? <em className="count">{d.active}</em> : null}</>],
        ]}
      />
      <SceneControls theatre={theatre} onTheatre={setTheatre} onReset={() => (setSel(null), setIsland(null))} />
      <div className="home-left">
        <div className="glass card agent-card">
          <div className="agent-top">
            <Wisp hue={user!.hue} size={64} self face={user!.face} seed={user!.id} />
            <div>
              <span className="eyebrow">{greeting()}, {user!.name}</span>
              <h2>Your twin</h2>
              <p className="status">
                <span className={"live" + (active.length ? " on" : "")} /> {status}
              </p>
            </div>
          </div>
          <Essentials compact />
          <div className="agent-actions">
            {nextStep ? (
              <>
                <button className="btn primary" onClick={nextStep.act}>
                  <Sparkles size={16} /> {nextStep.cta}
                </button>
                <button className="link" onClick={() => go("agent")}>
                  <Brain size={14} /> About your twin
                </button>
              </>
            ) : (
              <>
                <ExploreButton />
                <button className="link" onClick={() => go("agent")}>
                  <Brain size={14} /> About your twin
                </button>
              </>
            )}
          </div>
        </div>
        {invites.length > 0 && (
          <div className="glass card inbox-card">
            <h3>💌 {invites.length === 1 ? "An invitation for you" : `${invites.length} invitations for you`}</h3>
            {invites.map((s) => (
              <button key={s.id} className="feed-item" onClick={() => go("dates", s.id)}>
                <Wisp hue={s.partner.hue} size={36} face={s.partner.face} seed={s.partner.id} gender={s.partner.gender} />
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
                  <Wisp hue={s.partner.hue} size={30} face={s.partner.face} seed={s.partner.id} gender={s.partner.gender} />
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
