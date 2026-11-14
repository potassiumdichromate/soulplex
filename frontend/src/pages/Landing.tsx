import { useEffect, useState } from "react";
import { ArrowRight, X, Sparkles, Coffee, HeartHandshake, Brain, ShieldCheck, Eye, Lock } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Brand, Wisp, PasswordInput } from "../ui";
import { withWorld } from "../world/WorldCanvas";
import { CityPicker } from "../CityPicker";
import { headUrl, bodyColors, type FaceSpec } from "../faces";
import howArt from "../assets/landing/how.webp";

const L: Record<string, [number, Partial<FaceSpec>]> = {
  Maya: [330, { skin: 2, hair: 1, hairColor: 1, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 3, outfit: 0 }],
  Arjun: [195, { skin: 3, hair: 0, hairColor: 0, eyes: 0, brows: 1, mouth: 1, facial: 1, accessory: 0, outfit: 3 }],
  Leila: [45, { skin: 2, hair: 8, hairColor: 0, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 0, outfit: 3 }],
  Karan: [140, { skin: 2, hair: 4, hairColor: 0, eyes: 2, brows: 1, mouth: 1, facial: 0, accessory: 1, outfit: 2 }],
  Sara: [270, { skin: 1, hair: 3, hairColor: 3, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 3, outfit: 1 }],
  Vikram: [15, { skin: 4, hair: 5, hairColor: 0, eyes: 0, brows: 1, mouth: 1, facial: 1, accessory: 0, outfit: 2 }],
};
const lface = (n: string) => ({ kind: "illustrated" as const, spec: L[n][1] });

const blank = {
  name: "",
  city: "",
  gender: "woman",
  age_min: 25,
  age_max: 38,
  intent: "relationship",
  contact: "",
  discovery: false,
};

export function Landing() {
  const { busy, perform, applySession, notify, go, openSetup, setGuest, wantAuth, askAuth } = useStore();
  const [sheet, setSheet] = useState<"" | "login" | "register" | "reset">("");
  const [resetToken, setResetToken] = useState("");
  const [f, setF] = useState({ ...blank, email: "", password: "", consent: false });

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
        notify("Check your email for a verification link, then help your twin get to know you.");
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
            Example dates
          </button>
          <button className="btn ghost sm" onClick={() => setSheet("login")}>
            Sign in
          </button>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
        <span className="eyebrow">
          <Sparkles size={14} /> Soulplex · Meet before you meet
        </span>
        <h1>
          Your twin goes on the <em>first date.</em>
        </h1>
        <p className="hero-plain">
          An AI version of you has a short, private chat with someone else's twin. If it goes well, you both decide
          whether to meet.
        </p>
        <p className="lead">
          Answer a few quick questions and your twin knows the basics. It only says what you approve, nothing is
          shared without your yes, and contact details unlock only when both people accept.
        </p>
        <div className="hero-cta">
          <button className="btn primary lg" onClick={() => setSheet("register")}>
            Create my twin <ArrowRight size={18} />
          </button>
          <button className="link watch-cta-plain" onClick={() => setGuest(true)}>
            <Eye size={16} /> Watch an example date (fictional twins, no sign-up)
          </button>
        </div>
        </div>
        <div className="hero-side" aria-hidden="true" />
        <div className="hero-stats">
          <div>
            <strong>~8</strong>
            <span>messages in a twin date</span>
          </div>
          <div>
            <strong>2 min</strong>
            <span>of tap-to-answer setup</span>
          </div>
          <div>
            <strong>0</strong>
            <span>contact details shared until you both say yes</span>
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
            <h3>Help your twin get to know you</h3>
            <p>
              Tap through easy four-answer questions: your weekends, what you value, how you text. You can change or
              delete any answer, and everything starts private.
            </p>
          </article>
          <article className="glass step">
            <span className="step-n">02</span>
            <Coffee />
            <h3>It goes on dates</h3>
            <p>
              Your twin walks to the café, bookshop or garden and chats with another person's twin, using only what
              each of you chose to share.
            </p>
          </article>
          <article className="glass step">
            <span className="step-n">03</span>
            <HeartHandshake />
            <h3>You decide to meet</h3>
            <p>
              Replay the date, see what you actually have in common, and add your own words. Contacts unlock only when
              <b> both humans</b> accept.
            </p>
          </article>
        </div>
      </section>

      <section id="learn" className="land-section land-card split">
        <div>
          <span className="eyebrow">Your twin learns</span>
          <h2>
            Every date teaches it <em>something about you, too.</em>
          </h2>
          <p className="lead">
            After each date your twin tells you what it learned about them, where you may connect, and one gentle
            thing to try. You can correct anything it got wrong.
          </p>
          <ul className="ticks">
            <li>Where you may connect: values, lifestyle, conversation, plans and interests</li>
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
            <div className="why-click">
              <strong>Why you might click</strong>
              <p>You both mentioned kindness, from facts each of you approved.</p>
              <p className="fine">A guidance score does not decide the introduction.</p>
            </div>
            <div className="mock-bars">
              <p>“I value kindness and honest communication.”</p>
              <p className="fine">Quoted from an approved fact, not a generated trait.</p>
            </div>
          </div>
          <p className="mock-tip">
            <Sparkles size={14} /> <b>Example:</b> your twin couldn't speak about your next few years. Sharing your
            intentions saves both of you time.
          </p>
        </div>
      </section>

      <section id="trust" className="land-section land-card trust">
        <div className="trust-head">
          <span className="eyebrow">Trust by design</span>
          <h2>
            Your twin represents what you approve, <em>so you stay in control.</em>
          </h2>
        </div>
        <div className="lp-steps trust-cards">
          <article className="glass step">
            <Eye />
            <h3>You approve its memory</h3>
            <p>Nothing the AI proposes is used until you approve it. Everything starts private; you choose what may be shared.</p>
          </article>
          <article className="glass step">
            <Lock />
            <h3>No contact until mutual yes</h3>
            <p>Twins cannot exchange contact details. Yours is revealed only after both people accept.</p>
          </article>
          <article className="glass step">
            <ShieldCheck />
            <h3>For adults, with email verification</h3>
            <p>Members confirm they are 18+ and verify their email before dating. Block, report, export or delete your data any time.</p>
          </article>
        </div>
        <button className="btn primary lg trust-cta" onClick={() => setSheet("register")}>
          Create my twin <ArrowRight size={18} />
        </button>
        <footer className="land-foot">
          <Brand small />
          <span>Independent Web2 pilot · Dubai &amp; Delhi NCR</span>
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
              {sheet === "login" ? "Welcome back." : sheet === "reset" ? "Reset your password." : "Create your twin."}
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
                {/* age and who they'd like to meet are asked in onboarding, right after sign-up */}
                <div className="row2">
                  <CityPicker city={f.city} onChange={(city) => setF({ ...f, city })} />
                </div>
                <label>
                  I am
                  <select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
                    <option value="woman">Woman</option>
                    <option value="man">Man</option>
                    <option value="nonbinary">Non-binary</option>
                    <option value="self-described">I describe my gender another way</option>
                  </select>
                </label>
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
                <PasswordInput
                  required
                  minLength={sheet === "register" || resetToken ? 12 : 1}
                  autoComplete={sheet === "register" ? "new-password" : "current-password"}
                  value={f.password}
                  onChange={(e) => setF({ ...f, password: e.target.value })}
                />
                {sheet === "register" && <small>At least 12 characters.</small>}
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
                  I am 18 or older and agree to Soulplex storing my profile and the answers I approve to run the service.
                  Matching, virtual dates, sharing and research are separate choices that all start off.
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
                    : "Create my twin"}
              <ArrowRight size={16} />
            </button>
            {sheet === "login" && (
              <button type="button" className="link" onClick={() => setSheet("reset")}>
                Forgot password?
              </button>
            )}
            {sheet === "reset" && (
              <button type="button" className="link" onClick={() => setSheet("login")}>
                Back to sign in
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
