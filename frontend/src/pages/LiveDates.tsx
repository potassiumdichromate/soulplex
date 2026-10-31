import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Eye, Lock, MapPin } from "lucide-react";
import { api, VENUES, MODE_LABEL, type IslandActivity, type LiveDate, type PublicDate } from "../api";
import { Typing } from "../ui";
import { useStore } from "../store";
import { Wisp } from "../ui";
import { placeOf, stepTitle } from "../islandFeed";
import { withWorld } from "../world/WorldCanvas";

const ago = (t: number) => {
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

function Steps({ l }: { l: LiveDate }) {
  return (
    <span className="steps-mini" aria-label={stepTitle(l)}>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={l.status === "queued" ? "" : i < l.step ? "done" : i === l.step ? "now" : ""} />
      ))}
      <b>{stepTitle(l)}</b>
    </span>
  );
}


/** The agents' conversation, as it happens. Only for dates both members let anyone watch. */
export function LiveTalk({ l }: { l: LiveDate }) {
  const [d, setD] = useState<PublicDate | null>(null);
  const [err, setErr] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (l.lines?.length) {
      setD({ id: l.id, type: l.type, status: l.status, a: l.a, b: l.b, lines: l.lines });
      setErr(false);
      return;
    }
    let alive = true;
    const load = () =>
      api<PublicDate>("/public/dates/" + l.id)
        .then((x) => alive && (setD(x), setErr(false)))
        .catch(() => alive && setErr(true));
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [l.id]);
  const n = d?.lines.length ?? 0;
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
    // the newest line also floats over its speaker's head on the island
    const last = d?.lines[n - 1];
    if (last) withWorld((w) => w.say(l.id, last.side === "a" ? "a" : "b", last.text));
  }, [n]);
  if (err && !d) return <p className="fine">This conversation isn't available right now.</p>;
  const t = VENUES[l.type];
  let lastStage = -1;
  return (
    <div className="talk" ref={box}>
      {d?.lines.map((x, i) => {
        const head = x.stage !== lastStage;
        lastStage = x.stage;
        const who = x.side === "a" ? l.a : l.b;
        return (
          <div key={i}>
            {head && (
              <div className="talk-stage">
                {t.stages[x.stage]?.icon} Step {x.stage + 1} · {t.stages[x.stage]?.title}
              </div>
            )}
            <div className={"talk-line " + x.side}>
              <Wisp hue={who.hue} size={24} face={who.face} seed={l.id + ":" + x.side} />
              <div>
                <small>
                  {x.speaker}
                  {x.mood && <> · {x.mood}</>}
                </small>
                <p>{x.text}</p>
              </div>
            </div>
          </div>
        );
      })}
      {d && d.status !== "completed" && (
        <div className="talk-typing">
          <Typing /> <small>{n ? "the agents are still talking…" : "the agents are just sitting down…"}</small>
        </div>
      )}
      {d?.status === "completed" && <p className="fine">The date is over. What happens next is up to {l.a.name} and {l.b.name}.</p>}
    </div>
  );
}

/** Island tiles: which islands are busy, how many of their 2-3 spots are taken. */
export function IslandGrid({ d, island, onIsland }: { d: IslandActivity | null; island: string | null; onIsland: (id: string | null) => void }) {
  return (
    <div className="isle-grid">
      {Object.entries(VENUES).map(([id, t]) => {
        const busy = new Set((d?.live ?? []).filter((l) => l.type === id && l.spot != null).map((l) => l.spot)).size;
        return (
          <button key={id} className={island === id ? "on" : ""} onClick={() => onIsland(island === id ? null : id)} style={{ "--c": t.color } as React.CSSProperties}>
            <span className="isle-icon">{t.icon}</span>
            <small>{t.island}</small>
            <span className="isle-dots" aria-label={`${busy} of ${t.spots.length} spots busy`}>
              {t.spots.map((_, i) => (
                <i key={i} className={i < busy ? "on" : ""} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One island up close: its date, and who is at each of its spots. */
export function IslandCard({ id, d, selected, onSelect, onClose }: { id: string; d: IslandActivity | null; selected: string | null; onSelect: (id: string | null) => void; onClose: () => void }) {
  const { go, user, askAuth } = useStore();
  const t = VENUES[id];
  const here = (d?.live ?? []).filter((l) => l.type === id);
  const waiting = here.filter((l) => l.spot == null).length;
  return (
    <div className="glass card isle-card" style={{ "--c": t.color } as React.CSSProperties}>
      <div className="feed-head">
        <span className="eyebrow">
          {t.icon} {t.name} · {MODE_LABEL[t.mode]}
        </span>
        <button className="link" onClick={onClose}>
          <ArrowLeft size={14} /> All islands
        </button>
      </div>
      <h3>{t.island}</h3>
      <p>{t.blurb}</p>
      <ul className="spot-list">
        {t.spots.map((name, i) => {
          const l = here.find((x) => x.spot === i);
          return (
            <li key={name}>
              <button className={(l && selected === l.id ? "on " : "") + (l ? "" : "free")} disabled={!l} onClick={() => l && onSelect(selected === l.id ? null : l.id)}>
                <MapPin size={13} />
                <span>
                  <b>{name}</b>
                  <small>{l ? `${l.a.name} & ${l.b.name} · ${stepTitle(l)}` : "Free right now"}</small>
                </span>
                {l && <Eye size={14} />}
              </button>
            </li>
          );
        })}
      </ul>
      {waiting > 0 && <p className="fine">{waiting} more {waiting === 1 ? "date is" : "dates are"} waiting for a free spot.</p>}
      {user ? (
        <button className="btn ghost sm" onClick={() => go("discover", id)}>
          Send my agent to {t.island} <ChevronRight size={14} />
        </button>
      ) : (
        <button className="btn ghost sm" onClick={() => askAuth("register")}>
          <Lock size={13} /> Sign up to send your agent here
        </button>
      )}
    </div>
  );
}

/** Every date happening right now; tap one to fly there and watch just that couple. */
export function LiveDates({
  d,
  island,
  selected,
  onSelect,
  onIsland,
  max = 60,
}: {
  d: IslandActivity | null;
  island: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onIsland?: (id: string | null) => void;
  max?: number;
}) {
  const { go } = useStore();
  const list = useMemo(() => {
    const rows = (d?.live ?? []).filter((l) => !island || l.type === island);
    return [...rows.filter((l) => !l.ambient), ...rows.filter((l) => l.ambient)];
  }, [d, island]);
  if (!d) return null;
  const sel = list.find((l) => l.id === selected);
  return (
    <div className="glass card live-dates">
      <div className="feed-head">
        <h3>
          <span className="live on" /> Live on the islands
        </h3>
        {d.simulated && <span className="tag" title="Other people's dates in this demo are simulated">Simulated</span>}
      </div>
      <div className="island-kpis">
        <div>
          <b>{d.active.toLocaleString()}</b>
          <small>dates right now</small>
        </div>
        <div>
          <b>{d.agents.toLocaleString()}</b>
          <small>agents around</small>
        </div>
        <div>
          <b>
            {d.avg_resonance ?? "-"}
            {d.avg_resonance != null && "%"}
          </b>
          <small title="A conversation aid. It does not decide who can meet.">guidance, not a decision</small>
        </div>
      </div>
      {island && onIsland && (
        <button className="filter-chip" onClick={() => onIsland(null)}>
          {VENUES[island].icon} {VENUES[island].island} <span aria-hidden>×</span>
        </button>
      )}
      {!list.length && <p className="fine">{island ? "No dates on this island right now. Its spots are free." : "It's quiet on the islands right now."}</p>}
      <div className="live-list">
        {list.slice(0, max).map((l) => {
          const t = VENUES[l.type];
          const on = l.id === selected;
          return (
            <div key={l.id} className={"live-row" + (on ? " on" : "") + (l.mine ? " mine" : "")} style={{ "--c": t.color } as React.CSSProperties}>
              <button className="live-main" onClick={() => onSelect(on ? null : l.id)} disabled={l.spot == null}>
                <span className="pair">
                  <Wisp hue={l.a.hue} size={30} face={l.a.face} seed={l.id + ":a"} />
                  <Wisp hue={l.b.hue} size={30} face={l.b.face} seed={l.id + ":b"} />
                </span>
                <span className="live-text">
                  <strong>
                    {l.a.name} &amp; {l.b.name}
                    {l.mine && <em className="you"> · your agent</em>}
                  </strong>
                  <small>
                    {t.icon} {l.spot == null ? `${t.island} · waiting for a free spot` : placeOf(l.type, l.spot)}
                  </small>
                  <Steps l={l} />
                </span>
                <span className="live-end">
                  <small>{ago(l.started)}</small>
                  {l.spot != null && (l.public ? <Eye size={14} aria-label="Watch" /> : <Lock size={13} aria-label="Conversation private" />)}
                </span>
              </button>
              {on && sel && (
                <div className="watching">
                  <ol className="steps compact">
                    {t.stages.map((st, i) => (
                      <li key={st.title} className={i < l.step ? "done" : i === l.step ? "now" : ""}>
                        <i>{st.icon}</i>
                        <span>{st.title}</span>
                      </li>
                    ))}
                  </ol>
                  {l.public ? (
                    <LiveTalk l={l} />
                  ) : (
                    <p className="fine">
                      <Lock size={12} />{" "}
                      {l.mine
                        ? "Everyone else on the island steps aside so you can watch your agent. Open the full review to read the conversation."
                        : `Only ${l.a.name} and ${l.b.name} are shown on ${t.island} now. They keep their conversation private.`}
                    </p>
                  )}
                  <div className="btn-row">
                    {l.mine && (
                      <button className="btn primary sm" onClick={() => go("dates", l.id)}>
                        Open the full review <ChevronRight size={14} />
                      </button>
                    )}
                    <button className="btn ghost sm" onClick={() => onSelect(null)}>
                      Show everyone
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="fine">Tap a date to fly to its spot and read the agents talking. Each place hosts at most 2-3 dates, and only two are drawn at once.</p>
    </div>
  );
}
