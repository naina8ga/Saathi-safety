// Deterministic, rule-based intent classifier (English, Hindi, and romanised Hindi / "Hinglish").
// It does NOT use machine learning. It returns the exact phrases that matched so the UI can
// show *why* a request was classified a certain way instead of inventing a confidence score.
// Rule order matters: safety-critical intents are checked first, and false positives are
// acceptable because every action still needs the user's confirmation.

const RULES = [
  {
    intent: "distress",
    urgency: "High",
    label: "Distress / personal safety",
    actions: ["Start a safety incident", "Share location with approved contacts", "Notify trusted contacts", "Monitor acknowledgements"],
    patterns: [
      /\bfollow(?:ing|ed|s)?\b/, /\bunsafe\b/, /\bscared\b/, /\bafraid\b/, /\bthreat\w*/, /\bdanger\w*/,
      /\buncomfortable\b/, /\bharass\w*/, /\bhelp me\b/, /\bsos\b/, /\bemergency\b/,
      /पीछा/, /डर/, /खतरा/, /असुरक्षित/, /बचाओ/, /मदद/,
      /\b(?:peecha|pichha|pichha)\b/, /\bdarr?\b/, /\bkhatra\b/, /\basurakshit\b/, /\bbachao\b/, /\bmadad\b/
    ]
  },
  {
    intent: "share_location",
    urgency: "Medium",
    label: "Location sharing request",
    actions: ["Check location permission", "Select an approved contact", "Share location only after consent"],
    patterns: [/\blocation\b/, /लोकेशन/, /\bshare\b/, /\bbhej\w*/, /भेज/, /\bmummy\b/, /\bmumma\b/, /मम्मी/]
  },
  {
    intent: "journey_checkin",
    urgency: "Medium",
    label: "Journey check-in",
    actions: ["Start a journey session", "Set an arrival check-in", "Notify selected contacts"],
    patterns: [/\bhome\b/, /\bjourney\b/, /\bcheck[\s-]?in\b/, /\bghar\b/, /घर/, /पहुंच/, /\bpahunch\w*/]
  },
  {
    intent: "request_call",
    urgency: "Medium",
    label: "Request a trusted-person call",
    actions: ["Choose an approved contact", "Prepare a call action", "Record the result"],
    patterns: [/\bcall\b/, /\bphone\b/, /\bstay with me\b/, /बात/, /कॉल/, /\bbaat\b/]
  }
];

const FALLBACK = {
  intent: "general_support",
  urgency: "Low",
  label: "General safety support",
  actions: ["Clarify what help is needed", "Show available safety options"],
  matched: []
};

export function classifyIntent(message = "") {
  const text = String(message).toLowerCase();
  for (const rule of RULES) {
    const matched = [];
    for (const pattern of rule.patterns) {
      const hit = text.match(pattern);
      if (hit && !matched.includes(hit[0])) matched.push(hit[0]);
    }
    if (matched.length) {
      const { intent, urgency, label, actions } = rule;
      return { intent, urgency, label, actions, matched };
    }
  }
  return { ...FALLBACK };
}
