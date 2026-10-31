import { useEffect, useRef, useState } from "react";
import { Send, Plus, Trash2, Check, Globe2, Lock, MessageCircle, ListChecks, Inbox, Pencil, X, Smile, Camera } from "lucide-react";
import { api, CATEGORIES, STATIC, type Memory } from "../api";
import { useStore } from "../store";
import { Panel, Head } from "./Shell";
import { Wisp, Ring, Empty, Typing } from "../ui";
import { VoiceInput } from "../VoiceInput";
import { FaceStudio } from "./FaceStudio";
import { CoachCard } from "./Studio";

const PROMPTS: Record<string, string[]> = {
  values: ["I feel most respected when…", "A dealbreaker for me is…"],
  lifestyle: ["My perfect Sunday looks like…", "On a weeknight you'll usually find me…"],
  communication: ["When we disagree, I tend to…", "I show I care by…"],
  future: ["In three years I'd love to be…", "Family to me means…"],
  interests: ["I could talk for hours about…", "Something I'm learning right now is…"],
  backstory: ["A moment that changed me was…"],
  boundaries: ["Please don't rush me on…", "I need time alone when…"],
};

function TraitCard({ m }: { m: Memory }) {
  const { perform, load, openSetup } = useStore();
  const fromProfile = m.source_id.startsWith("about:");
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
      {!fromProfile && m.source_id !== "owner-written" && m.source_quote !== m.content && (
        <details>
          <summary>From your interview</summary>
          <q>{m.source_quote}</q>
        </details>
      )}
      <div className="trait-actions">
        {m.status === "proposed" ? (
          <>
            <button className="btn primary sm" onClick={() => save("shareable")}>
              <Check size={14} /> Approve &amp; share
            </button>
            <button className="btn ghost sm" onClick={() => save("private")}>
              <Lock size={14} /> Keep private
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
        ) : fromProfile ? null : (
          <button className="icon-btn" aria-label="Edit trait" onClick={() => setEdit(true)}>
            <Pencil size={15} />
          </button>
        )}
        <button
          className="icon-btn danger"
          aria-label="Delete trait"
          onClick={() =>
            perform(async () => {
              await api("/memories/" + m.id, "DELETE");
              await load();
            }, "Trait removed. Your agent will see future people with fresh eyes.")
          }
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

function AddTrait() {
  const { perform, load, busy, insights } = useStore();
  const [cat, setCat] = useState(() => CATEGORIES.find((c) => !insights?.coverage[c.id])?.id ?? "values");
  const [text, setText] = useState("");
  const [share, setShare] = useState(true);
  const c = CATEGORIES.find((x) => x.id === cat)!;
  return (
    <form
      className="add-trait"
      onSubmit={(e) => {
        e.preventDefault();
        perform(async () => {
          await api("/memories", "POST", { category: cat, content: text, visibility: share ? "shareable" : "private" });
          setText("");
          await load();
        }, "Your agent learned something new about you.");
      }}
    >
      <div className="cat-pills" role="radiogroup" aria-label="Trait category">
        {CATEGORIES.map((x) => (
          <button
            type="button"
            key={x.id}
            role="radio"
            aria-checked={cat === x.id}
            className={(cat === x.id ? "on " : "") + (insights?.coverage[x.id] ? "has" : "")}
            onClick={() => setCat(x.id)}
          >
            {x.icon} {x.label}
          </button>
        ))}
      </div>
      <label className="sr" htmlFor="trait-text">
        {c.hint}
      </label>
      <textarea
        id="trait-text"
        placeholder={c.hint + "…"}
        value={text}
        minLength={3}
        maxLength={600}
        required
        onChange={(e) => setText(e.target.value)}
      />
      <div className="starters">
        {PROMPTS[cat].map((p) => (
          <button type="button" key={p} onClick={() => setText(p + " ")}>
            {p}
          </button>
        ))}
      </div>
      <div className="add-foot">
        <label className="switch">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <i />
          <span>{share ? "My agent may share this on dates" : "Private: only shapes my interview"}</span>
        </label>
        <button className="btn primary" disabled={busy || text.trim().length < 3}>
          <Plus size={16} /> Teach my agent
        </button>
      </div>
    </form>
  );
}

function Interview() {
  const { messages, perform, load, mode, notify, busy, user } = useStore();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [messages.length, sending]);
  return (
    <div className="interview">
      <div className="chat">
        {messages.map((m, i) => (
          <div key={m.id ?? i} className={"bubble " + m.role}>
            {m.content}
          </div>
        ))}
        {sending && (
          <>
            <div className="bubble user">{sending}</div>
            <div className="bubble assistant">
              <Typing />
            </div>
          </>
        )}
        <div ref={end} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length < 2) return;
          const text = draft;
          setSending(text);
          setDraft("");
          perform(async () => {
            const r = await api("/chat", "POST", { message: text });
            await load();
            if (r.proposals) notify(`Your agent noticed ${r.proposals} new thing${r.proposals > 1 ? "s" : ""}. Review them in "To review".`);
          }).then((ok) => {
            setSending("");
            if (!ok) setDraft(text);
          });
        }}
      >
        <textarea
          aria-label="Your answer"
          placeholder="Answer in your own words…"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
        />
        <div className="composer-row">
          {STATIC ? (
            <span className="fine">Press Enter to send</span>
          ) : (
            <VoiceInput onTranscript={(t) => setDraft((d) => d + (d ? "\n" : "") + t)} onError={(e) => notify(e, "err")} />
          )}
          <button className="btn primary" disabled={busy || draft.trim().length < 2}>
            <Send size={16} /> Send
          </button>
        </div>
      </form>
    </div>
  );
}

export function Agent() {
  const { user, memories, insights, arg, openSetup } = useStore();
  const approved = memories.filter((m) => m.status === "approved");
  const proposals = memories.filter((m) => m.status === "proposed");
  const [tab, setTab] = useState(arg === "face" ? "face" : proposals.length ? "review" : "traits");
  const groups = CATEGORIES.map((c) => ({ ...c, items: approved.filter((m) => m.category === c.id) })).filter(
    (g) => g.items.length,
  );
  return (
    <Panel wide>
      <Head eyebrow="Behaviour studio" title={<>Teach your agent <em>who you are.</em></>}>
        <button className="btn primary" onClick={() => openSetup(0)}>
          Teach your twin
        </button>
      </Head>
      <CoachCard trigger="pre_introduction" />
      <CoachCard trigger="agent" />
      <div className="studio-hero">
        <button className="studio-wisp" onClick={() => setTab("face")} title="Change your agent's face">
          <Wisp hue={user!.hue} size={84} self face={user!.face} seed={user!.id} />
          <span className="edit-face">
            <Camera size={13} /> Face
          </span>
        </button>
        <Ring value={insights?.knowledge ?? 0} size={112} stroke={9} label="knows you" />
        <div className="coverage">
          {CATEGORIES.map((c) => {
            const n = insights?.coverage[c.id] ?? 0;
            return (
              <div key={c.id} className={"cov" + (n ? " has" : "")} title={c.hint}>
                <span>{c.icon}</span>
                <small>{c.label}</small>
                <b>{n}</b>
              </div>
            );
          })}
          <p className="fine">
            The more you confirm, the more honestly your twin can represent you. Scores stay guidance. You decide who to meet.
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "face"} className={tab === "face" ? "on" : ""} onClick={() => setTab("face")}>
          <Smile size={16} /> Face
        </button>
        <button role="tab" aria-selected={tab === "traits"} className={tab === "traits" ? "on" : ""} onClick={() => setTab("traits")}>
          <ListChecks size={16} /> Traits <b>{approved.length}</b>
        </button>
        <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
          <MessageCircle size={16} /> Interview
        </button>
        <button role="tab" aria-selected={tab === "review"} className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
          <Inbox size={16} /> To review {proposals.length > 0 && <b className="hot">{proposals.length}</b>}
        </button>
      </div>

      {tab === "traits" && (
        <>
          <AddTrait />
          {groups.length ? (
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
            <Empty icon="✦" title="Your agent is a blank page">
              <p>Add your first trait above, or let the interview draw it out of you.</p>
            </Empty>
          )}
        </>
      )}
      {tab === "chat" && <Interview />}
      {tab === "face" && <FaceStudio />}
      {tab === "review" &&
        (proposals.length ? (
          <>
            <p className="fine">
              Your agent proposed these from your interview. Nothing is used until you approve it. Edit anything that
              doesn't sound like you.
            </p>
            <div className="trait-grid">
              {proposals.map((m) => (
                <TraitCard key={m.id + m.version} m={m} />
              ))}
            </div>
          </>
        ) : (
          <Empty icon={<Check />} title="All caught up">
            <p>Proposals from your interview appear here for approval.</p>
          </Empty>
        ))}
    </Panel>
  );
}
