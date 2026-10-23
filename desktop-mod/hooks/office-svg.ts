// office-svg.ts — what is left of the desktop's SVG office. The desktop pane
// is the office Client now (office-client.tsx over office-layout.ts); the SVG
// drawing (room rows, tiles, the message card, their stylesheet) is gone, and
// so are the walk-in window and the tool colour family (the cards draw neither:
// the fix wave of 2026-10-19). This file keeps the one pure token the hooks
// still read:
//   UNKNOWN_MODEL_PILL  the model label of an agent whose model is unknown
//                       (ui.tsx's text cards and drawer, office-props.ts)
//
// PURE: no `$`, no engine import, no state.

/** What the model label says when the model is unknown (the line is never dropped: every card keeps one layout). */
export const UNKNOWN_MODEL_PILL = '?'
