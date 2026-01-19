/**
 * Unicode box-drawing characters for TUI rendering.
 */
export const box = {
  // Single line
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  ltee: "├",
  rtee: "┤",
  ttee: "┬",
  btee: "┴",
  cross: "┼",
  // Double line
  dtl: "╔",
  dtr: "╗",
  dbl: "╚",
  dbr: "╝",
  dh: "═",
  dv: "║",
} as const;
