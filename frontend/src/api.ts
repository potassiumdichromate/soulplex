export let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export const STATIC = import.meta.env.VITE_STATIC === "1";

export async function api<T = any>(path: string, method = "GET", data?: unknown): Promise<T> {
  if (STATIC) {
    const { handle } = await import("./mock/server");
    await new Promise((r) => setTimeout(r, 90 + Math.random() * 120));
    return handle(path, method, data) as T;
  }
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string" ? result.detail : "Please check the form and try again.",
    );
  return result;
}

import type { FaceView } from "./faces";
import type { About } from "./about";
export type { FaceView };

export type User = {
  id: string;
  hue: number;
  face: FaceView;
  about: About;
  about_complete: number;
  auto_accept: boolean;
  public_dates?: boolean;
  name: string;
  email: string;
  age: number;
  city: string;
  gender: string;
  seeking: string[];
  age_min: number;
  age_max: number;
  intent: string;
  contact: string;
  discovery: boolean;
  verified: boolean;
  email_verified: boolean;
  synthetic: boolean;
  role: string;
  memory_version: number;
};
export type Memory = {
  id: string;
  category: string;
  content: string;
  source_quote: string;
  source_id: string;
  status: string;
  visibility: string;
  version: number;
  updated: number;
};
export type Candidate = {
  id: string;
  hue: number;
  face: FaceView;
  about: About;
  name: string;
  age: number;
  city: string;
  intent: string;
  synthetic: boolean;
  preview: string[];
  traits: number;
  common: string[];
  reason: string;
  outside?: string[];
};
export type Dimension = { name: string; score: number; note: string; known: boolean };
export type Assessment = {
  score: number;
  confidence: "low" | "medium" | "high";
  method: string;
  dimensions: Dimension[];
  shared: string[];
  explore: string[];
  perspective: {
    learned_about_partner: string[];
    noticed_about_you: string[];
    growth: string;
  } | null;
};
export type Line = { speaker_id: string; speaker: string; text: string; fact_ids: string[]; stage?: number; mood?: string };
export type LiveAgent = { name: string; hue: number; face?: FaceView | null };
/** A date happening right now somewhere on the islands (conversations are never included). */
export type LiveDate = {
  id: string;
  type: string;
  spot: number | null; // null: waiting for a free spot
  status: string;
  started: number;
  step: number;
  mine: boolean;
  public?: boolean; // both members let visitors watch, including the conversation
  /** Display-only island activity. It sits under real dates and is not an account. */
  ambient?: boolean;
  lines?: { side: "a" | "b"; speaker: string; text: string; stage: number; mood: string }[];
  a: LiveAgent;
  b: LiveAgent;
};
/** A date anyone may watch (GET /public/dates/:id). */
export type PublicDate = {
  id: string;
  type: string;
  status: string;
  a: LiveAgent;
  b: LiveAgent;
  lines: { side: "a" | "b"; speaker: string; text: string; stage: number; mood: string }[];
};
export type IslandActivity = {
  agents: number;
  active: number;
  today: number;
  avg_resonance: number | null;
  by_type: Record<string, number>;
  live: LiveDate[];
  simulated: boolean;
};

export type Experience = {
  id: string;
  venue: string;
  spot?: number;
  status: string;
  incoming: boolean;
  waived: boolean;
  stale: boolean;
  created: number;
  partner: Candidate;
  output: {
    dialogue?: Line[];
    question?: string;
    summary?: string;
    evidence?: { id: string; owner_id: string; content: string }[];
    assessment?: Assessment;
  };
  model: string;
  error: string;
  tokens: number;
  mine: {
    reviewed: boolean;
    contribution: string;
    decision: string;
    next_step: string;
    feedback: Record<string, unknown>;
  };
  other: { contribution: string; decision: string; next_step: string };
  mutual: boolean;
  contact: string | null;
  /** A completed date can move to a human introduction. The guidance score does not decide this. */
  can_connect?: boolean;
  match_line?: number | null;
  click?: {
    title: string;
    note: string;
    shared: { yours: string; theirs: string; words: string[] }[];
    differences: { yours: string; theirs: string }[];
    moments: string[];
  };
  mind_ready?: boolean;
};
export type Insights = {
  knowledge: number;
  coverage: Record<string, number>;
  traits: { approved: number; shareable: number };
  dates: { id: string; partner: string; hue: number; face?: FaceView; partner_id?: string; venue: string; score: number; created: number; stale: boolean }[];
  average: number | null;
  dimensions: Record<string, number>;
  strengths: string[];
  shared_themes: [string, number][];
  explore: string[];
  growth: string[];
  learned: { partner: string; text: string }[];
  best_venue: string | null;
  funnel: { dates: number; accepted: number; mutual: number };
  feedback: { responses: number; represented_accurately: number };
};

export const CATEGORIES: { id: string; label: string; hint: string; icon: string }[] = [
  { id: "values", label: "Values", hint: "What matters most to you in a partner", icon: "◆" },
  { id: "lifestyle", label: "Lifestyle", hint: "Your ordinary week, weekends, routines", icon: "☀" },
  { id: "communication", label: "Communication", hint: "How you talk, disagree and make up", icon: "❝" },
  { id: "future", label: "Future", hint: "Where you see the next few years going", icon: "➶" },
  { id: "interests", label: "Interests", hint: "What you love doing or learning", icon: "✦" },
  { id: "backstory", label: "Backstory", hint: "A chapter that shaped you", icon: "❋" },
  { id: "boundaries", label: "Boundaries", hint: "Pace, time and what to respect", icon: "◎" },
];

import { DATE_TYPES, type DateType } from "./dateTypes";

/** Every kind of date, keyed by id (legacy name kept: older code calls these venues). */
export const VENUES: Record<string, DateType> = DATE_TYPES;
export const PLACE_NAME: Record<string, string> = {
  cafe: "Slow Sunday Café",
  bookshop: "The Little Bookshop",
  garden: "Common Ground Garden",
  park: "Island Park Loop",
  market: "Night Market",
  pavilion: "Art Pavilion",
  pier: "Lantern Pier",
};
export const MODE_LABEL: Record<string, string> = { sit: "Sit down", stand: "Stand & talk", walk: "Walk together" };

export const DIM_LABEL: Record<string, string> = {
  values: "Values",
  lifestyle: "Lifestyle",
  communication: "Communication",
  future: "Future",
  interests: "Interests",
};
