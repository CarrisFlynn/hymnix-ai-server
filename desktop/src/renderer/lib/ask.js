/**
 * Question cards the model can put in front of the user.
 *
 * The shape mirrors the DSH tool of the same name: a small list of questions,
 * each with optional choices, optionally multi-select, always answerable in the
 * user's own words. Normalising here keeps the renderer a pure projection and
 * makes the rules testable without a window.
 */

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 8;
const MAX_TEXT = 600;

/** One question, coerced into a shape the dialog can render without guessing. */
function normalizeOne(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw && typeof raw === "object" ? raw : {};
  const question = String(source.question || "").trim().slice(0, MAX_TEXT);
  if (!question) return null;
  const rawOptions = Array.isArray(source.options) ? source.options : [];
  const options = rawOptions.slice(0, MAX_OPTIONS).flatMap((option) => {
    if (typeof option === "string") {
      const label = option.trim().slice(0, 120);
      return label ? [{ label, description: "" }] : [];
    }
    if (!option || typeof option !== "object") return [];
    const label = String(option.label || "").trim().slice(0, 120);
    if (!label) return [];
    return [{ label, description: String(option.description || "").trim().slice(0, 240) }];
  });
  return {
    id: String(source.id || "").trim().slice(0, 60) || "q" + (index + 1),
    question,
    header: String(source.header || "").trim().slice(0, 60),
    options,
    multiSelect: Boolean(source.multi_select ?? source.multiSelect),
  };
}

/** The questions a dialog should show; empty means the call was malformed. */
export function normalizeQuestions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_QUESTIONS).map(normalizeOne).filter(Boolean);
}

/**
 * One answer row per question, in the order asked. A question the user skipped
 * comes back with no selection and no custom text, which is a real answer: the
 * model is told the user had nothing to add instead of being left waiting.
 */
export function buildAnswers(questions, picked = {}, custom = {}) {
  return (questions || []).map((item) => {
    const selected = (picked[item.id] || []).filter((label) => item.options.some((option) => option.label === label));
    const typed = String(custom[item.id] || "").trim().slice(0, MAX_TEXT);
    return { id: item.id, selected, ...(typed ? { custom: typed } : {}) };
  });
}

/** True when every answer is empty — the dialog's Submit should then read "Skip". */
export function allSkipped(answers) {
  return (answers || []).every((answer) => !answer.selected.length && !answer.custom);
}
