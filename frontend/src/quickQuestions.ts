/** Tap-to-answer questions for "Help your twin get to know you".
 *  Every question has exactly four answers; when the last one is "Other",
 *  a small box appears for the person's own words. Each answer becomes one
 *  plain sentence the twin knows, and answering again replaces it. */
export type QuickQuestion = {
  id: string;
  category: "values" | "lifestyle" | "communication" | "future" | "interests" | "boundaries";
  ask: string;
  /** sentence prefix; the chosen answer is appended */
  say: string;
  options: [string, string, string, string];
};

export const QUICK_QUESTIONS: QuickQuestion[] = [
  { id: "sunday", category: "lifestyle", ask: "Your ideal Sunday?", say: "My ideal Sunday is", options: ["A slow morning at home", "Brunch with friends", "Out exploring somewhere", "Other"] },
  { id: "weeknight", category: "lifestyle", ask: "A typical weeknight?", say: "On a weeknight I'm usually", options: ["Relaxing at home", "At the gym", "Out with friends", "Other"] },
  { id: "morning", category: "lifestyle", ask: "Morning person or night owl?", say: "I'm", options: ["A morning person", "A night owl", "Somewhere in between", "Other"] },
  { id: "pets", category: "lifestyle", ask: "Pets?", say: "When it comes to pets:", options: ["I love dogs", "I love cats", "Not really a pet person", "Other"] },
  { id: "fun", category: "interests", ask: "Your favourite way to unwind?", say: "My favourite way to unwind is", options: ["Movies or a series", "Music", "Cooking", "Other"] },
  { id: "travel", category: "interests", ask: "Your kind of trip?", say: "My kind of trip is", options: ["Beach and sunshine", "Mountains and nature", "A new city", "Other"] },
  { id: "food", category: "interests", ask: "Food you could eat every day?", say: "Food I could eat every day:", options: ["Indian", "Italian", "Arabic", "Other"] },
  { id: "respect", category: "values", ask: "You feel most respected when someone…", say: "I feel most respected when someone", options: ["Is on time", "Listens properly", "Is honest with me", "Other"] },
  { id: "partner", category: "values", ask: "What do you value most in a partner?", say: "What I value most in a partner is", options: ["Kindness", "Loyalty", "A sense of humour", "Other"] },
  { id: "texting", category: "communication", ask: "Texting style?", say: "My texting style:", options: ["Quick replies", "Long messages", "Voice notes", "Other"] },
  { id: "care", category: "communication", ask: "How do you show you care?", say: "I show I care by", options: ["Spending time together", "Little surprises", "Kind words", "Other"] },
  { id: "disagree", category: "communication", ask: "When you disagree, you…", say: "When I disagree, I", options: ["Talk it out right away", "Take a moment first", "Look for a middle ground", "Other"] },
  { id: "future", category: "future", ask: "In a few years you'd love to be…", say: "In a few years I'd love to be", options: ["Settled with a family", "Growing my career", "Travelling more", "Other"] },
  { id: "home", category: "future", ask: "Where would you like to live?", say: "I'd like to live", options: ["Right where I am", "In a bigger city", "Somewhere quieter", "Other"] },
  { id: "pace", category: "boundaries", ask: "Your pace when getting to know someone?", say: "When getting to know someone, I like to", options: ["Take it slow", "Go with the flow", "Meet soon", "Other"] },
  { id: "space", category: "boundaries", ask: "Alone time?", say: "When it comes to alone time,", options: ["I need it often", "Now and then", "I rarely need it", "Other"] },
];

export function sentence(q: QuickQuestion, answer: string) {
  const a = answer.trim().replace(/[.!]+$/, "");
  const lower = /^(I |I'm )/.test(a) ? a : a.charAt(0).toLowerCase() + a.slice(1);
  return `${q.say} ${q.say.endsWith(":") ? a : lower}.`;
}
