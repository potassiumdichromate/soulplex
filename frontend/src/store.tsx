import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, STATIC, setCsrf, type Candidate, type Experience, type Insights, type Memory, type User } from "./api";

type Toast = { id: number; text: string; tone: "ok" | "err" };

type Store = {
  user: User | null;
  mode: string;
  loading: boolean;
  busy: boolean;
  memories: Memory[];
  candidates: Candidate[];
  blocker: string;
  scenes: Experience[];
  insights: Insights | null;
  messages: { role: string; content: string; id?: string }[];
  page: string;
  go: (p: string, arg?: string) => void;
  arg: string;
  applySession: (s: any) => void;
  setUser: (u: User | null) => void;
  load: () => Promise<void>;
  loadScenes: () => Promise<void>;
  perform: (fn: () => Promise<void>, ok?: string) => Promise<boolean>;
  notify: (text: string, tone?: "ok" | "err") => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  logout: () => Promise<void>;
  setup: number | null;
  openSetup: (step?: number | null) => void;
  /** Signed-out visitors can watch the islands; signing in is needed to send an agent. */
  guest: boolean;
  setGuest: (g: boolean) => void;
  wantAuth: "" | "login" | "register";
  askAuth: (kind: "" | "login" | "register") => void;
};

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

function readHash() {
  if (STATIC) return ["home", ""];
  const h = location.hash.replace(/^#\/?/, "");
  if (!h || h.startsWith("verify=") || h.startsWith("reset=")) return ["home", ""];
  const [p, a = ""] = h.split("/");
  return [p, decodeURIComponent(a)];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState("demo");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [blocker, setBlocker] = useState("");
  const [scenes, setScenes] = useState<Experience[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [messages, setMessages] = useState<Store["messages"]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [[page, arg], setRoute] = useState<string[]>(readHash());
  const epoch = useRef(0);
  const [setup, setSetup] = useState<number | null>(null);
  const openSetup = useCallback((step: number | null = 0) => setSetup(step), []);
  const [guest, setGuest] = useState(false);
  const [wantAuth, setWantAuth] = useState<"" | "login" | "register">("");
  const askAuth = useCallback((kind: "" | "login" | "register") => {
    setWantAuth(kind);
    setGuest(false);
  }, []);

  useEffect(() => {
    const on = () => setRoute(readHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((p: string, a = "") => {
    // The hosted demo keeps routes in memory; the full app uses #/page/arg links.
    if (STATIC) setRoute([p, a]);
    else location.hash = "/" + p + (a ? "/" + encodeURIComponent(a) : "");
    window.scrollTo({ top: 0 });
    document.querySelector(".panel-scroll")?.scrollTo({ top: 0 });
  }, []);

  const notify = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    // notifications stay until the person swipes them away (or taps ×); at most three stack up
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const load = useCallback(async () => {
    const e = epoch.current;
    const [mm, cc, ss, chat, ins] = await Promise.all([
      api("/memories"),
      api("/candidates"),
      api("/scenes"),
      api("/chat"),
      api("/insights"),
    ]);
    if (e !== epoch.current) return;
    setMemories(mm);
    setCandidates(cc.candidates);
    setBlocker(cc.blocked ? cc.reason : "");
    setScenes(ss);
    setInsights(ins);
    setMessages(chat.messages.length ? chat.messages : [{ role: "assistant", content: chat.opening }]);
  }, []);

  const loadScenes = useCallback(async () => {
    const e = epoch.current;
    const ss = await api("/scenes");
    if (e === epoch.current) setScenes(ss);
  }, []);

  const applySession = useCallback((s: any) => {
    epoch.current++;
    setMemories([]);
    setCandidates([]);
    setScenes([]);
    setMessages([]);
    setInsights(null);
    setUser(s.user);
    setGuest(false);
    setCsrf(s.csrf);
    setMode(s.mode);
  }, []);

  const perform = useCallback(
    async (fn: () => Promise<void>, ok?: string) => {
      setBusy(true);
      try {
        await fn();
        if (ok) notify(ok);
        return true;
      } catch (e) {
        notify((e as Error).message, "err");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const logout = useCallback(async () => {
    await api("/auth/logout", "POST").catch(() => {});
    epoch.current++;
    setUser(null);
    setRoute(["home", ""]);
    if (!STATIC) location.hash = "";
  }, []);

  // boot
  useEffect(() => {
    (async () => {
      try {
        const h = await api("/health");
        setMode(h.mode);
        const hash = location.hash;
        if (hash.startsWith("#verify=")) {
          history.replaceState({}, "", location.pathname);
          await api("/auth/verify-email", "POST", { token: decodeURIComponent(hash.slice(8)) });
          notify("Your email is verified. Sign in to continue.");
        }
      } catch (e) {
        notify((e as Error).message, "err");
      } finally {
        const s = await api("/me").catch(() => null);
        if (s) applySession(s);
        setLoading(false);
      }
    })();
  }, [applySession, notify]);

  useEffect(() => {
    if (user) load().catch((e) => notify(e.message, "err"));
  }, [user?.id, load, notify]);

  // poll while agents are out
  const active = scenes.some((s) => s.status === "queued" || s.status === "running");
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => loadScenes().catch(() => {}), active ? 2500 : 9000);
    return () => clearInterval(id);
  }, [user?.id, active, loadScenes]);

  // tell the person when their agent comes back or a match becomes mutual
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!user) {
      seen.current = null;
      return;
    }
    const prev = seen.current;
    const next = new Map(scenes.map((s) => [s.id, s.status + (s.mutual ? ":mutual" : "")]));
    if (prev) {
      for (const s of scenes) {
        const before = prev.get(s.id);
        if (before === undefined && s.incoming)
          notify(
            s.status === "invited"
              ? `💌 ${s.partner.name}'s agent invited yours on a date. Accept or decline in Dates.`
              : `💌 ${s.partner.name}'s agent invited yours on a date. Your agent said yes and is on the way.`,
          );
        if (before === undefined || before === next.get(s.id)) continue;
        if (s.mutual && !before.endsWith(":mutual")) notify(`It's mutual! You and ${s.partner.name} both want to meet 💞`);
        else if (s.status === "completed" && !before.startsWith("completed"))
          notify(`Your agent is back from a date with ${s.partner.name}: ${s.output.assessment?.score ?? "?"}% resonance.`);
      }
    }
    seen.current = next;
  }, [scenes, user?.id, notify]);

  // whenever a date finishes (or a decision changes), refresh what the agent has learned
  const signature = scenes.map((s) => s.id + s.status + s.mine.decision + s.stale).join("|");
  useEffect(() => {
    if (!user) return;
    const e = epoch.current;
    api("/insights")
      .then((ins) => e === epoch.current && setInsights(ins))
      .catch(() => {});
  }, [user?.id, signature]);

  return (
    <Ctx.Provider
      value={{
        user,
        mode,
        loading,
        busy,
        memories,
        candidates,
        blocker,
        scenes,
        insights,
        messages,
        page,
        arg,
        go,
        applySession,
        setUser,
        load,
        loadScenes,
        perform,
        notify,
        toasts,
        dismiss,
        logout,
        setup,
        openSetup,
        guest,
        setGuest,
        wantAuth,
        askAuth,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
