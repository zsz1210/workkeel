import semver from "semver";
import { TEMPLATE_VERSION } from "./workkeel-version.mjs";

// Compatibility warnings collected in this process; the CLI prints them on stderr.
const warnings = [];
function warn(warning) {
  const text = JSON.stringify(warning);
  if (!warnings.some(entry => JSON.stringify(entry) === text)) warnings.push(warning);
}
/** Unknown fields are ignored with a warning; schema_version carries major compatibility. */
export function warnUnknownFields(value, known, context = "document") {
  const fields = Object.keys(value).filter(key => !known.includes(key));
  if (fields.length) warn({ code: "unknown-fields-ignored", context, fields });
  return fields;
}
/** Returns and clears the warnings collected so far. */
export function drainCompatibilityWarnings() { return warnings.splice(0); }

/**
 * A CLI can operate a project when it has the lock's major version and is not
 * older than the lock. Reads still run otherwise; mutations stop.
 */
export function cliCompatibility(lockVersion, cliVersion = TEMPLATE_VERSION) {
  if (!semver.valid(lockVersion) || !semver.valid(cliVersion)) return { status: "invalid", lock: lockVersion, cli: cliVersion };
  const base = { lock: lockVersion, cli: cliVersion };
  if (semver.lt(cliVersion, lockVersion)) return { ...base, status: "cli-older",
    next_action: `Install Workkeel ${lockVersion} or a newer ${semver.major(lockVersion)}.x release; the project is pinned to ${lockVersion}.` };
  if (semver.major(cliVersion) !== semver.major(lockVersion)) return { ...base, status: "major-mismatch",
    next_action: `Run workkeel upgrade to move the project pin from ${lockVersion} to ${cliVersion}.` };
  return { ...base, status: "compatible" };
}
export function warnIncompatibleCli(compatibility) {
  if (compatibility.status === "compatible") return;
  warn({ code: `cli-${compatibility.status}`, lock_version: compatibility.lock, cli_version: compatibility.cli,
    effect: "Read commands continue; mutations are blocked.", next_action: compatibility.next_action });
}
/** Drops CLI compatibility warnings once an upgrade has moved the pin. */
export function withdrawCliWarnings() {
  for (let index = warnings.length - 1; index >= 0; index--) if (warnings[index].code.startsWith("cli-")) warnings.splice(index, 1);
}
export function assertMutationCompatible(compatibility) {
  if (compatibility.status !== "compatible")
    throw new Error(`Workkeel ${compatibility.cli} cannot change a project pinned to ${compatibility.lock}. ${compatibility.next_action}`);
}
