import { useState } from "react";
import { Trash2, Check, Globe2, Lock, ListChecks, Inbox, Pencil, X, Smile, Camera, ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
import { api, CATEGORIES, type Memory } from "../api";
import { useStore } from "../store";
import { Panel, Head } from "./Shell";
import { Wisp, Empty } from "../ui";
import { QUICK_QUESTIONS, sentence } from "../quickQuestions";
import { Essentials } from "./Home";
import { FaceStudio } from "./FaceStudio";
import { CoachCard } from "./Studio";

function TraitCard({ m }: { m: Memory }) {
  const { perform, load, openSetup } = useStore();
  const fromProfile = m.source_id.startsWith("about:");
  const fromQuestion = m.source_id.startsWith("quick:");
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(m.content);
  const cat = CATEGORIES.find((c) => c.id === m.category);
  const save = (visibility: string, status = "approved", content = text) =>
    perform(async () => {
      await api("/memories/" + m.id, "PATCH", { content, visibility, status, expected_version: m.version });
      setEdit(false);
      await load();
    });
  return (
    <article className={"trait " + m.status}>
      <div className="trait-top">
        <span className="cat">
          {cat?.icon} {cat?.label ?? m.category}
        </span>
        <button
          className={"vis " + m.visibility}
          title={m.visibility === "shareable" ? "An eligible twin may hear this" : m.visibility === "twin" ? "Only your twin uses this" : "Private"}
          onClick={() => save(m.visibility === "private" ? "twin" : m.visibility === "twin" ? "shareable" : "private", "approved", m.content)}
        >
          {m.visibility === "shareable" ? <Globe2 size={13} /> : <Lock size={13} />}
          {m.visibility === "shareable" ? "Shareable" : m.visibility === "twin" ? "Twin only" : "Private"}
        </button>
      </div>
      {edit ? (
        <textarea value={text} maxLength={600} onChange={(e) => setText(e.target.value)} autoFocus />
      ) : (
        <p>{m.content}</p>
      )}
      {fromProfile && (
        <button className="from-profile" onClick={() => openSetup(0)}>
          From your profile · edit there
        </button>
      )}
      {!fromProfile && !fromQuestion && m.source_id !== "owner-written" && m.source_quote !== m.content && (
        <details>
          <summary>Where this came from</summary>
          <q>{m.source_quote}</q>
        </details>
      )}
      <div className="trait-actions">
        {m.status === "proposed" ? (
          <>
            <button className="btn primary sm" onClick={() => save("private")}>
              <Check size={14} /> Approve (private)
            </button>
            <button className="btn ghost sm" onClick={() => save("shareable")}>
              <Globe2 size={14} /> Approve and share
            </button>
            <button className="link" onClick={() => save(m.visibility, "rejected", m.content)}>
              Reject
            </button>
          </>
        ) : edit ? (
          <>
            <button className="btn primary sm" onClick={() => save(m.visibility)}>
              Save
            </button>
            <button className="icon-btn" aria-label="Cancel" onClick={() => (setEdit(false), setText(m.content))}>
              <X size={15} />
            </button>
          </>
        ) : fromProfile || fromQuestion ? null : (
          <button className="icon-btn" aria-label="Edit" onClick={() => setEdit(true)}>
            <Pencil size={15} />
          </button>
        )}
        <button
          className="icon-btn danger"
          aria-label="Forget this"
          onClick={() =>
            perform(async () => {
              await api("/memories/" + m.id, "DELETE");
              await load();
            }, "Forgotten. Your twin won't use this any more.")
          }
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

/** One question at a time, four answers each. "Other" opens a box for their own words. */
function QuickQuestions() {
  const { memories, perform, load, busy } = useStore();
  const answered = new Map(memories.filter((m) => m.source_id.startsWith("quick:")).map((m) => [m.source_id.slice(6), m]));
  const firstOpen = QUICK_QUESTIONS.findIndex((q) => !answered.has(q.id));
  const [at, setAt] = useState(firstOpen < 0 ? 0 : firstOpen);
  const [other, setOther] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const q = QUICK_QUESTIONS[at];
  const done = QUICK_QUESTIONS.filter((x) => answered.has(x.id)).length;
  const go = (n: number) => { setOther(null); setAt((n + QUICK_QUESTIONS.length) % QUICK_QUESTIONS.length); };
  const save = (answer: string) =>
    perform(async () => {
      await api("/memories", "POST", { category: q.category, content: sentence(q, answer), visibility: share ? "shareable" : "private", question_id: q.id });
      await load();
      const nextOpen = QUICK_QUESTIONS.findIndex((x, i) => i > at && !answered.has(x.id));
      go(nextOpen < 0 ? at + 1 : nextOpen);
    });
  const current = answered.get(q.id);
  return (
    <section className="quickq glass card" aria-live="polite">
      <div className="quickq-top">
        <span className="eyebrow">Question {at + 1} of {QUICK_QUESTIONS.length} · {done} answered</span>
        <span>
          <button className="icon-btn" aria-label="Previous question" onClick={() => go(at - 1)}><ChevronLeft size={16} /></button>
          <button className="icon-btn" aria-label="Next question" onClick={() => go(at + 1)}><ChevronRight size={16} /></button>
        </span>
      </div>
      <h3>{q.ask}</h3>
      {current && <p className="fine">Your answer: “{current.content}” Tap another to change it.</p>}
      <div className="w-chips big four">
        {q.options.map((o) => (
          <button key={o} type="button" disabled={busy} className={(o === "Other" ? other !== null : current?.content === sentence(q, o)) ? "on" : ""}
            onClick={() => (o === "Other" ? setOther("") : save(o))}>{o}</button>
        ))}
      </div>
      {other !== null && (
        <form className="studio-other-row" onSubmit={(e) => { e.preventDefault(); if (other.trim().length >= 2) save(other); }}>
          <input className="studio-other" type="text" autoFocus maxLength={120} placeholder="In a few words" value={other} onChange={(e) => setOther(e.target.value)} />
          <button className="btn primary" disabled={busy || other.trim().length < 2}>Save</button>
        </form>
      )}
      <label className="switch">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        <i />
        <span>{share ? "My twin may mention this on dates" : "Private: only helps my twin know me"}</span>
      </label>
    </section>
  );
}

export function Agent() {
  const { user, memories, arg, openSetup } = useStore();
  const approved = memories.filter((m) => m.status === "approved");
  const proposals = memories.filter((m) => m.status === "proposed");
  const [tab, setTab] = useState(arg === "face" ? "face" : proposals.length ? "review" : "questions");
  const groups = CATEGORIES.map((c) => ({ ...c, items: approved.filter((m) => m.category === c.id) })).filter(
    (g) => g.items.length,
  );
  return (
    <Panel wide>
      <Head eyebrow="Your twin" title={<>Help your twin <em>get to know you.</em></>}>
        <button className="btn ghost" onClick={() => openSetup(0)}>
          Redo the starter questions
        </button>
      </Head>
      <CoachCard trigger="pre_introduction" />
      <CoachCard trigger="agent" />
      <div className="studio-hero">
        <button className="studio-wisp" onClick={() => setTab("face")} title="Change your twin's face">
          <Wisp hue={user!.hue} size={84} self face={user!.face} seed={user!.id} />
          <span className="edit-face">
            <Camera size={13} /> Face
          </span>
        </button>
        <Essentials />
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "questions"} className={tab === "questions" ? "on" : ""} onClick={() => setTab("questions")}>
          <HelpCircle size={16} /> Quick questions
        </button>
        <button role="tab" aria-selected={tab === "traits"} className={tab === "traits" ? "on" : ""} onClick={() => setTab("traits")}>
          <ListChecks size={16} /> Things my twin knows <b>{approved.length}</b>
        </button>
        {proposals.length > 0 && (
          <button role="tab" aria-selected={tab === "review"} className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
            <Inbox size={16} /> Review before sharing <b className="hot">{proposals.length}</b>
          </button>
        )}
        <button role="tab" aria-selected={tab === "face"} className={tab === "face" ? "on" : ""} onClick={() => setTab("face")}>
          <Smile size={16} /> Face
        </button>
      </div>

      {tab === "questions" && <QuickQuestions />}
      {tab === "traits" &&
        (groups.length ? (
          groups.map((g) => (
            <section key={g.id} className="trait-group">
              <h4>
                {g.icon} {g.label}
              </h4>
              <div className="trait-grid">
                {g.items.map((m) => (
                  <TraitCard key={m.id + m.version} m={m} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <Empty icon="✦" title="Your twin doesn't know much yet">
            <p>Answer a few quick questions. Each answer shows up here, and you can change or forget it any time.</p>
            <button className="btn primary" onClick={() => setTab("questions")}>Answer a question</button>
          </Empty>
        ))}
      {tab === "face" && <FaceStudio />}
      {tab === "review" &&
        (proposals.length ? (
          <>
            <p className="fine">
              Your twin noticed these. Nothing is used until you approve it, and approved things stay private unless you
              make them shareable.
            </p>
            <div className="trait-grid">
              {proposals.map((m) => (
                <TraitCard key={m.id + m.version} m={m} />
              ))}
            </div>
          </>
        ) : (
          <Empty icon={<Check />} title="All caught up">
            <p>Nothing waiting for your review.</p>
          </Empty>
        ))}
    </Panel>
  );
}
