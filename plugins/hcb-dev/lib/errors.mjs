/**
 * Error type for every `hcb-rules` engine failure. Messages must be actionable —
 * include the offending path / rule name / reason so the operator can fix it.
 */
export class HcbError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "HcbError";
  }
}
