// Unknown warnings fail closed. This classification never grants validation or
// changes Doctor health; it only defines ordinary Lean completion's diagnostic gate.
export function blockingCompletionChecks(doctor) {
  return (doctor.checks ?? []).filter(check => check.status !== "pass" &&
    !(check.status === "warn" && check.id === "collaboration_validation" &&
      check.code === "COLLABORATION_REAL_VALIDATION_NOT_PASSED"));
}

export function completionDoctorPassed(doctor) {
  const checks = doctor?.checks;
  return doctor?.healthy === true && Number.isInteger(doctor.summary?.pass) &&
    doctor.summary.fail === 0 && Array.isArray(checks) &&
    doctor.summary.warn === checks.filter(check => check.status === "warn").length &&
    blockingCompletionChecks(doctor).length === 0;
}
