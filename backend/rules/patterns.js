// Centralized regex and pattern configurations to reduce duplication.
// Grouped by domain: patient, procedure, clinical, insurance, infoAlerts.

export const PATTERNS = {
  RELATIONSHIP_TOKENS: /(mother|father|parent|guardian|sister|brother|spouse|wife|husband|daughter|son|caregiver|friend|aunt|uncle|cousin)/i,
  TITRATION_CRITERIA: /(pressure\s*too\s*(high|low)|not\s*tolerating\s*(cpap|pressure)|failed\s*(cpap|pap|apap)|needs?\s*(pressure|settings)|still\s*tired\s*on\s*cpap|titration|pressures?\s*adjusted|urgent\/?stat\s+titration)/i,
  SYMPTOM_CONFIG: [
    ['snoring', /snor(?:e|ing)/i, /denies\s+snor(?:e|ing)|no\s+snor(?:e|ing)/i],
    ['daytime_sleepiness', /(excessive\s+daytime\s+sleepiness|hypersomnia|\bEDS\b)/i, /denies\s+(excessive\s+)?daytime\s+sleepiness|no\s+daytime\s+sleepiness/i],
    ['fatigue', /fatigue|tired/i, /denies\s+fatigue|no\s+fatigue/i],
    ['witnessed_apnea', /(witnessed|observed)\s+(apnea|apneic|apneic\s+events?)|apneic\s+events?/i, /denies\s+(witnessed|observed)\s+(apnea|apneic)/i],
    ['choking_gasping', /(gasping|choking)(\s+arousals?)?/i, /denies\s+(gasping|choking)/i],
    ['insomnia', /insomnia|difficulty\s+(falling|staying)\s+asleep/i, /denies\s+insomnia|no\s+insomnia/i],
    ['restless_legs', /restless\s+legs?|restless\s+leg\s+syndrome|\bRLS\b/i, /denies\s+restless\s+legs?/i],
    ['headache', /headache|morning\s+headaches?/i, /denies\s+headaches?/i]
  ]
};

// Utility accessor to future-proof pattern evolution.
export function getPattern(name) {
  return PATTERNS[name];
}
