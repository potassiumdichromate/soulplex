import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X, Sparkles, ShieldCheck, MessageCircle } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Wisp } from "../ui";

type Option = { id: string; label: string; icon?: string };
type Field = {
  field_id: string;
  prompt: string;
  kind: string;
  required: boolean;
  maximum: number;
  skip: boolean;
  text_max: number;
  options: Option[];
  trigger?: string;
  icon?: string;
  group?: string;
};
type Schema = {
  fields: Field[];
  calibration: { id: string; title: string; prompt: string; options: Option[] }[];
  calibration_order: string[];
  unseen: { id: string; title: string; prompt: string; options: Option[] }[];
  consents: { id: string; label: string; default: boolean }[];
};
type Answer = { field_id: string; option_ids: string[]; free_text: string; status: string; permission_scope?: string };
type Cal = { scenario_id: string; owner_locked?: boolean; twin_locked?: boolean; twin_option?: string; twin_summary?: string; rating?: string; owner_option?: string };

const STEPS = ["welcome", "age", "Q01_gender", "A01_vibe", "S02", "A03_weekend", "A04_life", "habits", "S01", "Q01_seeking", "ages", "Q01_distance", "Q02", "partner", "Q04", "Q05", "preview", "facts", "permissions", "ready"] as const;
const GROUPS: Record<string, string[]> = {
  habits: ["H01_drinking", "H02_smoking", "H03_workout", "H04_diet"],
  partner: ["P01_drinking", "P02_smoking", "P03_active", "P04_diet"],
};
const ABOUT = new Set(["Q01_gender", "A01_vibe", "S02", "A03_weekend", "A04_life", "habits", "S01"]);
const LOOKING = new Set(["Q01_seeking", "ages", "Q01_distance", "Q02", "partner", "Q04", "Q05"]);

/* The twin talks; the person taps. Titles are what the twin says, hints are the small print. */
const COPY: Record<string, { title: string; hint: string }> = {
  welcome: { title: "Hey, I'm your twin 👋", hint: "I'll go on the first dates for you, so I'd love to get to know you a little. No essays: just tap what feels like you. Takes about two minutes." },
  age: { title: "Quick thing first", hint: "Soulplex is for adults. Everything you tell me stays private until you choose to share it, and you can skip anything." },
  Q01_gender: { title: "Let's start with you. I am a…", hint: "This only helps me find people who'd like to meet you too." },
  A01_vibe: { title: "How would your friends describe you?", hint: "Pick up to 4." },
  S02: { title: "What are you into?", hint: "Pick up to 6, the things you could talk about for hours." },
  A03_weekend: { title: "Your perfect weekend looks like…", hint: "Just pick the one that sounds most like you." },
  A04_life: { title: "What matters most to you right now?", hint: "Up to 3. Career, family, a bit of everything?" },
  habits: { title: "A few quick lifestyle bits", hint: "Tap what fits. Skip anything you'd rather not say." },
  S01: { title: "When you're chatting with someone new, you're usually…", hint: "So I can sound like you on dates." },
  Q01_seeking: { title: "Now, who would you like to meet?", hint: "Pick everyone you're open to." },
  ages: { title: "What age range feels right?", hint: "You can change this any time." },
  Q01_distance: { title: "How far should I look?", hint: "Other cities only if you both say yes." },
  Q02: { title: "What are you hoping to find?", hint: "No wrong answer here." },
  partner: { title: "Any preferences about their lifestyle?", hint: "\u201cDoesn't matter\u201d keeps things open. I'll only rule people out on what you pick here." },
  Q04: { title: "What would make you fall for someone?", hint: "Pick up to 3." },
  Q05: { title: "Where would you feel most yourself on a first date?", hint: "I'll start our dates there." },
  preview: { title: "Here's you, in a nutshell", hint: "This is just what you picked, not a personality test. Untick anything that doesn't sound right." },
  calibration: { title: "Let's see if I get you", hint: "You answer first, then I guess. Tell me how close I got." },
  facts: { title: "Who gets to see what?", hint: "Everything starts private. Make something shareable only if you want me to mention it on dates." },
  permissions: { title: "What I'm allowed to do", hint: "Every switch starts off. Turn on only what you're comfortable with." },
  ready: { title: "That's it, we're ready! 🎉", hint: "You can tell me more any time from the Agent tab." },
  H01_drinking: { title: "Drinking", hint: "" }, H02_smoking: { title: "Smoking", hint: "" }, H03_workout: { title: "Working out", hint: "" }, H04_diet: { title: "Food", hint: "" },
  P01_drinking: { title: "Their drinking", hint: "" }, P02_smoking: { title: "Their smoking", hint: "" }, P03_active: { title: "Their activity", hint: "" }, P04_diet: { title: "Their food", hint: "" },
  Q03: { title: "Definite nos", hint: "" },
};

function fieldOf(schema: Schema | null, id: string) {
  return schema?.fields.find((f) => f.field_id === id);
}

export function Studio({ onClose }: { start?: number; onClose: () => void }) {
  const { user, perform, busy, setUser, load } = useStore();
  const [schema, setSchema] = useState<Schema | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [mode, setMode] = useState<"taps" | "talk">("taps");
  const [talk, setTalk] = useState("");
  const [guess, setGuess] = useState<Option | null>(null);
  const [note, setNote] = useState("");
  const [ageMin, setAgeMin] = useState(user?.age_min ?? 25);
  const [ageMax, setAgeMax] = useState(user?.age_max ?? 40);
  const [city, setCity] = useState(user?.city || "Dubai");
  const [preview, setPreview] = useState<string[]>([]);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [calI, setCalI] = useState(0);
  const [phase, setPhase] = useState<"owner" | "twin" | "review">("owner");
  const [cals, setCals] = useState<Record<string, Cal>>({});
  const [grants, setGrants] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState("");
  const [fidelity, setFidelity] = useState("");

  useEffect(() => {
    perform(async () => {
      const [s, state] = await Promise.all([api<Schema>("/onboarding/schema"), api<any>("/onboarding")]);
      setSchema(s);
      const map: Record<string, Answer> = {};
      for (const a of state.answers as Answer[]) map[a.field_id] = a;
      setAnswers(map);
      setGrants(state.consents || {});
      const saved: Record<string, Cal> = {};
      for (const c of state.calibration as Cal[]) saved[c.scenario_id] = c;
      setCals(saved);
      if (state.fidelity?.label) setFidelity(state.fidelity.label);
      const resume = STEPS.indexOf(state.studio?.step);
      if (resume > 0) setStep(resume);
      if (state.studio?.mode === "talk") setMode("talk");
    });
  }, []);

  const id = STEPS[step];
  const field = fieldOf(schema, id);
  const selected = answers[id]?.option_ids ?? [];
  const cal = schema?.calibration[calI];

  const saveAnswer = (fieldId: string, optionIds: string[], status = "answered", free = note) =>
    perform(async () => {
      const row = await api<Answer>("/onboarding/answers/" + fieldId, "PUT", {
        option_ids: optionIds,
        free_text: free,
        status,
        mode,
      });
      setAnswers((prev) => ({ ...prev, [fieldId]: row }));
      setNote("");
      setGuess(null);
      setTalk("");
    });

  const exit = () =>
    perform(async () => {
      await api("/onboarding/state", "PUT", { step: id, mode });
      onClose();
    }, "Saved. You can resume this step.");

  const next = () => setStep((n) => Math.min(STEPS.length - 1, n + 1));
  const back = () => setStep((n) => Math.max(0, n - 1));

  const toggle = (option: Option) => {
    if (!field) return;
    if (field.kind === "single" || option.id === "any" || option.id === "none") {
      saveAnswer(field.field_id, selected.length === 1 && selected[0] === option.id ? [] : [option.id]).then?.(() => {});
      setAnswers((prev) => ({
        ...prev,
        [field.field_id]: { field_id: field.field_id, option_ids: [option.id], free_text: "", status: "answered" },
      }));
      return;
    }
    const has = selected.includes(option.id);
    let ids = has ? selected.filter((x) => x !== option.id) : [...selected.filter((x) => x !== "any" && x !== "none"), option.id];
    ids = ids.slice(0, field.maximum);
    setAnswers((prev) => ({
      ...prev,
      [field.field_id]: { field_id: field.field_id, option_ids: ids, free_text: note, status: "answered" },
    }));
  };

  const commitMulti = () => {
    if (!field || !selected.length) return;
    saveAnswer(field.field_id, selected).then((ok) => ok && next());
  };

  const hear = () => {
    if (!field) return;
    const text = talk.toLowerCase();
    const hit = field.options.find((o) => text.includes(o.label.toLowerCase()) || text.includes(o.id.replaceAll("_", " ")));
    setGuess(hit ?? null);
  };

  const loadPreview = () =>
    perform(async () => {
      const body = await api<{ lines: string[] }>("/onboarding/preview", "POST");
      setPreview(body.lines);
      setKeep(Object.fromEntries(body.lines.map((line) => [line, true])));
      await api("/onboarding/state", "PUT", { step: "preview", mode });
    });

  useEffect(() => {
    if (id === "preview" && !preview.length) loadPreview();
  }, [id]);

  const scene = cal;
  const savedCal = scene ? cals[scene.id] : undefined;

  const lockOwner = (optionId: string) =>
    perform(async () => {
      if (!scene) return;
      const row = await api<Cal>("/calibration/" + scene.id + "/owner", "POST", {
        option_ids: [optionId],
        status: "answered",
        free_text: note,
      });
      setCals((prev) => ({ ...prev, [scene.id]: row }));
      setPhase("twin");
      setNote("");
    });

  const runTwin = () =>
    perform(async () => {
      if (!scene) return;
      try {
        const row = await api<Cal>("/calibration/" + scene.id + "/run", "POST");
        setCals((prev) => ({ ...prev, [scene.id]: row }));
        setPhase("review");
      } catch (err) {
        setPhase("review");
        setCals((prev) => ({ ...prev, [scene!.id]: { ...(prev[scene!.id] || { scenario_id: scene!.id }), twin_summary: err instanceof Error ? err.message : "Not completed." } }));
      }
    });

  const rate = (rating: string) =>
    perform(async () => {
      if (!scene || !savedCal?.twin_option) return;
      const row = await api<Cal>("/calibration/" + scene.id + "/review", "POST", { rating, correction: note });
      setCals((prev) => ({ ...prev, [scene.id]: row }));
      setNote("");
      if (calI < (schema?.calibration.length ?? 1) - 1) {
        setCalI(calI + 1);
        setPhase("owner");
      } else next();
    });

  const finishPermissions = () =>
    perform(async () => {
      await api("/privacy/permissions", "PUT", { grants });
      const auth = await api<{ readiness: string; fidelity: { label: string } }>("/twin/authorize", "POST");
      setReady(auth.readiness);
      setFidelity(auth.fidelity.label);
      await load();
      next();
    });

  const progress = Math.round((step / (STEPS.length - 1)) * 100);
  const copy = COPY[id] ?? COPY.welcome;
  const aboutSteps = STEPS.filter((x) => ABOUT.has(x));
  const lookSteps = STEPS.filter((x) => LOOKING.has(x));
  const section = ABOUT.has(id)
    ? `About you · ${aboutSteps.indexOf(id as any) + 1} of ${aboutSteps.length}`
    : LOOKING.has(id)
      ? `Who you're looking for · ${lookSteps.indexOf(id as any) + 1} of ${lookSteps.length}`
      : ["facts", "permissions"].includes(id) ? "Your privacy" : "Your twin";
  const group = GROUPS[id];
  const pickInGroup = (f: Field, o: Option) => {
    const same = answers[f.field_id]?.option_ids?.[0] === o.id && answers[f.field_id]?.status === "answered";
    setAnswers((prev) => ({ ...prev, [f.field_id]: { field_id: f.field_id, option_ids: same ? [] : [o.id], free_text: "", status: same ? "skipped" : "answered" } }));
    saveAnswer(f.field_id, same ? [] : [o.id], same ? "skipped" : "answered", "");
  };

  return (
    <div className="wizard-backdrop">
      <div className="wizard studio-flow glass" role="dialog" aria-modal="true" aria-label="Teach your twin">
        <header className="studio-top">
          <button className="icon-btn" aria-label="Back" onClick={back} disabled={step === 0}>
            <ArrowLeft size={18} />
          </button>
          <div className="studio-meter" aria-hidden="true"><i style={{ width: progress + "%" }} /></div>
          <button className="link" onClick={exit}>Save and exit</button>
          <button className="icon-btn" aria-label="Close setup" onClick={exit}><X size={18} /></button>
        </header>
        <div className="w-body studio-body">
          <div className="studio-say">
            <Wisp hue={user?.hue ?? 330} size={54} self face={user?.face} seed={user?.id} />
            <div className="studio-bubble">
              <p className="eyebrow">{section}</p>
              <h2>{copy.title}</h2>
              {copy.hint && <p className="hint">{copy.hint}</p>}
            </div>
          </div>

          {id === "welcome" && (
            <button className="btn primary" onClick={next}>Let's go <ArrowRight size={16} /></button>
          )}
          {id === "age" && (
            <div className="studio-note">
              <ShieldCheck size={18} />
              <p>I only share what you allow, one thing at a time. Skipped questions just stay unknown.</p>
              <button className="btn primary" disabled={busy} onClick={() => perform(async () => { await api("/onboarding/age", "POST", { adult: true }); next(); })}>
                I'm 18 or older <ArrowRight size={16} />
              </button>
            </div>
          )}
          {group && schema && (
            <div className="studio-groups">
              {group.map((fid) => fieldOf(schema, fid)).filter(Boolean).map((f) => (
                <div key={f!.field_id} className="studio-group">
                  <span className="studio-group-label">{f!.icon} {f!.prompt}</span>
                  <div className="w-chips">
                    {f!.options.map((o) => {
                      const on = answers[f!.field_id]?.status === "answered" && answers[f!.field_id]?.option_ids?.[0] === o.id;
                      return (
                        <button key={o.id} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => pickInGroup(f!, o)}>{o.label}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="btn-row">
                <button className="btn primary" disabled={busy} onClick={next}>Continue <ArrowRight size={16} /></button>
              </div>
            </div>
          )}
          {id === "ages" && (
            <div className="studio-ages">
              <label>From {ageMin}<input type="range" min={18} max={100} value={ageMin} onChange={(e) => setAgeMin(Math.min(+e.target.value, ageMax))} /></label>
              <label>To {ageMax}<input type="range" min={18} max={100} value={ageMax} onChange={(e) => setAgeMax(Math.max(+e.target.value, ageMin))} /></label>
              <label>City
                <select value={city} onChange={(e) => setCity(e.target.value)}>
                  <option>Dubai</option>
                  <option>Delhi NCR</option>
                </select>
              </label>
              <button className="btn primary" disabled={busy} onClick={() => perform(async () => {
                await api("/onboarding/range", "PUT", { age_min: ageMin, age_max: ageMax, city });
                await load();
                next();
              })}>Continue</button>
            </div>
          )}
          {field && id !== "ages" && !group && (
            <>
              {mode === "talk" && (
                <div className="studio-talk">
                  <textarea value={talk} maxLength={400} placeholder="Type it however you like, I'll match it to an option." onChange={(e) => setTalk(e.target.value)} />
                  <button className="btn ghost sm" type="button" onClick={hear}>Match a choice</button>
                  {guess && <p className="fine">Sounds like “{guess.label}”. Tap it below to confirm.</p>}
                  {talk && !guess && <p className="fine">Hmm, I couldn't match that. Pick the closest one below.</p>}
                </div>
              )}
              <div className="w-chips big">
                {field.options.map((o) => (
                  <button key={o.id} type="button" className={selected.includes(o.id) || guess?.id === o.id ? "on" : ""} aria-pressed={selected.includes(o.id)} onClick={() => {
                    if (field.kind === "single") {
                      saveAnswer(field.field_id, [o.id]).then((ok) => ok && next());
                    } else toggle(o);
                  }}>{o.icon && <span className="chip-ico" aria-hidden="true">{o.icon}</span>}{o.label}</button>
                ))}
              </div>
              {field.kind === "multi" && field.maximum > 1 && <p className="fine studio-count">{selected.length} of {field.maximum} picked</p>}
              {(selected.includes("other") || selected.includes("depends")) && field.text_max > 0 && (
                <textarea value={note} maxLength={field.text_max} placeholder="Optional note. It stays private until you approve it." onChange={(e) => setNote(e.target.value)} />
              )}
              <div className="btn-row">
                {field.kind === "multi" && <button className="btn primary" disabled={!selected.length || busy} onClick={commitMulti}>Continue <ArrowRight size={16} /></button>}
                {field.skip && <button className="btn ghost" disabled={busy} onClick={() => { saveAnswer(field.field_id, [], "skipped", "").then((ok) => ok && next()); }}>Skip</button>}
                <button className="link" type="button" onClick={() => setMode(mode === "talk" ? "taps" : "talk")}>
                  <MessageCircle size={14} /> {mode === "talk" ? "Just tap instead" : "Say it in my own words"}
                </button>
              </div>
            </>
          )}
          {id === "preview" && (
            <div className="studio-preview">
              {preview.map((line) => (
                <label key={line} className="studio-line">
                  <input type="checkbox" checked={keep[line] !== false} onChange={(e) => setKeep({ ...keep, [line]: e.target.checked })} />
                  <span>{line}</span>
                </label>
              ))}
              {!preview.length && <p className="fine">Pick a few things and they'll show up here.</p>}
              <p className="fine">Saved lines stay private until you decide otherwise.</p>
              <button className="btn primary" disabled={busy} onClick={() => perform(async () => {
                const lines = preview.filter((line) => keep[line] !== false);
                if (lines.length) await api("/onboarding/preview/approve", "POST", { lines });
                next();
              })}><Sparkles size={15} /> This sounds like me</button>
            </div>
          )}
          {id === "facts" && (
            <div className="studio-facts">
              {Object.values(answers).filter((a) => a.status === "answered").map((a) => (
                <article key={a.field_id}>
                  <b>{COPY[a.field_id]?.title || a.field_id}</b>
                  <div className="w-chips">
                    {(["private", "twin", "shareable"] as const).map((scope) => (
                      <button key={scope} type="button" className={(a.permission_scope || "private") === scope ? "on" : ""} onClick={() => perform(async () => {
                        const grantsNow = grants.allow_shareable_facts ? grants : { ...grants, allow_shareable_facts: scope === "shareable" };
                        if (scope === "shareable" && !grants.allow_shareable_facts) {
                          await api("/privacy/permissions", "PUT", { grants: { ...grantsNow, allow_shareable_facts: true } });
                          setGrants({ ...grantsNow, allow_shareable_facts: true });
                        }
                        const row = await api<Answer>("/onboarding/facts/" + a.field_id, "PUT", { field_id: a.field_id, permission_scope: scope });
                        setAnswers((prev) => ({ ...prev, [a.field_id]: row }));
                      })}>{scope === "twin" ? "Twin only" : scope === "shareable" ? "Shareable" : "Private"}</button>
                    ))}
                  </div>
                </article>
              ))}
              <button className="btn primary" onClick={next}>Continue</button>
            </div>
          )}
          {id === "permissions" && schema && (
            <div className="studio-perms">
              {schema.consents.map((c) => (
                <label key={c.id} className="switch big">
                  <input type="checkbox" checked={!!grants[c.id]} onChange={(e) => setGrants({ ...grants, [c.id]: e.target.checked })} />
                  <i />
                  <span>{c.label}</span>
                </label>
              ))}
              <button className="btn primary" disabled={busy} onClick={finishPermissions}>Save and finish</button>
            </div>
          )}
          {id === "ready" && (
            <div className="studio-note">
              <p>{ready === "ready" ? "Matching and virtual dates are on, inside the permissions you set." : ready === "local_only" ? "Your twin stays on this device’s rules. Outside processing is off." : "Your twin stays private. You can turn matching on later in Settings."}</p>
              {fidelity && <p className="fine">{fidelity}</p>}
              <button className="btn primary" onClick={onClose}><Check size={16} /> Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CoachCard({ trigger }: { trigger: string }) {
  const { perform } = useStore();
  const [field, setField] = useState<Field | null>(null);
  const [hidden, setHidden] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api<Schema>("/onboarding/schema").then(async (s) => {
      const state = await api<{ answers: Answer[] }>("/onboarding");
      const answered = new Set(state.answers.map((a) => a.field_id));
      const nextField = s.fields.find((f) => {
        if (answered.has(f.field_id)) return false;
        if (trigger === "agent") return f.field_id.startsWith("S0");
        return f.trigger === trigger;
      });
      setField(nextField ?? null);
    }).catch(() => setField(null));
  }, [trigger, tick]);
  if (!field || hidden) return null;
  return (
    <section className="glass card coach-card">
      <p className="eyebrow">Optional · {field.field_id}</p>
      <h3>{field.prompt}</h3>
      <div className="w-chips">
        {field.options.map((o) => (
          <button key={o.id} type="button" onClick={() => perform(async () => {
            await api("/onboarding/answers/" + field.field_id, "PUT", { option_ids: [o.id], status: "answered" });
            setHidden(false);
            setTick((n) => n + 1);
          })}>{o.label}</button>
        ))}
      </div>
      <button className="link" onClick={() => perform(async () => {
        await api("/onboarding/answers/" + field.field_id, "PUT", { option_ids: [], status: "skipped" });
        setHidden(true);
      })}>Skip for now</button>
    </section>
  );
}
