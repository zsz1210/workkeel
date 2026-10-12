const actions = {
  INVALID_INPUT: "Correct the named input within the same authorized operation; consult command help.",
  STALE_PREVIEW: "Read current context and preview again. Reconcile changed authority before applying a new plan.",
  PENDING_RECOVERY: "Inspect the pending operation; resume only its identical request. Do not delete the journal or use individual mutations.",
  GUARD_REJECTED: "Inspect the failed guard and current authority or evidence. Do not bypass it or invent successful verification.",
  EXECUTION_UNCERTAIN: "Inspect the receipt and pending journal before any retry; preserve unexpected edits for recovery."
};

export class OperationError extends Error {
  constructor(code, message, mutationStatus = "not_started", cause = undefined) {
    super(message, { cause });
    this.code = code;
    this.mutationStatus = mutationStatus;
  }
}

export function operationErrorResult(error, { readOnly = false } = {}) {
  const known = error instanceof OperationError || typeof error?.code === "string" &&
    typeof error?.next_action === "string" && typeof error?.mutation_status === "string";
  const code = known ? error.code : readOnly ? "GUARD_REJECTED" : "EXECUTION_UNCERTAIN";
  return {
    schema_version: "temple.operation-error/v1", status: "error",
    code, message: error instanceof Error ? error.message : String(error),
    missing_condition: error?.missing_condition ?? (error instanceof Error ? error.message : String(error)),
    responsible_actor: error?.responsible_actor ?? error?.details?.responsible_actor ?? error?.details?.principal_id ?? null,
    mutation_status: known ? error.mutationStatus ?? error.mutation_status : readOnly ? "not_started" : "unknown",
    next_action: error?.next_action ?? actions[code] ?? actions.EXECUTION_UNCERTAIN,
    ...(error?.details ? { details: error.details } : {}),
    automatic_retry: false, authority_granted: false, external_action_performed: false
  };
}
