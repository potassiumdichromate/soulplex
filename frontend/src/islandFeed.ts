import { useEffect, useState } from "react";
import { api, VENUES, type IslandActivity, type LiveDate, type LiveAgent } from "./api";
import { headUrl, bodyColors } from "./faces";
import { withWorld } from "./world/WorldCanvas";

/*
 * One shared poll of /api/island. It keeps the 3D islands populated on every page
 * and feeds the "Live on the islands" lists.
 */
let data: IslandActivity | null = null;
const subs = new Set<(d: IslandActivity | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let source = "/island";

const agentInfo = (x: LiveAgent, seed: string) => ({
  id: seed,
  name: x.name,
  hue: x.hue,
  face: headUrl(x.face ?? undefined, seed, x.hue, x.gender),
  ...bodyColors(x.face ?? undefined, seed, x.hue, x.gender),
});

async function refresh() {
  try {
    data = await api<IslandActivity>(source);
  } catch {
    return;
  }
  subs.forEach((f) => f(data));
  const list = data.live.map((l) => ({ id: l.id, type: l.type, spot: l.spot, started: l.started, a: agentInfo(l.a, l.id + ":a"), b: agentInfo(l.b, l.id + ":b") }));
  withWorld((w) => w.setLive(list));
}

/** Signed-in members use /island; visitors use /public/island. */
export function startIslandFeed(path = "/island") {
  if (timer && path === source) return;
  if (timer) clearInterval(timer);
  source = path;
  refresh();
  timer = setInterval(refresh, 4000);
}

export function stopIslandFeed() {
  if (timer) clearInterval(timer);
  timer = null;
  data = null;
  withWorld((w) => w.setLive([]));
}

export function useIslandActivity() {
  const [d, setD] = useState(data);
  useEffect(() => {
    subs.add(setD);
    setD(data);
    return () => void subs.delete(setD);
  }, []);
  return d;
}

/** "Coffee Cove · Terrace table" */
export function placeOf(type: string, spot?: number | null) {
  const t = VENUES[type];
  if (!t) return "";
  return spot == null ? t.island : `${t.island} · ${t.spots[spot] ?? t.spots[0]}`;
}

export const stepTitle = (l: LiveDate) => (l.status === "queued" ? "Arriving" : VENUES[l.type]?.stages[Math.min(3, l.step)]?.title ?? "");
