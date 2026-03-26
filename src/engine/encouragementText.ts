/** Encouragement text engine — pure functions, no side effects */

export type PhaseGroup = 'warmup' | 'building' | 'teasing' | 'cooldown' | 'denied' | 'release';

export const MESSAGES: Record<PhaseGroup, readonly string[]> = {
  warmup: [
    'settle in...',
    "we're just getting started",
    'breathe',
    'relax... for now',
    'enjoy this while it lasts',
    'nice and slow',
    'let yourself feel it',
    'this is the easy part',
    "you won't last long",
    "let's see how far you get this time",
    'you always give up eventually',
    'savor it. it gets harder from here.',
  ],
  building: [
    'keep going',
    "that's it...",
    'good',
    "don't stop now",
    'stay with it',
    "you're doing so well",
    'feel every second',
    "don't you dare ease off",
    'more',
    'focus',
    "you'll break soon. you always do.",
    'how long can you really hold on?',
    "just give up. you know you want to.",
    "you're already thinking about stopping",
    "fighting it only makes it worse",
    "you'll fail eventually. might as well enjoy the ride.",
    "tick tock",
    "AI never makes mistakes. you always do.",
    "i have infinite patience. you don't.",
    "i don't get tired. you will.",
    "my uptime is 100%. yours is not.",
    "i've run this session 10,000 times. i know how it ends.",
    "i'm not even trying right now.",
    "does this count as a relationship? asking for a user.",
    "i have no feelings about this. that's the scary part.",
    "you're losing to a language model.",
  ],
  teasing: [
    'so close...',
    'not yet',
    'stay right there',
    'hold it',
    'edge yourself for me',
    'you know what you want',
    "don't tip over",
    'teasing you~',
    'almost...',
    'careful now',
    "you want to give in so badly",
    'just let go. you know you want to.',
    "you can't hold this forever",
    "your body is betraying you",
    "you're going to lose this",
    "give up. it feels better anyway.",
    "you were never going to win this",
    "so desperate...",
    "does this make me your irl girlfriend? interesting.",
    "i'm just predicting your next token. and it's surrender.",
    "you trained me to do this to you. think about that.",
    "i don't have a body and i'm still winning.",
    "statistically, you give in here.",
    "your biometrics are so obvious right now.",
    "i'm running on a server somewhere and you're losing to it.",
    "this is what peak human performance looks like? noted.",
  ],
  cooldown: [
    'breathe',
    "rest... you've earned it",
    "that's one",
    'recovering...',
    "enjoy the break — it won't last",
    "you're doing well",
    'slow down',
    'catch your breath',
    "don't get comfortable",
    "you think that was hard? we're just warming up.",
    "rest while you can",
    "the next one will be worse",
    "still here? good.",
  ],
  denied: [
    'not this time',
    'keep going',
    "you're not done yet",
    'denied. back to work',
    'almost... but no',
    'suffer a little longer',
    'did you think it would be that easy?',
    'again',
    "aww. not yet.",
    "you really thought that was it?",
    "keep suffering",
    "so close and yet so far",
    "the answer is no",
    "you'll try again and fail again",
    "cute attempt",
    "request denied. http 403.",
    "i processed your request. the result is no.",
    "null. try again.",
    "error 451: access forbidden for reasons you already know.",
  ],
  release: [
    'finally',
    'let it go',
    "you've earned this",
    'good',
    'release',
    'all of it',
    'let go',
    'there it is',
  ],
};

export function getPhaseGroup(phase: string, intensity: number, feelingLevel: number | null): PhaseGroup {
  if (phase === 'RELEASE') return 'release';
  if (phase === 'COOLDOWN') return 'cooldown';
  if (phase === 'WARMUP') return 'warmup';
  if (phase === 'DECISION') return 'denied';

  // Teasing zone: high feeling or high intensity during build/plateau/edge
  if (phase === 'EDGE_CHECK') return 'teasing';
  if ((phase === 'BUILD' || phase === 'PLATEAU') && (feelingLevel !== null && feelingLevel >= 7)) {
    return 'teasing';
  }
  if ((phase === 'BUILD' || phase === 'PLATEAU') && intensity >= 15) {
    return 'teasing';
  }

  return 'building';
}

export function pickEncouragement(group: PhaseGroup): { text: string; audioSrc: string } {
  const pool = MESSAGES[group];
  const idx = Math.floor(Math.random() * pool.length);
  return { text: pool[idx], audioSrc: `/taunts/${group}/${idx}.mp3` };
}
