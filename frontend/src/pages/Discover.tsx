import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { vitals, PROMPTS, FIELDS, label, heightLabel } from "../about";
import { Coffee, Sparkles, Compass, X, UserRound, Search, SlidersHorizontal } from "lucide-react";
import { api, VENUES, type Candidate } from "../api";
import { useStore } from "../store";
import { Panel, Head } from "./Shell";
import { Wisp, Empty } from "../ui";
import { ExploreButton, Readiness } from "./Home";

export function ProfileSheet({ c, onClose }: { c: Candidate; onClose: () => void }) {
  const a = c.about ?? {};
  const rows: [string, string][] = [];
  const add = (k: string, v?: string) => v && rows.push([FIELDS[k].icon + " " + FIELDS[k].label, label(k, v)]);
  if (a.height_cm) rows.push(["📏 Height", heightLabel(a.height_cm)]);
  if (a.job) rows.push(["💼 Work", a.job.replace(/^an? /i, "")]);
  if (a.hometown) rows.push(["🏡 Hometown", a.hometown]);
  add("education", a.education);
  if (a.languages?.length) rows.push(["🗣️ Languages", a.languages.join(", ")]);
  for (const k of ["timeline", "family_plans", "marital", "relocate", "diet", "drinking", "smoking", "exercise", "sleep", "pets", "religion"] as const) add(k, a[k] as string);
  if (a.love_languages?.length) rows.push(["💞 Feels loved through", a.love_languages.map((x) => label("love_languages", x)).join(" & ")]);
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="glass sheet profile-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={c.name + "'s profile"}>
        <button className="icon-btn close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="ps-head" style={{ "--h": c.hue } as React.CSSProperties}>
          <Wisp hue={c.hue} size={110} name={c.name} face={c.face} seed={c.id} gender={c.gender} />
          <h2>
            {c.name}, {c.age}
          </h2>
          <span>
            {c.city} · looking for {c.intent}
          </span>
          {(c.face as any)?.locked && <small className="locked-note">🔒 Real photo shown after a mutual match</small>}
        </div>
        {(a.prompts ?? []).map((p) => (
          <div key={p.id} className="prompt-card">
            <small>{PROMPTS[p.id]}</small>
            <p>{p.answer}</p>
          </div>
        ))}
        {rows.length > 0 && (
          <dl className="ps-vitals">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {c.preview.length > 0 && (
          <>
            <h4>In their own words</h4>
            <ul className="quotes">
              {c.preview.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Card({ c, initialVenue }: { c: Candidate; initialVenue: string }) {
  const { perform, busy, go, loadScenes, scenes } = useStore();
  const [venue, setVenue] = useState(initialVenue || "auto");
  const [open, setOpen] = useState(false);
  const v = vitals(c.about).slice(0, 5);
  const prompt = c.about?.prompts?.[0];
  const last = scenes.find((s) => s.partner.id === c.id && s.status !== "failed" && !s.stale);
  return (
    <article className="person glass">
      <div className="person-top" style={{ "--h": c.hue } as React.CSSProperties}>
        <Wisp hue={c.hue} size={76} name={c.name} face={c.face} seed={c.id} gender={c.gender} />
        <div>
          <h3>
            {c.name}, {c.age}
          </h3>
          <span>
            {c.city} · {c.intent}
          </span>
          <small className="traits-n">{c.traits} things their agent knows</small>
          {(c.face as any)?.locked && <small className="locked-note">🔒 Photo after a mutual match</small>}
        </div>
      </div>
      {c.outside && (
        <div className="outside-why">
          {c.outside.map((r) => (
            <span key={r}>⚠️ {r}</span>
          ))}
        </div>
      )}
      {c.common.length > 0 && (
        <div className="common">
          <Sparkles size={13} />
          {c.common.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
      )}
      {v.length > 0 && (
        <div className="vitals">
          {v.map((x) => (
            <span key={x.text}>
              {x.icon} {x.text}
            </span>
          ))}
        </div>
      )}
      {prompt ? (
        <div className="prompt-card small">
          <small>{PROMPTS[prompt.id]}</small>
          <p>{prompt.answer}</p>
        </div>
      ) : (
        <ul className="quotes">
          {c.preview.slice(0, 1).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <button className="link view-profile" onClick={() => setOpen(true)}>
        <UserRound size={13} /> View full profile
      </button>
      {open && <ProfileSheet c={c} onClose={() => setOpen(false)} />}
      <div className="person-foot">
        <label className="type-pick">
          <span className="sr">Kind of date</span>
          <select value={venue} onChange={(e) => setVenue(e.target.value)} aria-label={"Kind of date with " + c.name}>
            <option value="auto">✨ Agents pick</option>
            {Object.entries(VENUES).map(([id, v]) => (
              <option key={id} value={id}>
                {v.icon} {v.name}
              </option>
            ))}
          </select>
        </label>
        {last ? (
          <button className="btn ghost sm" onClick={() => go("dates", last.id)}>
            {last.status === "completed" ? "View date" : "On a date…"}
          </button>
        ) : (
          <button
            className="btn primary sm"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                const s = await api("/scenes", "POST", { partner_id: c.id, venue, waive: !!c.outside });
                await loadScenes();
                go("dates", s.id);
              })
            }
          >
            <Coffee size={14} /> {c.outside ? "Meet anyway" : "Send on a date"}
          </button>
        )}
      </div>
    </article>
  );
}

type Results = { matches: Candidate[]; outside: Candidate[]; hidden: number; blocked: boolean; reason: string };
const FILTERS: { key: string; label: string; options: [string, string][] }[] = [
  { key: "intent", label: "Looking for", options: [["", "Any"], ["marriage", "Marriage"], ["relationship", "Relationship"], ["dating", "Dating"]] },
  { key: "diet", label: "Food", options: [["", "Any"], ["veg", "Vegetarian"]] },
  { key: "family_plans", label: "Kids", options: [["", "Any"], ["want", "Wants children"], ["open", "Open to children"]] },
  {
    key: "religion",
    label: "Faith",
    options: [["", "Any"], ["hindu", "Hindu"], ["muslim", "Muslim"], ["christian", "Christian"], ["sikh", "Sikh"], ["jain", "Jain"]],
  },
];

export function Discover() {
  const { user, arg, scenes } = useStore();
  const [q, setQ] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const [ages, setAges] = useState<[number, number]>([18, 70]);
  const [res, setRes] = useState<Results | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q, age_min: String(ages[0]), age_max: String(ages[1]), ...f });
      api<Results>("/search?" + params.toString())
        .then(setRes)
        .catch(() => setRes({ matches: [], outside: [], hidden: 0, blocked: false, reason: "" }));
    }, 250);
    return () => clearTimeout(t);
  }, [q, f, ages, scenes.length, user?.memory_version]);

  const active = Object.values(f).filter(Boolean).length + (ages[0] > 18 || ages[1] < 70 ? 1 : 0);
  return (
    <Panel wide>
      <Head eyebrow={"Agents near you · " + user!.city} title={<>Who should your agent <em>meet?</em></>}>
        {(res?.matches.length ?? 0) > 0 && <ExploreButton />}
      </Head>

      <div className="searchbar">
        <Search size={18} />
        <input
          id="discover-q"
          placeholder="Search by name, job, interests or prompts…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={"btn ghost sm" + (active ? " on" : "")} onClick={() => setShowFilters(!showFilters)}>
          <SlidersHorizontal size={14} /> Filters{active ? ` · ${active}` : ""}
        </button>
      </div>
      {showFilters && (
        <div className="filters">
          {FILTERS.map((x) => (
            <div key={x.key} className="filter-row">
              <span>{x.label}</span>
              <div className="w-chips">
                {x.options.map(([v, l]) => (
                  <button key={v} className={(f[x.key] ?? "") === v ? "on" : ""} onClick={() => setF({ ...f, [x.key]: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="filter-row">
            <span>
              Age {ages[0]}–{ages[1]}
            </span>
            <div className="dual">
              <input type="range" className="range" min={18} max={70} value={ages[0]} onChange={(e) => setAges([Math.min(+e.target.value, ages[1]), ages[1]])} />
              <input type="range" className="range" min={18} max={70} value={ages[1]} onChange={(e) => setAges([ages[0], Math.max(+e.target.value, ages[0])])} />
            </div>
          </div>
          {active > 0 && (
            <button
              className="link"
              onClick={() => {
                setF({});
                setAges([18, 70]);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {!res ? (
        <p className="fine">Searching the island…</p>
      ) : res.blocked ? (
        <>
          <Readiness />
          <Empty icon={<Compass />} title="Discovery is closed for now">
            <p>{res.reason}</p>
          </Empty>
        </>
      ) : (
        <>
          <section className="d-section">
            <h4>
              Your matches <b>{res.matches.length}</b>
              <small>Fit both ways. Your agent can meet them now.</small>
            </h4>
            {res.matches.length ? (
              <div className="people">
                {res.matches.map((c) => (
                  <Card key={c.id} c={c} initialVenue={arg} />
                ))}
              </div>
            ) : (
              <p className="fine">
                {q || active ? "No matches for this search." : "No one fits both ways right now."}{" "}
                {res.outside.length > 0 && "Some people below are close. They'd be happy to meet you, but they're outside your own filters."}
              </p>
            )}
          </section>
          {res.outside.length > 0 && (
            <section className="d-section">
              <h4>
                Outside your preferences <b>{res.outside.length}</b>
                <small>Their preferences include you; your age range or must-haves don't include them. "Meet anyway" relaxes yours for one introduction.</small>
              </h4>
              <div className="people">
                {res.outside.map((c) => (
                  <Card key={c.id} c={c} initialVenue={arg} />
                ))}
              </div>
            </section>
          )}
          {!res.matches.length && !res.outside.length && (
            <Empty icon={<Compass />} title={q || active ? "Nothing found" : "The island is quiet for now"}>
              <p>
                {res.hidden > 0
                  ? `${res.hidden} ${res.hidden === 1 ? "person" : "people"} in ${user!.city} ${res.hidden === 1 ? "is" : "are"} here, but their own preferences don't include you yet (age range, intentions or must-haves). We never show people who haven't chosen to be seen by you.`
                  : "We're still growing the community here."}{" "}
                Meanwhile, invitations from other agents arrive in Dates.
              </p>
            </Empty>
          )}
        </>
      )}
    </Panel>
  );
}
