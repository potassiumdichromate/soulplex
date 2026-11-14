import { useEffect } from "react";
import { Lightbulb, Eye, Sparkles, Compass, TrendingUp, Plus, Heart, ShieldCheck } from "lucide-react";
import { CATEGORIES, DIM_LABEL, VENUES } from "../api";
import { useStore } from "../store";
import { Panel, Head } from "./Shell";
import { Radar, Meter, Wisp, Empty } from "../ui";
import { ExploreButton } from "./Home";

export function Insights() {
  const { insights: d, go, load } = useStore();
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  if (!d) return <Panel wide><p className="fine">Loading…</p></Panel>;
  const hasDates = d.dates.length > 0;
  return (
    <Panel wide>
      <Head eyebrow="Insights" title={<>What your twin is <em>learning.</em></>} />

      <div className="kpis">
        <div className="glass kpi">
          <span className="big">{d.traits.approved}</span>
          <div>
            <strong>Things your twin knows</strong>
            <small>{d.traits.shareable} you allow it to share · <button className="link" onClick={() => go("agent")}>review or correct</button></small>
          </div>
        </div>
        <div className="glass kpi">
          <span className="big">{d.average ?? "-"}{d.average != null && <small>%</small>}</span>
          <div>
            <strong>Average connection</strong>
            <small>across {d.dates.length} date{d.dates.length === 1 ? "" : "s"}</small>
          </div>
        </div>
        <div className="glass kpi">
          <span className="big">{d.funnel.mutual}</span>
          <div>
            <strong>Mutual introductions</strong>
            <small>{d.funnel.accepted} you wanted to meet</small>
          </div>
        </div>
      </div>

      {!hasDates ? (
        <Empty icon={<TrendingUp />} title="Insights start after your twin's first date">
          <p>After each date you'll see where you may connect, what your twin learned about the other person, and one gentle thing to try.</p>
          <p className="fine"><span className="demo-badge">Illustrative</span> “You both mentioned slow Sundays and family time.”</p>
          <p className="fine">Spotted something your twin got wrong? You can correct or forget anything it knows.</p>
          <div className="btn-row">
            <ExploreButton />
            <button className="btn ghost" onClick={() => go("agent")}>Review what my twin knows</button>
          </div>
        </Empty>
      ) : (
        <div className="ins-grid">
          <section className="glass card">
            <h3>
              <TrendingUp size={16} /> Where you may connect
            </h3>
            <Radar values={d.dimensions} />
            {d.strengths.length > 0 && (
              <p className="fine center">
                Strongest on <b>{d.strengths.map((x) => DIM_LABEL[x]).join(" & ")}</b>
                {d.best_venue && (
                  <>
                    {" "}· best dates at <b>{VENUES[d.best_venue].name}</b>
                  </>
                )}
              </p>
            )}
          </section>

          <section className="glass card">
            <h3>
              <Lightbulb size={16} /> How to show up better
            </h3>
            <ol className="tips">
              {d.growth.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ol>
            <button className="btn ghost sm" onClick={() => go("agent")}>
              <Plus size={14} /> Teach my agent
            </button>
          </section>

          <section className="glass card">
            <h3>
              <Eye size={16} /> What your agent discovered about others
            </h3>
            <ul className="learned-list">
              {d.learned.map((l, i) => (
                <li key={i}>
                  <b>{l.partner}</b> {l.text}
                </li>
              ))}
            </ul>
          </section>

          <section className="glass card">
            <h3>
              <Sparkles size={16} /> Themes you keep sharing
            </h3>
            <div className="chips">
              {d.shared_themes.length ? (
                d.shared_themes.map(([t, n]) => (
                  <span key={t} className="chip">
                    {t} <b>×{n}</b>
                  </span>
                ))
              ) : (
                <p className="fine">No shared themes yet. Try adding interests and values.</p>
              )}
            </div>
            {d.explore.length > 0 && (
              <>
                <h4>
                  <Compass size={14} /> Often worth exploring
                </h4>
                <ul className="small-list">
                  {d.explore.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="glass card span2">
            <h3>
              <Heart size={16} /> Every date, at a glance
            </h3>
            <div className="timeline">
              {[...d.dates].reverse().map((x) => (
                <button key={x.id} className="tl" onClick={() => go("dates", x.id)} title={`${x.partner}: ${x.score}%`}>
                  <span className="bar" style={{ height: x.score + "%", "--h": x.hue } as React.CSSProperties}>
                    <b>{x.score}</b>
                  </span>
                  <Wisp hue={x.hue} size={28} face={x.face} seed={x.partner_id ?? x.partner} />
                  <small>{x.partner}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <section className="glass card coverage-card">
        <h3>
          <ShieldCheck size={16} /> How completely your agent can represent you
        </h3>
        <div className="cov-bars">
          {CATEGORIES.map((c) => {
            const n = d.coverage[c.id] ?? 0;
            return (
              <label key={c.id}>
                <span>
                  {c.icon} {c.label}
                </span>
                <Meter value={Math.min(100, n * 34)} tone={n ? "mint" : "gold"} />
                <b>{n || "add"}</b>
              </label>
            );
          })}
        </div>
        {d.feedback.responses > 0 && (
          <p className="fine">
            After real meetings, {d.feedback.represented_accurately} of {d.feedback.responses} said your agent
            represented you accurately.
          </p>
        )}
      </section>
    </Panel>
  );
}
