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
