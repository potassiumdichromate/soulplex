import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  FastForward,
  Sparkles,
  Heart,
  RefreshCw,
  Flag,
  Ban,
  Video,
  Coffee,
  Check,
  Lightbulb,
  Eye,
  Compass,
  PartyPopper,
  UserRound,
  Search,
} from "lucide-react";
import { api, VENUES, DIM_LABEL, MODE_LABEL, type Experience } from "../api";
import { useStore } from "../store";
import { Panel, Head } from "./Shell";
import { Wisp, Ring, Meter, Empty, Typing, timeAgo } from "../ui";
import { ExploreButton } from "./Home";
import { withWorld } from "../world/WorldCanvas";
import { useIslandActivity, placeOf } from "../islandFeed";
import { LiveDates } from "./LiveDates";
import { ProfileSheet } from "./Discover";
import { vitals, PROMPTS } from "../about";
import { faceUrl, headUrl, bodyColors } from "../faces";

const replayed = new Set<string>();

const MOOD_ICON: Record<string, string> = {
  relaxed: "😌", "warming up": "🙂", "opening up": "💗", hopeful: "✨", curious: "🧐", playful: "😄", thoughtful: "🤔",
  content: "😊", animated: "🤩", engaged: "🎓", warm: "🥰", cheerful: "😀", surprised: "😮", connected: "🤝",
  excited: "🤗", focused: "🧑‍🍳", laughing: "😂", proud: "😎", nostalgic: "🥲", sweet: "🍨", intrigued: "👀",
  spirited: "😤", moved: "🥹", calm: "🌅", dreamy: "💭", tender: "🫶", wonder: "🤩", reflective: "🌌",
  vulnerable: "🕯️", competitive: "🏆", "good-humoured": "😅", cheeky: "😏",
};

const STATUS_TABS: [string, string][] = [
  ["", "All"],
  ["invited", "Invitations"],
  ["running", "Live now"],
  ["waiting", "Your turn"],
  ["mutual", "Mutual"],
  ["completed", "Finished"],
];

type Page = { items: Experience[]; total: number; offset: number; limit: number };

function stageNow(s: Experience) {
  if (s.status === "queued") return { label: "On the way", idx: -1 };
  if (s.status === "running") {
    const idx = Math.floor(((Date.now() / 1000 - s.created) / 2) % 4);
    return { label: "Step " + (idx + 1) + " of 4 · " + VENUES[s.venue]?.stages[idx]?.title, idx };
  }
  if (s.status === "completed") return { label: "All 4 steps done", idx: 4 };
  return { label: "", idx: -1 };
}

function DateRow({ s }: { s: Experience }) {
  const { user, go } = useStore();
  const t = VENUES[s.venue];
  const a = s.output?.assessment;
  const st = stageNow(s);
  return (
    <button className="drow" onClick={() => go("dates", s.id)}>
      <span className="pair">
        <Wisp hue={user!.hue} size={36} self face={user!.face} seed={user!.id} />
        <Wisp hue={s.partner.hue} size={36} face={s.partner.face} seed={s.partner.id} />
      </span>
      <span className="drow-main">
        <strong>
          {s.partner.name}
          {s.incoming && <em className="from"> · invited you</em>}
        </strong>
        <small>
          <span className="type-chip">
            {t?.icon} {t?.name}
          </span>{" "}
          · 📍 {placeOf(s.venue, s.spot)} · {timeAgo(s.created)}
        </small>
        {(s.status === "running" || s.status === "queued" || s.status === "completed") && !s.stale && (
          <span className="steps-mini" aria-label={st.label}>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={i < st.idx || st.idx === 4 ? "done" : i === st.idx ? "now" : ""} />
            ))}
            <b>{st.label}</b>
          </span>
        )}
      </span>
      <span className="drow-end">
        {s.status === "invited" ? (
          <span className="tag love">{s.incoming ? "Respond" : "Awaiting"}</span>
        ) : s.status === "declined" ? (
          <span className="tag">Declined</span>
        ) : s.status === "queued" || s.status === "running" ? (
          <span className="tag live-tag">
            <span className="live on" /> Live
          </span>
        ) : s.status === "failed" ? (
          <span className="tag warn">Didn't happen</span>
        ) : s.stale ? (
          <span className="tag">Outdated</span>
        ) : s.mutual ? (
          <span className="tag love">
            <Heart size={12} /> Mutual
          </span>
        ) : a ? (
          <span className="score big">{a.score}%</span>
        ) : null}
        {s.status === "completed" && !s.stale && !s.mutual && s.mine.decision === "pending" && <small className="your-turn-dot">Your turn</small>}
      </span>
    </button>
  );
}

/** Live dates across all islands; tapping one flies the camera there, beside the panel. */
function LiveIslands() {
  const d = useIslandActivity();
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    withWorld((w) => {
      if (sel) {
        w.setMode("date");
        if (w.focusCouple(sel, 2.4)) return;
      }
      w.focusCouple(null);
      w.setMode("calm");
    });
  }, [sel]);
  useEffect(() => () => withWorld((w) => w.focusCouple(null)), []);
  useEffect(() => {
    if (sel && d && !d.live.some((l) => l.id === sel)) setSel(null);
  }, [d, sel]);
  return <LiveDates d={d} island={null} selected={sel} onSelect={setSel} />;
}

function DateList() {
  const { scenes } = useStore();
  const [view, setView] = useState<"mine" | "live">("mine");
  const island = useIslandActivity();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("new");
  const [q, setQ] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [items, setItems] = useState<Experience[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE = 20;

  const fetchPage = (offset: number) =>
    api<Page>("/dates?" + new URLSearchParams({ q, status, type, sort, offset: String(offset), limit: String(PAGE) }).toString());

  // first page: refresh when filters change or when any date changes state
  const signature = scenes.map((s) => s.id + s.status + s.mine.decision).join("|");
  useEffect(() => {
    const t = setTimeout(() => {
      fetchPage(0)
        .then((p) => {
          setPage(p);
          setItems(p.items);
        })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, status, type, sort, signature]);

  const counts = {
    live: scenes.filter((s) => s.status === "running" || s.status === "queued").length,
    turn: scenes.filter((s) => s.status === "completed" && !s.stale && !s.mutual && s.mine.decision === "pending").length,
    invites: scenes.filter((s) => s.incoming && s.status === "invited").length,
    mutual: scenes.filter((s) => s.mutual).length,
  };

  return (
    <Panel wide>
      <Head eyebrow="Agent dates" title={<>Where your agent <em>has been.</em></>}>
        <ExploreButton />
      </Head>
      <div className="seg dview">
        <button className={view === "mine" ? "on" : ""} onClick={() => setView("mine")}>
          My agent's dates
        </button>
        <button className={view === "live" ? "on" : ""} onClick={() => setView("live")}>
          <span className="live on" /> Live on the islands{island ? ` · ${island.active}` : ""}
        </button>
      </div>
      {view === "live" ? (
        <LiveIslands />
      ) : (
      <>
      <div className="dstats">
        <button className={status === "" ? "on" : ""} onClick={() => setStatus("")}>
          <b>{page?.total ?? "…"}</b>
          <span>{status || type || q ? "matching dates" : "dates in total"}</span>
        </button>
        <button className={status === "running" ? "on" : ""} onClick={() => setStatus("running")}>
          <b>{counts.live}</b>
          <span>live right now</span>
        </button>
        <button className={status === "waiting" ? "on" : ""} onClick={() => setStatus("waiting")}>
          <b>{counts.turn}</b>
          <span>waiting for your words</span>
        </button>
        <button className={status === "invited" ? "on" : ""} onClick={() => setStatus("invited")}>
          <b>{counts.invites}</b>
          <span>invitations</span>
        </button>
        <button className={status === "mutual" ? "on" : ""} onClick={() => setStatus("mutual")}>
          <b>{counts.mutual}</b>
          <span>mutual</span>
        </button>
      </div>

      <div className="dtools">
        <div className="searchbar">
          <Search size={17} />
          <input id="dates-q" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select id="dates-type" aria-label="Date type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All date types</option>
          {Object.entries(VENUES).map(([id, t]) => (
            <option key={id} value={id}>
              {t.icon} {t.name}
            </option>
          ))}
        </select>
        <select id="dates-sort" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="new">Newest first</option>
          <option value="score">Best resonance</option>
        </select>
      </div>
      <div className="tabs scroll">
        {STATUS_TABS.map(([k, l]) => (
          <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>
            {l}
          </button>
        ))}
      </div>

      {!page ? (
        <p className="fine">Loading dates…</p>
      ) : !items.length ? (
        <Empty icon={<Coffee />} title={status || type || q ? "No dates match" : "No dates yet"}>
          <p>{status || type || q ? "Try another filter." : "Send your agent out and it will come back with conversations to replay."}</p>
        </Empty>
      ) : (
        <>
          <div className="dlist">
            {items.map((s) => (
              <DateRow key={s.id} s={s} />
            ))}
          </div>
          <div className="dmore">
            <span className="fine">
              Showing {items.length} of {page.total}
            </span>
            {items.length < page.total && (
              <button
                className="btn ghost sm"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  try {
                    const p = await fetchPage(items.length);
                    setItems((x) => [...x, ...p.items]);
                    setPage(p);
                  } finally {
                    setLoadingMore(false);
                  }
                }}
              >
                Load {Math.min(PAGE, page.total - items.length)} more
              </button>
            )}
          </div>
        </>
      )}
      </>
      )}
    </Panel>
  );
}

function Process({ s, stage, lines }: { s: Experience; stage: number; lines: { speaker_id: string; mood?: string }[] }) {
  const { user } = useStore();
  const t = VENUES[s.venue];
  const last = (id: string) => [...lines].reverse().find((l) => l.speaker_id === id)?.mood;
  const state = (id: string) =>
    s.status === "queued"
      ? `🚶 Heading to ${placeOf(s.venue, s.spot)}`
      : s.status === "running"
        ? "💬 In conversation"
        : stage >= 4
          ? s.output.assessment
            ? `🏠 Back home · ${s.output.assessment.score}% resonance`
            : "🏠 Back home"
          : last(id)
            ? `${MOOD_ICON[last(id)!] ?? "🙂"} ${last(id)}`
            : t.mode === "walk"
              ? "🚶 Walking together"
              : t.mode === "stand"
                ? "🧍 Arriving"
                : "🪑 Taking a seat";
  return (
    <section className="process">
      <div className="process-type">
        <span className="pt-icon">{t.icon}</span>
        <div>
          <strong>{t.name}</strong>
          <small>
            📍 {placeOf(s.venue, s.spot)} · {MODE_LABEL[t.mode]} · {t.tag}
          </small>
        </div>
      </div>
      <ol className="steps">
        {t.stages.map((st, i) => (
          <li key={st.title} className={i < stage ? "done" : i === stage ? "now" : ""}>
            <i>{i < stage ? <Check size={12} /> : st.icon}</i>
            <span>{st.title}</span>
          </li>
        ))}
      </ol>
      <div className="agent-states">
        <div>
          <Wisp hue={user!.hue} size={30} self face={user!.face} seed={user!.id} />
          <span>
            <b>Your agent</b>
            <small>{state(user!.id)}</small>
          </span>
        </div>
        <div>
          <Wisp hue={s.partner.hue} size={30} face={s.partner.face} seed={s.partner.id} />
          <span>
            <b>{s.partner.name}'s agent</b>
            <small>{state(s.partner.id)}</small>
          </span>
        </div>
      </div>
    </section>
  );
}

function Resonance({ s }: { s: Experience }) {
  const a = s.output.assessment!;
  return (
    <section className="resonance reveal">
      <div className="res-top">
        <Ring value={a.score} size={132} label="resonance" sub={a.confidence + " confidence"} />
        <div>
          <h3>How your agents connected</h3>
          <p className="fine">
            Based only on what you both chose to share.{" "}
            {a.method !== "model" && "Scored with transparent keyword matching (demo). "}A conversation aid, not a
            verdict.
          </p>
          {a.shared.length > 0 && (
            <div className="chips">
              {a.shared.map((x) => (
                <span key={x} className="chip mint">
                  ✓ {x}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="dims">
        {a.dimensions.map((d, i) => (
          <div key={d.name} className={"dim" + (d.known ? "" : " unknown")} style={{ animationDelay: i * 90 + "ms" }}>
            <div className="dim-head">
              <span>{DIM_LABEL[d.name]}</span>
              <b>{d.known ? d.score + "%" : "-"}</b>
            </div>
            <Meter value={d.known ? d.score : 50} tone={d.known ? "grad" : "gold"} />
            <small>{d.note}</small>
          </div>
        ))}
      </div>
      {a.perspective && (
        <div className="learned">
          <div className="learn-card">
            <h4>
              <Eye size={15} /> What your agent learned about {s.partner.name}
            </h4>
            <ul>
              {a.perspective.learned_about_partner.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div className="learn-card">
            <h4>
              <Sparkles size={15} /> What it noticed about you
            </h4>
            <ul>
              {a.perspective.noticed_about_you.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div className="learn-card growth">
            <h4>
              <Lightbulb size={15} /> One thing to grow
            </h4>
            <p>{a.perspective.growth}</p>
          </div>
        </div>
      )}
      {a.explore.length > 0 && (
        <div className="explore">
          <h4>
            <Compass size={15} /> Worth talking about in person
          </h4>
          <ul>
            {a.explore.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="private-note">
        🔒 These reflections are private to you. {s.partner.name} sees their own agent's perspective.
      </p>
    </section>
  );
}

function YourTurn({ s }: { s: Experience }) {
  const { perform, busy, loadScenes, user, go } = useStore();
  const [words, setWords] = useState(s.mine.contribution);
  const [next, setNext] = useState(s.mine.next_step);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockAsk, setBlockAsk] = useState(false);
  const [report, setReport] = useState("");
  const fb = s.mine.feedback || {};
  const [met, setMet] = useState(Boolean(fb.met));
  const [accurate, setAccurate] = useState(Boolean(fb.represented_accurately));
  const [again, setAgain] = useState(fb.wants_second_date === true ? "yes" : fb.wants_second_date === false ? "no" : "unknown");
  const decide = (decision: string) =>
    perform(
      async () => {
        await api("/scenes/" + s.id + "/participation", "PUT", { reviewed: true, contribution: words, decision, next_step: next });
        await loadScenes();
      },
      decision === "accept"
        ? "Saved. Contacts unlock only if " + s.partner.name + " says yes too."
        : decision === "pass"
          ? "Got it. Your agent will remember what didn't fit."
          : "Your words are saved.",
    );
  return (
    <section className="your-turn">
      {s.mutual ? (
        <div className="mutual reveal">
          <PartyPopper size={28} />
          <h3>It's mutual! 💞</h3>
          <p>
            You and {s.partner.name} both want to meet. Next step: <b>{s.other.next_step === "public_cafe" ? "a public café" : "a short video call"}</b>.
          </p>
          <div className="contact">
            <span>{s.partner.name}'s contact</span>
            <strong>{s.contact}</strong>
          </div>
          <p className="fine">Arrange the meeting yourselves. Meet in public and tell a friend where you'll be.</p>
          <details className="feedback">
            <summary>After you meet: help your agent learn (private)</summary>
            <label className="check">
              <input type="checkbox" checked={met} onChange={(e) => setMet(e.target.checked)} /> We met
            </label>
            <label className="check">
              <input type="checkbox" checked={accurate} onChange={(e) => setAccurate(e.target.checked)} /> My agent represented me accurately
            </label>
            <label>
              Would you like another date?
              <select value={again} onChange={(e) => setAgain(e.target.value)}>
                <option value="unknown">Not sure / prefer not to say</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <button
              className="btn ghost sm"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  await api("/scenes/" + s.id + "/feedback", "POST", {
                    met,
                    represented_accurately: accurate,
                    wants_second_date: again === "unknown" ? null : again === "yes",
                  });
                  await loadScenes();
                }, "Private feedback saved. Your agent will use it to calibrate.")
              }
            >
              Save feedback
            </button>
          </details>
        </div>
      ) : (
        <>
          <h3>Your turn</h3>
          <p className="fine">{s.output.question}</p>
          <textarea
            aria-label="Your contribution"
            placeholder="Add something in your own words. It's shared only with them, never your contact."
            value={words}
            maxLength={800}
            onChange={(e) => setWords(e.target.value)}
          />
          {s.other.contribution && (
            <div className="their-words">
              <Wisp hue={s.partner.hue} size={22} face={s.partner.face} seed={s.partner.id} />
              <span>
                <b>{s.partner.name} wrote:</b> {s.other.contribution}
              </span>
            </div>
          )}
          <div className="next-step">
            <span>If it's mutual, I'd like:</span>
            <button className={next === "video" ? "on" : ""} onClick={() => setNext("video")}>
              <Video size={14} /> Video call
            </button>
            <button className={next === "public_cafe" ? "on" : ""} onClick={() => setNext("public_cafe")}>
              <Coffee size={14} /> Public café
            </button>
          </div>
          {!user!.contact && (
            <p className="warn-line">
              Add a private contact in{" "}
              <button className="link" onClick={() => go("settings")}>
                Settings
              </button>{" "}
              before you can accept.
            </p>
          )}
          <div className="decide">
            <button className="btn primary" disabled={busy || words.trim().length < 5} onClick={() => decide("accept")}>
              <Heart size={16} /> I'd like to meet
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => decide("pending")}>
              Save words
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => decide("pass")}>
              Not for me
            </button>
          </div>
          {s.mine.decision !== "pending" && (
            <p className="fine">
              You chose <b>{s.mine.decision === "accept" ? "to meet" : "to pass"}</b>.{" "}
              {s.mine.decision === "accept" && (s.other.decision === "pending" ? `Waiting for ${s.partner.name}…` : "")}
            </p>
          )}
        </>
      )}
      <div className="safety">
        <button className="link" onClick={() => setReportOpen(!reportOpen)}>
          <Flag size={13} /> Report
        </button>
        {blockAsk ? (
          <span className="confirm-inline">
            Block {s.partner.name}? Their introductions and contact access close.
            <button
              className="btn danger sm"
              onClick={() =>
                perform(async () => {
                  await api("/blocks/" + s.partner.id, "POST");
                  await loadScenes();
                  go("dates");
                }, "Blocked.")
              }
            >
              Block
            </button>
            <button className="link" onClick={() => setBlockAsk(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="link" onClick={() => setBlockAsk(true)}>
            <Ban size={13} /> Block
          </button>
        )}
      </div>
      {reportOpen && (
        <div className="report">
          <textarea
            aria-label="Report concern"
            placeholder="Describe the concern for the pilot operator"
            maxLength={1000}
            value={report}
            onChange={(e) => setReport(e.target.value)}
          />
          <button
            className="btn ghost sm"
            disabled={busy || report.length < 5}
            onClick={() =>
              perform(async () => {
                await api("/reports", "POST", { target_id: s.partner.id, reason: report });
                setReportOpen(false);
              }, "Your report is in the operator queue.")
            }
          >
            Send report
          </button>
        </div>
      )}
    </section>
  );
}

function Invitation({ s }: { s: Experience }) {
  const { perform, busy, loadScenes } = useStore();
  const [open, setOpen] = useState(false);
  const v = VENUES[s.venue];
  const prompt = s.partner.about?.prompts?.[0];
  const respond = (accept: boolean) =>
    perform(
      async () => {
        await api("/scenes/" + s.id + "/respond", "POST", { accept });
        await loadScenes();
      },
      accept ? `Accepted. Your agent is heading to ${v.name}.` : "Declined. Nothing was shared.",
    );
  return (
    <section className="invite reveal">
      <div className="invite-card">
        <span className="invite-stamp">💌 Invitation</span>
        <h3>
          {s.partner.name}'s agent would like to take yours to {v.icon} {v.name}
        </h3>
        <p className="fine">{v.blurb}</p>
        {s.partner.common?.length > 0 && (
          <div className="common">
            <Sparkles size={13} />
            {s.partner.common.map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
        )}
        {vitals(s.partner.about).length > 0 && (
          <div className="vitals">
            {vitals(s.partner.about)
              .slice(0, 5)
              .map((x) => (
                <span key={x.text}>
                  {x.icon} {x.text}
                </span>
              ))}
          </div>
        )}
        {prompt && (
          <div className="prompt-card small">
            <small>{PROMPTS[prompt.id]}</small>
            <p>{prompt.answer}</p>
          </div>
        )}
        <button className="link" onClick={() => setOpen(true)}>
          <UserRound size={13} /> View {s.partner.name}'s full profile
        </button>
        {open && <ProfileSheet c={s.partner} onClose={() => setOpen(false)} />}
        <div className="decide">
          <button className="btn primary" disabled={busy} onClick={() => respond(true)}>
            <Check size={16} /> Accept, let my agent go
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => respond(false)}>
            No thanks
          </button>
        </div>
        <p className="fine">Your agent only shares traits you marked shareable. Your contact stays private unless you both say yes later.</p>
      </div>
    </section>
  );
}

function DateDetail({ s }: { s: Experience }) {
  const { user, go } = useStore();
  const lines = s.output.dialogue ?? [];
  const animate = s.status === "completed" && !s.stale && !replayed.has(s.id);
  const [shown, setShown] = useState(animate ? 0 : lines.length);
  const end = useRef<HTMLDivElement>(null);
  const done = s.status === "completed" && shown >= lines.length;

  useEffect(() => {
    if (shown >= lines.length) {
      if (s.status === "completed") replayed.add(s.id);
      return;
    }
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 1500 : 2100);
    return () => clearTimeout(t);
  }, [shown, lines.length, s.status, s.id]);

  useEffect(() => {
    if (shown > 0 && shown <= lines.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [shown, lines.length]);

  // drive the 3D scene (only once both sides have said yes to the date)
  const going = s.status !== "invited" && s.status !== "declined";
  useEffect(() => {
    if (!going)
      return withWorld((w) => {
        w.setMode("date");
        w.setDate(null);
        w.focusSpot(s.venue, s.spot ?? 0, 1);
      });
    withWorld((w) => {
      w.setMode("date");
      w.setDate({
        id: s.id,
        type: s.venue,
        spot: s.spot ?? 0,
        mode: VENUES[s.venue]?.mode,
        a: { id: user!.id, name: user!.name, hue: user!.hue, self: true, face: headUrl(user!.face, user!.id, user!.hue), ...bodyColors(user!.face, user!.id, user!.hue) },
        b: { id: s.partner.id, name: s.partner.name, hue: s.partner.hue, face: headUrl(s.partner.face, s.partner.id, s.partner.hue), ...bodyColors(s.partner.face, s.partner.id, s.partner.hue) },
        phase: "walking",
      });
    });
    return () => withWorld((w) => w.setDate(null));
  }, [s.id, s.venue, s.spot, going]);
  // the line just revealed also appears as a speech bubble over its speaker on the island
  useEffect(() => {
    if (shown < 1 || shown > lines.length || !going) return;
    const l = lines[shown - 1];
    withWorld((w) => w.say(s.id, l.speaker_id === user!.id ? "a" : "b", l.text));
  }, [shown, s.id, going]);
  useEffect(() => {
    const phase = s.status === "queued" ? "walking" : done ? "done" : "talking";
    withWorld((w) => w.updateDatePhase(phase, s.output.assessment?.score));
  }, [s.status, done]);

  const v = VENUES[s.venue];
  return (
    <Panel className="date-panel">
      <button className="back link" onClick={() => go("dates")}>
        <ArrowLeft size={15} /> All dates
      </button>
      <header className="date-head">
        <div className="pair big">
          <Wisp hue={user!.hue} size={56} self name={user!.name} face={user!.face} seed={user!.id} />
          <span className="thread" style={{ "--a": user!.hue, "--b": s.partner.hue } as React.CSSProperties} />
          <Wisp hue={s.partner.hue} size={56} name={s.partner.name} face={s.partner.face} seed={s.partner.id} />
        </div>
        <div>
          <span className="eyebrow">
            {v.icon} {v.name}
            {s.incoming && " · they invited you"}
            {s.waived && !s.incoming && " · outside your usual filters"}
          </span>
          <h2>
            {user!.name}'s agent &amp; {s.partner.name}'s agent
          </h2>
          <small>
            {s.partner.age} · {s.partner.city} · {s.partner.intent}
          </small>
        </div>
      </header>

      {going && !s.stale && s.status !== "failed" && (
        <Process
          s={s}
          stage={s.status === "completed" ? (done ? 4 : (lines[Math.max(0, shown - 1)]?.stage ?? 0)) : s.status === "running" ? 0 : -1}
          lines={lines.slice(0, shown)}
        />
      )}
      {s.status === "invited" && s.incoming ? (
        <Invitation s={s} />
      ) : s.status === "invited" ? (
        <div className="waiting">
          <div className="orbit">
            <Wisp hue={user!.hue} size={30} self face={user!.face} seed={user!.id} />
            <Wisp hue={s.partner.hue} size={30} face={s.partner.face} seed={s.partner.id} />
          </div>
          <h3>Invitation sent to {s.partner.name}</h3>
          <p className="fine">{s.partner.name} reviews invitations personally. Your agents meet as soon as they accept.</p>
        </div>
      ) : s.status === "declined" ? (
        <Empty icon={<Coffee />} title={s.incoming ? "You declined this invitation" : `${s.partner.name} declined this time`}>
          <p>{s.incoming ? "Nothing was shared, and your agent didn't go." : "That's okay. Your agent will keep exploring."}</p>
          <button className="btn ghost" onClick={() => go("discover")}>
            Find someone else
          </button>
        </Empty>
      ) : s.stale ? (
        <Empty icon={<RefreshCw />} title="This date is out of date">
          <p>Someone's traits or preferences changed, so the old conversation is hidden and can't unlock contact.</p>
          <button className="btn ghost" onClick={() => go("discover")}>
            Start a fresh date
          </button>
        </Empty>
      ) : s.status === "failed" ? (
        <Empty icon={<RefreshCw />} title="This date didn't happen">
          <p>{s.error || "Something went wrong."}</p>
          <button className="btn ghost" onClick={() => go("discover")}>
            Try again
          </button>
        </Empty>
      ) : s.status !== "completed" ? (
        <div className="waiting">
          <div className="orbit">
            <Wisp hue={user!.hue} size={30} self face={user!.face} seed={user!.id} />
            <Wisp hue={s.partner.hue} size={30} face={s.partner.face} seed={s.partner.id} />
          </div>
          <h3>{s.status === "queued" ? "Your agents are walking over…" : "They're deep in conversation…"}</h3>
          <p className="fine">{v.blurb}</p>
          <Typing />
        </div>
      ) : (
        <>
          <p className="scene-premise">{v.blurb}</p>
          <div className="dialogue">
            {lines.slice(0, shown).map((l, i) => {
              const mine = l.speaker_id === user!.id;
              const st = l.stage ?? Math.floor(i / 2);
              const header = i === 0 || (lines[i - 1].stage ?? Math.floor((i - 1) / 2)) !== st;
              return (
                <Fragment key={i}>
                {header && v.stages[st] && (
                  <div className="stage-head">
                    <span>{v.stages[st].icon}</span> Step {st + 1} · {v.stages[st].title}
                  </div>
                )}
                <div className={"line " + (mine ? "mine" : "theirs")}>
                  <Wisp hue={mine ? user!.hue : s.partner.hue} size={30} self={mine} face={mine ? user!.face : s.partner.face} seed={mine ? user!.id : s.partner.id} />
                  <div>
                    <small>
                      {mine ? "Your agent" : s.partner.name + "'s agent"}
                      {l.mood && <em className="mood"> · {MOOD_ICON[l.mood] ?? ""} {l.mood}</em>}
                    </small>
                    <p>{l.text}</p>
                  </div>
                </div>
                </Fragment>
              );
            })}
            {shown < lines.length && (
              <div className={"line " + (lines[shown].speaker_id === user!.id ? "mine" : "theirs")}>
                <Wisp hue={lines[shown].speaker_id === user!.id ? user!.hue : s.partner.hue} size={30} face={lines[shown].speaker_id === user!.id ? user!.face : s.partner.face} seed={lines[shown].speaker_id === user!.id ? user!.id : s.partner.id} />
                <div>
                  <Typing />
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
          {shown < lines.length && (
            <button className="btn ghost sm skip" onClick={() => setShown(lines.length)}>
              <FastForward size={14} /> Skip to the reflection
            </button>
          )}
          {done && s.output.assessment && <Resonance s={s} />}
          {done && <YourTurn s={s} />}
          {done && s.output.evidence && (
            <details className="evidence">
              <summary>
                <Check size={13} /> Every agent line is grounded in approved traits
              </summary>
              <ul>
                {s.output.evidence.map((e) => (
                  <li key={e.id}>
                    <b>{e.owner_id === user!.id ? "You" : s.partner.name}:</b> {e.content}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}

export function Dates() {
  const { scenes, arg } = useStore();
  const fromStore = useMemo(() => scenes.find((x) => x.id === arg), [scenes, arg]);
  const [fetched, setFetched] = useState<Experience | null>(null);
  useEffect(() => {
    setFetched(null);
    if (!arg || fromStore) return;
    let alive = true;
    const load = () => api<Experience>("/scenes/" + arg).then((x) => alive && setFetched(x)).catch(() => {});
    load();
    const id = setInterval(load, 3000); // older dates aren't in the live feed; poll them directly
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [arg, fromStore?.id]);
  const s = fromStore ?? (fetched?.id === arg ? fetched : null);
  useEffect(() => {
    if (!arg)
      withWorld((w) => {
        w.setDate(null);
        w.setMode("calm");
      });
  }, [arg]);
  if (arg && s) return <DateDetail key={s.id} s={s} />;
  if (arg) return <Panel className="date-panel"><p className="fine">Opening the date…</p></Panel>;
  return <DateList />;
}
