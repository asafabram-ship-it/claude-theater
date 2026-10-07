// Personas: the 48 persona names in both languages, index-aligned with
// PERSONA_EMOJI in model.ts (ported verbatim from PAGE's PERSONAS_EN / PERSONAS_HE).
//
// OWNER: builder "ui" (data is final; add helpers freely).

import { PERSONA_EMOJI } from './model'

export const PERSONAS_EN: readonly string[] = [
  'The Detective', 'The Writer', 'The Courier', 'The Researcher', 'The Librarian', 'The Navigator', 'The Scout', 'The Builder',
  'The Wizard', 'The Marksman', 'The Owl', 'The Fox', 'The Bee', 'The Robot', 'The Tiger', 'The Eagle',
  'The Mechanic', 'The Chemist', 'The Architect', 'The Painter', 'The Judge', 'The Medic', 'The Broker', 'The Locksmith',
  'The Firefighter', 'The Handyman', 'The Scribe', 'The Analyst', 'The Strategist', 'The Guardian', 'The Engineer', 'The Fitter',
  'The Operator', 'The Signaler', 'The Ranger', 'The Cartographer', 'The Photographer', 'The Director', 'The Broadcaster', 'The Herald',
  'The Ant', 'The Wolf', 'The Beaver', 'The Tortoise', 'The Duck', 'The Dolphin', 'The Scorpion', 'The Bat',
]

export const PERSONAS_HE: readonly string[] = [
  'הבלש', 'הסופר', 'השליח', 'החוקר', 'הספרן', 'הנווט', 'הצופה', 'הבנאי',
  'הקוסם', 'הצייד', 'הינשוף', 'השועל', 'הדבורה', 'הרובוט', 'הנמר', 'הנשר',
  'המכונאי', 'הכימאי', 'האדריכל', 'הצייר', 'השופט', 'הרופא', 'המתווך', 'המנעולן',
  'הכבאי', 'איש-התחזוקה', 'הלבלר', 'האנליסט', 'האסטרטג', 'השומר', 'המהנדס', 'המסגר',
  'המפעיל', 'הקשר', 'הסייר', 'הקרטוגרף', 'הצלם', 'הבמאי', 'הקריין', 'הכרוז',
  'הנמלה', 'הזאב', 'הבונה', 'הצב', 'הברווז', 'הדולפין', 'העקרב', 'העטלף',
]

/** PAGE personaName(): the localized name for a persona index, or the generic "Agent"/"סוכן". */
export function personaName(personaId: number | undefined, lang: 'he' | 'en'): string {
  const table = lang === 'he' ? PERSONAS_HE : PERSONAS_EN
  const name = typeof personaId === 'number' ? table[personaId] : undefined
  return name ?? (lang === 'he' ? 'סוכן' : 'Agent')
}

/** The emoji for a persona index (falls back to the first of the cast). */
export function personaEmoji(personaId: number | undefined): string {
  return (typeof personaId === 'number' ? PERSONA_EMOJI[personaId] : undefined) ?? PERSONA_EMOJI[0] ?? '🤖'
}

/** The slice of an agent `assignDistinctPersonas` reads and writes. */
export type PersonaSeat = {
  id: string
  session_full: string
  persona_id: number
  emoji: string
  is_session: boolean
  start_ms: number | null
}

/**
 * Python resolve_personas, the stateless half (a fresh process has no
 * remembered seats): within a room (session_full, or the agent's own id when
 * sessionless) the lead sits first, then agents oldest-first, and each takes
 * the first free slot linear-probed from its hash base, so two agents of one
 * room never share an avatar. Rooms larger than the cast reuse the base slot.
 * Mutates `persona_id` / `emoji` in place and returns the same array.
 * Used by the demo office; the scanner keeps its own (stateful) port.
 */
export function assignDistinctPersonas<A extends PersonaSeat>(agents: A[]): A[] {
  const rooms = new Map<string, A[]>()
  for (const a of agents) {
    const key = a.session_full || a.id
    const room = rooms.get(key)
    if (room) room.push(a)
    else rooms.set(key, [a])
  }
  const n = PERSONA_EMOJI.length
  for (const members of rooms.values()) {
    members.sort((x, y) =>
      (x.is_session ? 0 : 1) - (y.is_session ? 0 : 1) ||
      (x.start_ms ?? 0) - (y.start_ms ?? 0) ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    const taken = new Set<number>()
    for (const a of members) {
      const base = ((a.persona_id % n) + n) % n
      let slot = base
      for (let k = 0; k < n; k++) {
        const cand = (base + k) % n
        if (!taken.has(cand)) { slot = cand; break }
      }
      taken.add(slot)
      a.persona_id = slot
      a.emoji = PERSONA_EMOJI[slot] ?? PERSONA_EMOJI[0] ?? '🤖'
    }
  }
  return agents
}
