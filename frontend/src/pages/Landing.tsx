import { useEffect, useState } from "react";
import { ArrowRight, X, Sparkles, Coffee, HeartHandshake, Brain, ShieldCheck, Eye, Lock } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Brand, Wisp, Ring, Meter } from "../ui";
import { withWorld } from "../world/WorldCanvas";
import { faceUrl, headUrl, bodyColors, type FaceSpec } from "../faces";
import howArt from "../assets/landing/how.webp";

const L: Record<string, [number, Partial<FaceSpec>]> = {
  Maya: [330, { skin: 2, hair: 1, hairColor: 1, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 3, outfit: 0 }],
  Arjun: [195, { skin: 3, hair: 0, hairColor: 0, eyes: 0, brows: 1, mouth: 1, facial: 1, accessory: 0, outfit: 3 }],
  Leila: [45, { skin: 2, hair: 8, hairColor: 0, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 0, outfit: 3 }],
  Karan: [140, { skin: 2, hair: 4, hairColor: 0, eyes: 2, brows: 1, mouth: 1, facial: 0, accessory: 1, outfit: 2 }],
  Sara: [270, { skin: 1, hair: 3, hairColor: 3, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 3, outfit: 1 }],
  Vikram: [15, { skin: 4, hair: 7, hairColor: 0, eyes: 1, brows: 1, mouth: 1, facial: 1, accessory: 0, outfit: 2 }],
};
const lface = (n: string) => ({ kind: "illustrated" as const, spec: L[n][1] });

const blank = {
  name: "",
  age: 28,
  city: "Dubai",
  gender: "woman",
  seeking: ["man"],
  age_min: 25,
  age_max: 38,
  intent: "relationship",
  contact: "",
  discovery: false,
};

export function Landing() {
  const { mode, busy, perform, applySession, notify, go, openSetup, setGuest, wantAuth, askAuth } = useStore();
  const [sheet, setSheet] = useState<"" | "login" | "register" | "reset">("");
  const [resetToken, setResetToken] = useState("");
  const [f, setF] = useState({ ...blank, email: "", password: "", consent: false, invite_code: "" });

  useEffect(() => {
    withWorld((w) => {
      w.setDate(null);
      w.setMode("landing");
      w.setAgents(
        Object.entries(L).map(([name, [hue]], i) => ({ id: "l" + i, name, hue, face: headUrl(lface(name), name, hue), ...bodyColors(lface(name), name, hue) })),
      );
    });
    // once the hero is scrolled away the islands are only a backdrop: let them redraw at half rate
    const el = document.querySelector(".landing") as HTMLElement | null;
    const onScroll = () => {
      const y = el && el.scrollHeight > el.clientHeight + 5 ? el.scrollTop : scrollY;
      withWorld((w) => (w.throttle = y > innerHeight * 0.6));
    };
    el?.addEventListener("scroll", onScroll, { passive: true });
    addEventListener("scroll", onScroll, { passive: true });
    if (wantAuth) {
      setSheet(wantAuth);
      askAuth("");
    }
    if (location.hash.startsWith("#reset=")) {
      setResetToken(decodeURIComponent(location.hash.slice(7)));
      setSheet("reset");
      history.replaceState({}, "", location.pathname);
    }
    return () => {
      el?.removeEventListener("scroll", onScroll);
      removeEventListener("scroll", onScroll);
      withWorld((w) => (w.throttle = false));
    };
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet("");
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [sheet]);

  const demo = (p: string) =>
    perform(async () => {
      applySession(await api("/auth/demo/" + p, "POST"));
      go(p === "operator" ? "operator" : "home");
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    perform(async () => {
      if (sheet === "reset") {
        if (resetToken) {
          await api("/auth/reset-password", "POST", { token: resetToken, password: f.password });
          setResetToken("");
          setSheet("login");
          notify("Password changed. Please sign in again.");
        } else {
          await api("/auth/request-reset", "POST", { email: f.email });
          notify("If that account exists, a reset link has been sent.");
        }
        return;
      }
      const body = sheet === "login" ? { email: f.email, password: f.password } : f;
      const s = await api("/auth/" + (sheet === "login" ? "login" : "register"), "POST", body);
      applySession(s);
      if (sheet === "register") {
        go("home");
        openSetup(0);
        notify(
          mode === "demo"
            ? "Welcome! Start by teaching your agent who you are."
            : "Check your email for a verification link, then teach your agent.",
        );
      } else go("home");
    });
  };

  return (
    <div className="landing">
      <header className="landing-top">
        <Brand />
        <nav>
          <a href="#how" className="nav-extra">How it works</a>
          <a href="#learn" className="nav-extra">What it learns</a>
          <a href="#trust" className="nav-extra">Trust</a>
          <button className="link" onClick={() => setGuest(true)}>
            Watch dates
          </button>
          <button className="btn ghost sm" onClick={() => setSheet("login")}>
            Sign in
          </button>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
        <span className="eyebrow">
          <Sparkles size={14} /> Matchmaking, with an agent that learns you
        </span>
        <h1>
          Your agent goes on the <em>first date.</em>
        </h1>
        <p className="lead">
          Teach your AI twin who you really are. It meets other people's agents for coffee, learns how you'd click,
          and only brings you the connections worth your time. Then you meet them for real.
        </p>
        <div className="hero-cta">
          <button className="btn primary lg" onClick={() => setSheet("register")}>
            Create my agent <ArrowRight size={18} />
          </button>
          <button className="btn ghost lg watch-cta" onClick={() => setGuest(true)}>
            <Eye size={20} /> <span>Watch live dates, no sign-up</span> <ArrowRight size={18} className="end" />
          </button>
          {mode === "demo" && (
            <div className="demo-pick">
              <span>or explore as</span>
              <button className="persona" disabled={busy} onClick={() => demo("maya")}>
                <Wisp hue={330} size={28} face={lface("Maya")} /> Maya
              </button>
              <button className="persona" disabled={busy} onClick={() => demo("arjun")}>
                <Wisp hue={195} size={28} face={lface("Arjun")} /> Arjun
              </button>
            </div>
          )}
        </div>
        </div>
        <div className="hero-side" aria-hidden="true" />
        <div className="hero-stats">
          <div>
            <strong>8</strong>
            <span>turns per agent date</span>
          </div>
          <div>
            <strong>5</strong>
            <span>resonance dimensions</span>
          </div>
          <div>
            <strong>0</strong>
            <span>contacts shared until both say yes</span>
          </div>
        </div>
      </section>


      <section id="how" className="land-section land-card how">
        <img className="how-art" src={howArt} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        <div className="how-head">
          <span className="eyebrow">How it works</span>
          <h2>
            Three steps from <em>“tell me about you”</em> to a real meeting.
          </h2>
        </div>
        <div className="lp-steps">
          <article className="glass step">
            <span className="step-n">01</span>
            <Brain />
            <h3>Teach your agent</h3>
            <p>
              Chat with it or add behaviour traits directly: your values, how you handle disagreement, your ideal
              weekend. You approve everything it remembers.
            </p>
          </article>
          <article className="glass step">
            <span className="step-n">02</span>
            <Coffee />
            <h3>It goes on dates</h3>
            <p>
              Your agent walks to the café, bookshop or garden and has a real conversation with another person's
              agent, using only what each of you chose to share.
            </p>
          </article>
          <article className="glass step">
            <span className="step-n">03</span>
            <HeartHandshake />
            <h3>You decide to meet</h3>
            <p>
              Replay the date, see your resonance score and add your own words. Contacts unlock only when
              <b> both humans</b> accept.
            </p>
          </article>
        </div>
      </section>

      <section id="learn" className="land-section land-card split">
        <div>
          <span className="eyebrow">Your agent learns</span>
          <h2>
            Every date teaches it <em>something about you, too.</em>
          </h2>
          <p className="lead">
            After each date your agent reflects: what it learned about them, what it noticed about how you come
            across, and one gentle thing to work on. Over time your Insights page shows your patterns: where you
            resonate, where you clash, and how to show up better.
          </p>
          <ul className="ticks">
            <li>Resonance across values, lifestyle, communication, future and interests</li>
            <li>Private reflections that only you see</li>
            <li>Growth tips grounded in what you actually shared</li>
          </ul>
        </div>
        <div className="glass mock-insight tilt">
          <div className="mock-head">
            <Wisp hue={330} size={44} self face={lface("Maya")} />
            <div>
              <strong>After the café with Karan</strong>
              <span>Slow Sunday Café · 6 turns</span>
            </div>
          </div>
          <div className="mock-body">
            <Ring value={82} size={120} label="resonance" />
            <div className="mock-bars">
              {[
                ["Values", 91],
                ["Lifestyle", 86],
                ["Communication", 88],
                ["Future", 64],
                ["Interests", 79],
              ].map(([k, v]) => (
                <label key={k}>
                  <span>{k}</span>
                  <Meter value={+v} />
                </label>
              ))}
            </div>
          </div>
          <p className="mock-tip">
            <Sparkles size={14} /> <b>Growth:</b> your agent couldn't speak about your next few years. Sharing your
            intentions saves both of you time.
          </p>
        </div>
      </section>

      <section id="trust" className="land-section land-card trust">
        <div className="trust-head">
          <span className="eyebrow">Trust by design</span>
          <h2>
            Your agent is your identity here, <em>so you stay in control.</em>
          </h2>
        </div>
        <div className="lp-steps trust-cards">
          <article className="glass step">
            <Eye />
            <h3>You approve its memory</h3>
            <p>Nothing the AI proposes is used until you approve it. Mark each trait private or shareable.</p>
          </article>
          <article className="glass step">
            <Lock />
            <h3>No contact until mutual yes</h3>
            <p>Agents cannot exchange contact details. Yours is revealed only after both people accept.</p>
          </article>
          <article className="glass step">
            <ShieldCheck />
            <h3>Verified, adults only</h3>
            <p>Discovery opens after verification. Block, report, export or delete your data any time.</p>
          </article>
        </div>
        <button className="btn primary lg trust-cta" onClick={() => setSheet("register")}>
          Create my agent <ArrowRight size={18} />
        </button>
        <footer className="land-foot">
          <Brand small />
          <span>Independent Web2 pilot · Dubai &amp; Delhi NCR · Demo uses fictional people.</span>
          {mode === "demo" && (
            <button className="link" onClick={() => demo("operator")}>
              Operator view
            </button>
          )}
        </footer>
      </section>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet("")}>
          <form className="glass sheet" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="icon-btn close" aria-label="Close" onClick={() => setSheet("")}>
              <X size={18} />
            </button>
            <Brand small />
            <h2>
              {sheet === "login" ? "Welcome back." : sheet === "reset" ? "Reset your password." : "Create your agent."}
            </h2>
            {sheet !== "reset" && (
              <div className="seg">
                <button type="button" className={sheet === "login" ? "on" : ""} onClick={() => setSheet("login")}>
                  Sign in
                </button>
                <button type="button" className={sheet === "register" ? "on" : ""} onClick={() => setSheet("register")}>
                  Create account
                </button>
              </div>
            )}
            {sheet === "register" && (
              <>
                <label>
                  First name or nickname
                  <input required maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </label>
                <div className="row2">
                  <label>
                    Age
                    <input
                      type="number"
                      min={18}
                      max={100}
                      required
                      value={f.age}
                      onChange={(e) => setF({ ...f, age: +e.target.value })}
                    />
                  </label>
                  <label>
                    City
                    <select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
                      <option>Dubai</option>
                      <option>Delhi NCR</option>
                    </select>
                  </label>
                </div>
                <div className="row2">
                  <label>
                    I am
                    <select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
                      <option value="woman">Woman</option>
                      <option value="man">Man</option>
                      <option value="nonbinary">Nonbinary</option>
                      <option value="self-described">Self-described</option>
                    </select>
                  </label>
                  <label>
                    Interested in
                    <select value={f.seeking[0]} onChange={(e) => setF({ ...f, seeking: [e.target.value] })}>
                      <option value="man">Men</option>
                      <option value="woman">Women</option>
                      <option value="nonbinary">Nonbinary people</option>
                      <option value="self-described">Self-described people</option>
                    </select>
                  </label>
                </div>
              </>
            )}
            {(sheet !== "reset" || !resetToken) && (
              <label>
                Email
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={f.email}
                  onChange={(e) => setF({ ...f, email: e.target.value })}
                />
              </label>
            )}
            {(sheet !== "reset" || !!resetToken) && (
              <label>
                Password
                <input
                  type="password"
                  required
                  minLength={sheet === "register" || resetToken ? 12 : 1}
                  autoComplete={sheet === "register" ? "new-password" : "current-password"}
                  value={f.password}
                  onChange={(e) => setF({ ...f, password: e.target.value })}
                />
                {sheet === "register" && <small>At least 12 characters.</small>}
              </label>
            )}
            {sheet === "register" && mode !== "demo" && (
              <label>
                Pilot invitation code
                <input required value={f.invite_code} onChange={(e) => setF({ ...f, invite_code: e.target.value })} />
              </label>
            )}
            {sheet === "register" && (
              <label className="check">
                <input
                  type="checkbox"
                  required
                  checked={f.consent}
                  onChange={(e) => setF({ ...f, consent: e.target.checked })}
                />
                <span>
                  I am 18 or older. I agree to storing my profile, chat and approved memory to provide this service. In
                  live mode, text is processed by the configured AI provider.
                </span>
              </label>
            )}
            <button className="btn primary wide" disabled={busy}>
              {busy
                ? "One moment…"
                : sheet === "login"
                  ? "Enter Soulplex"
                  : sheet === "reset"
                    ? resetToken
                      ? "Save new password"
                      : "Send reset link"
                    : "Create my agent"}
              <ArrowRight size={16} />
            </button>
            {sheet === "login" && mode !== "demo" && (
              <button type="button" className="link" onClick={() => setSheet("reset")}>
                Forgot password?
              </button>
            )}
            {sheet === "reset" && (
              <button type="button" className="link" onClick={() => setSheet("login")}>
                Back to sign in
              </button>
            )}
            {mode === "demo" && sheet !== "reset" && (
              <p className="fine">Demo mode: use fictional details only.</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
