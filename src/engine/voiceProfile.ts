/** Voice profile — user's preferred TTS voice for taunts */

export type VoiceProfile = 'none' | 'momo' | 'sonrisa' | 'stella' | 'cherry' | 'arthur';

export const VOICE_PROFILES: { id: VoiceProfile; label: string; description: string }[] = [
  { id: 'none',    label: 'None',    description: 'Text only — no audio taunts' },
  { id: 'momo',    label: 'Momo',    description: 'Playful, teasing — the default' },
  { id: 'sonrisa', label: 'Sonrisa', description: 'Warm and smug' },
  { id: 'stella',  label: 'Stella',  description: 'Cool and commanding' },
  { id: 'cherry',  label: 'Cherry',  description: 'Sweet but ruthless' },
  { id: 'arthur',  label: 'Arthur',  description: 'Deep, dry, merciless' },
];

const KEY = 'pulse:voice-profile';

export function loadVoiceProfile(): VoiceProfile {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && VOICE_PROFILES.some(v => v.id === stored)) return stored as VoiceProfile;
  } catch { /* ignore */ }
  return 'momo';
}

export function saveVoiceProfile(v: VoiceProfile): void {
  try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
}
