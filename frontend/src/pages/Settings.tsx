import { useEffect, useState } from "react";
import { Download, Trash2, LogOut, Mail, Save, ShieldCheck, Ban, Check, RotateCcw } from "lucide-react";
import { api, STATIC } from "../api";
import { useStore } from "../store";
import { Panel, Head } from "./Shell";
import { ProfileEditor } from "./ProfileEditor";
import { CityPicker } from "../CityPicker";

const GENDERS = [
  ["woman", "Women"],
  ["man", "Men"],
  ["nonbinary", "Non-binary people"],
  ["self-described", "People who self-describe their gender"],
];

export function Settings() {
  const { user, setUser, perform, busy, load, logout, notify } = useStore();
  const [p, setP] = useState({ ...user! });
  const [pw, setPw] = useState("");
  const [delAsk, setDelAsk] = useState(false);
  const [editor, setEditor] = useState(false);
  const [perms, setPerms] = useState<{ id: string; label: string }[]>([]);
  const [grants, setGrants] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api<{ consents: { id: string; label: string }[] }>("/onboarding/schema").then((s) => setPerms(s.consents)).catch(() => {});
    api<{ grants: Record<string, boolean> }>("/privacy/permissions").then((p) => setGrants(p.grants)).catch(() => {});
  }, [user?.id]);
  useEffect(() => setP({ ...user! }), [user]);
  const set = (k: string, v: unknown) => setP({ ...p, [k]: v });
  return (
    <Panel wide>
      <Head eyebrow="Settings" title={<>The practical <em>things.</em></>} />
      <form
        className="glass card form-card"
        onSubmit={(e) => {
          e.preventDefault();
          perform(async () => {
            const { name, age, city, gender, seeking, age_min, age_max, intent, contact, discovery } = p;
            const updated = await api("/profile", "PUT", {
              name,
              age,
              city,
              gender,
              seeking,
              age_min,
              age_max,
              intent,
              contact,
              discovery,
            });
            setUser(updated);
            await load();
          }, "Saved. Earlier dates are refreshed so nothing outdated unlocks contact.");
        }}
      >
        <h3>Profile &amp; preferences</h3>
        <div className="row2">
          <label>
            Name
            <input required maxLength={40} value={p.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            Age
            <input type="number" min={18} max={100} value={p.age} onChange={(e) => set("age", +e.target.value)} />
          </label>
        </div>
        <div className="row2">
          <CityPicker city={p.city} onChange={(c) => set("city", c)} />
        </div>
        <div className="row2">
          <label>
            I am
            <select value={p.gender} onChange={(e) => set("gender", e.target.value)}>
              <option value="woman">Woman</option>
              <option value="man">Man</option>
              <option value="nonbinary">Non-binary</option>
              <option value="self-described">I describe my gender another way</option>
              <option value="prefer_not">Prefer not to say</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Interested in</legend>
          <div className="pills">
            {GENDERS.map(([v, l]) => (
              <button
                type="button"
                key={v}
                className={p.seeking.includes(v) ? "on" : ""}
                onClick={() => {
                  const s = p.seeking.includes(v) ? p.seeking.filter((x) => x !== v) : [...p.seeking, v];
                  if (s.length) set("seeking", s);
                }}
              >
                {p.seeking.includes(v) && <Check size={12} />} {l}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="row3">
          <label>
            Age from
            <input type="number" min={18} max={100} value={p.age_min} onChange={(e) => set("age_min", +e.target.value)} />
          </label>
          <label>
            to
            <input type="number" min={18} max={100} value={p.age_max} onChange={(e) => set("age_max", +e.target.value)} />
          </label>
          <label>
            Looking for
            <select value={p.intent} onChange={(e) => set("intent", e.target.value)}>
              <option value="relationship">A relationship</option>
              <option value="marriage">Marriage</option>
              <option value="dating">Dating</option>
            </select>
          </label>
        </div>
        <label>
          Private contact for mutual introductions
          <input
            maxLength={160}
            placeholder="e.g. phone, email or Instagram handle"
            value={p.contact}
            onChange={(e) => set("contact", e.target.value)}
          />
          <small>Never given to agents. Revealed only after you both accept.</small>
        </label>
        <label className="switch big">
          <input type="checkbox" checked={p.discovery} onChange={(e) => set("discovery", e.target.checked)} />
          <i />
          <span>
            <b>Discovery</b>: let my agent meet other agents and be found
            {!user!.email_verified && " (opens once your email is verified)"}
          </span>
        </label>
        <button className="btn primary" disabled={busy}>
          <Save size={16} /> Save changes
        </button>
      </form>

      <section className="glass card">
        <h3>Twin Permission Center</h3>
        <p className="fine">Optional uses stay off until you turn them on. Revoking stops new virtual dates.</p>
        {perms.map((c) => (
          <label key={c.id} className="switch big">
            <input type="checkbox" checked={!!grants[c.id]} onChange={(e) => setGrants({ ...grants, [c.id]: e.target.checked })} />
            <i />
            <span>{c.label}</span>
          </label>
        ))}
        <div className="btn-row">
          <button className="btn primary sm" type="button" disabled={busy} onClick={() => perform(async () => {
            const saved = await api<{ grants: Record<string, boolean> }>("/privacy/permissions", "PUT", { grants });
            setGrants(saved.grants);
          }, "Permissions saved.")}>Save permissions</button>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => perform(async () => {
            await api("/privacy/revoke", "POST");
            const saved = await api<{ grants: Record<string, boolean> }>("/privacy/permissions");
            setGrants(saved.grants);
            await load();
          }, "Future sharing and virtual dates are stopped.")}>Withdraw consent</button>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => perform(async () => {
            const status = await api<{ identity_status: string }>("/trust/identity", "POST");
            notify(status.identity_status === "verified" ? "Identity is already verified." : "Identity check requested. An operator reviews it.");
          })}>Request identity check</button>
          <button className="btn ghost sm" type="button" onClick={() => setEditor(true)}>Edit saved lifestyle profile</button>
        </div>
        {editor && <ProfileEditor onClose={() => setEditor(false)} />}
      </section>

      <section className="glass card">
        <h3>Invitations</h3>
        <label className="switch big">
          <input
            type="checkbox"
            checked={user!.auto_accept !== false}
            onChange={(e) =>
              perform(
                async () => setUser(await api("/settings", "PUT", { auto_accept: e.target.checked })),
                e.target.checked ? "Your agent will accept invitations from matches automatically." : "You'll review each invitation before your agent goes.",
              )
            }
          />
          <i />
          <span>
            <b>Let my agent accept invitations automatically</b>
            <small className="fine"> Off unless you turn it on. Your twin will not accept a virtual date by itself.</small>
          </span>
        </label>
      </section>

      <section className="glass card">
        <h3>Who can watch my agent's dates</h3>
        <label className="switch big">
          <input
            type="checkbox"
            checked={!!user!.public_dates}
            onChange={(e) =>
              perform(
                async () => setUser(await api("/settings", "PUT", { public_dates: e.target.checked })),
                e.target.checked ? "Visitors can now watch your agent's dates." : "Your agent's dates are private again.",
              )
            }
          />
          <i />
          <span>
            <b>Let anyone watch my agent's dates</b>
            <small className="fine">
              {" "}
              Visitors, even without an account, can see your first name, your public face, where the date is and what the
              agents say. It is shown only when the other person allows it too. Your contact details and match scores are
              never shown.
            </small>
          </span>
        </label>
      </section>

      <section className="glass card">
        <h3>Account</h3>
        <p className="fine">
          {user!.email} · {user!.email_verified ? "email verified" : "email not verified"}
        </p>
        <div className="btn-row">
          {!user!.email_verified && (
            <button
              className="btn ghost sm"
              onClick={() => perform(async () => void (await api("/auth/resend-verification", "POST")), "Verification link sent.")}
            >
              <Mail size={14} /> Resend verification
            </button>
          )}
          <button
            className="btn ghost sm"
            onClick={() =>
              perform(async () => {
                const data = await api("/export");
                const text = JSON.stringify(data, null, 2);
                if (STATIC) {
                  await navigator.clipboard.writeText(text).catch(() => {
                    throw new Error("Copying isn't allowed here. Your data is still only in this browser.");
                  });
                  return;
                }
                const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = "soulplex-export.json";
                a.click();
                URL.revokeObjectURL(url);
              }, STATIC ? "Your data was copied as JSON." : "Your data export is downloading.")
            }
          >
            <Download size={14} /> {STATIC ? "Copy my data" : "Export my data"}
          </button>
          {STATIC && (
            <button
              className="btn ghost sm"
              onClick={async () => {
                const { resetDemo } = await import("../mock/server");
                resetDemo();
                await logout();
                notify("The demo was reset to its starting state.");
              }}
            >
              <RotateCcw size={14} /> Reset demo
            </button>
          )}
          <button className="btn ghost sm" onClick={logout}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </section>

      <section className="glass card danger-zone">
        <h3>Delete account</h3>
        <p className="fine">Permanently removes your profile, agent memory, chats and dates.</p>
        <div className="btn-row">
          <input
            type="password"
            aria-label="Password"
            placeholder="Your password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <button
            className="btn danger sm"
            disabled={busy || !pw}
            onClick={() => {
              if (!delAsk) return setDelAsk(true);
              perform(async () => {
                await api("/account", "DELETE", { confirmation: "DELETE", password: pw });
                notify("Your account was deleted.");
                await logout();
              });
            }}
          >
            <Trash2 size={14} /> {delAsk ? "Yes, delete permanently" : "Delete"}
          </button>
          {delAsk && (
            <button className="link" onClick={() => setDelAsk(false)}>
              Cancel
            </button>
          )}
        </div>
      </section>
    </Panel>
  );
}

export function Operator() {
  const { perform, user } = useStore();
  const [d, setD] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const refresh = async () => {
    setD(await api("/admin"));
    setUsage(await api("/admin/ai-usage?days=7").catch(() => null));
  };
  useEffect(() => {
    if (user?.role === "admin") perform(refresh);
  }, [user?.id]);
  if (user?.role !== "admin") return <Panel><p>Operator access required.</p></Panel>;
  return (
    <Panel wide>
      <Head eyebrow="Pilot operations" title={<>Keep the island <em>safe.</em></>} />
      {d && (
        <>
          <div className="kpis four">
            {Object.entries(d.metrics).map(([k, v]) => (
              <div key={k} className="glass kpi">
                <span className="big">{String(v)}</span>
                <div>
                  <strong>{k.replace(/_/g, " ")}</strong>
                </div>
              </div>
            ))}
          </div>
          {usage && (
            <section className="glass card">
              <h3>AI usage, last {usage.days} days</h3>
              <p className="fine">
                {usage.totals.calls} model calls · {usage.totals.total_tokens.toLocaleString()} tokens
                {usage.totals.reasoning_tokens > 0 && <> · {usage.totals.reasoning_tokens.toLocaleString()} spent on hidden reasoning</>}
                {usage.refused_for_balance > 0 && <> · {usage.refused_for_balance} refused for an empty balance</>}
              </p>
              {!usage.by_area.length && <p className="fine">No model calls yet.</p>}
              <div className="table">
                {usage.by_area.map((r: any) => (
                  <div key={r.area + r.feature} className="tr">
                    <span>
                      <b>{r.feature.replace(/_/g, " ")}</b> <small>{r.area}</small>
                    </span>
                    <span className="tag">{r.calls} calls</span>
                    <span className="tag">{r.total_tokens.toLocaleString()} tokens</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="glass card">
            <h3>Members</h3>
            <div className="table">
              {d.members.map((m: any) => (
                <div key={m.id} className="tr">
                  <span>
                    <b>{m.name}</b> <small>{m.city}{m.synthetic ? " · fictional" : ""}{m.flags?.length ? " · " + m.flags.join(" ") : ""}</small>
                  </span>
                  <span className={"tag " + (m.verified ? "ok" : "")}>{m.verified ? "verified" : "unverified"}</span>
                  {m.disabled && <span className="tag warn">suspended</span>}
                  <span className="tr-actions">
                    <button
                      className="btn ghost sm"
                      onClick={() =>
                        perform(async () => {
                          await api("/admin/users/" + m.id, "PATCH", { verified: !m.verified, disabled: m.disabled });
                          await refresh();
                        })
                      }
                    >
                      <ShieldCheck size={13} /> {m.verified ? "Unverify" : "Verify"}
                    </button>
                    <button
                      className="btn ghost sm"
                      onClick={() =>
                        perform(async () => {
                          await api("/admin/users/" + m.id, "PATCH", { verified: m.verified, disabled: !m.disabled });
                          await refresh();
                        })
                      }
                    >
                      <Ban size={13} /> {m.disabled ? "Restore" : "Suspend"}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="glass card">
            <h3>Reports</h3>
            {!d.reports.length && <p className="fine">No reports. 🌙</p>}
            {d.reports.map((r: any) => (
              <div key={r.id} className="tr">
                <span>{r.reason}</span>
                <span className={"tag " + (r.status === "resolved" ? "ok" : "warn")}>{r.status}</span>
                {r.status !== "resolved" && (
                  <button
                    className="btn ghost sm"
                    onClick={() =>
                      perform(async () => {
                        await api("/admin/reports/" + r.id + "/resolve", "POST");
                        await refresh();
                      })
                    }
                  >
                    Resolve
                  </button>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </Panel>
  );
}
