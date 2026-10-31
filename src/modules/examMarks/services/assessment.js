// Shared by manual entry, both Excel import paths, and result readiness.
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
const number = (value) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (!["string", "number"].includes(typeof value)) return NaN;
  return Number.isFinite(Number(value)) ? Number(value) : NaN;
};
const boolean = (value) => {
  if (value === true || value === "true" || value === 1) return true;
  if (value === false || value === "false" || value === 0 || value == null) return false;
  return fail("Component flags must be booleans");
};
const components = [
  ["hasTheory", "theoryMaxMarks", "theoryMark"],
  ["hasPractical", "practicalMaxMarks", "practicalMark"],
  ["hasMonthlyAssessment", "monthlyAssessmentMaxMarks", "monthlyAssessmentMark"],
];
function configuration(input) {
  const result = {};
  let total = 0;
  for (const [flag, maximum] of components) {
    result[flag] = boolean(input[flag]);
    const value = number(input[maximum]);
    if (value !== null && (!Number.isFinite(value) || value < 0)) fail(`${maximum} must be finite and non-negative`);
    if (result[flag] && !(value > 0)) fail(`${maximum} must be positive when enabled; configure subject defaults or supply an override`);
    result[maximum] = !result[flag] && flag !== "hasMonthlyAssessment" ? 0 : value ?? 0;
    if (result[flag]) total += value;
  }
  if (!(total > 0) || !Number.isFinite(total)) fail("Total enabled maximum must be positive and finite");
  total = Number(total.toFixed(2));
  const pass = number(input.passMark);
  if (pass === null || !Number.isFinite(pass) || pass < 0 || pass > total) fail("passMark must be between zero and the total enabled maximum");
  return { ...result, passMark: pass, totalMaxMarks: total };
}
function subjectDefaults(input) {
  if (!["General", "Core"].includes(input.subjectType)) fail("subjectType must be General or Core");
  const result = configuration({ ...input, hasTheory: true, hasPractical: input.subjectType === "Core" });
  delete result.totalMaxMarks;
  return result;
}
function calculateMark(input, config) {
  const errors = [];
  const values = {};
  const status = String(input.markStatus || "Present").trim();
  if (!["Present", "Absent", "Exempted"].includes(status)) errors.push("markStatus must be Present, Absent or Exempted");
  let total = 0;
  let maximum = 0;
  const missing = [];
  for (const [flag, max, mark] of components) {
    const isMissing = typeof input[mark] === "string" && input[mark].trim().toUpperCase() === "NG";
    const value = isMissing ? 0 : number(input[mark]);
    if (isMissing && config[flag]) missing.push(mark);
    const enabled = Boolean(config[flag]);
    values[mark] = enabled ? value : null;
    if (!enabled && value !== null) errors.push(`${mark} cannot be supplied when ${flag} is disabled`);
    if (status !== "Present" && value !== null) errors.push(`${status} students cannot have marks`);
    if (enabled) {
      const limit = Number(config[max]);
      if (!Number.isFinite(limit) || limit <= 0) errors.push(`${max} configuration is invalid`);
      maximum += limit;
      if (status === "Present" && value === null) errors.push(`${mark} is required`);
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > limit)) errors.push(`${mark} must be between 0 and ${limit}`);
      total += value ?? 0;
    }
  }
  total = Number(total.toFixed(2));
  maximum = Number(maximum.toFixed(2));
  const totalMark = status === "Present" ? total : null;
  return { errors, values: { ...values, totalMark,
    percentage: totalMark === null ? null : Number(((total / maximum) * 100).toFixed(2)),
    grade: null, resultStatus: status === "Present" ? (total >= Number(config.passMark) ? "Pass" : "Fail") : status,
    remarks: [String(input.remarks ?? "").trim(), ...missing.map(mark => `NG: ${mark}`)].filter(Boolean).join("; "),
  } };
}
module.exports = { number, boolean, components, configuration, subjectDefaults, calculateMark };
