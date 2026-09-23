import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { LEAN_ASSIGNMENT_SLOTS, TEMPLATE_VERSION } from "./constants.mjs";
import {
  buildCapabilityRegistry,
  findCapabilities,
  resolveWorkItemContext,
  writeCapabilityRegistry,
  writeContextCapsule
} from "./context.mjs";
import { runDoctor, formatDoctor, compactDoctor } from "./doctor.mjs";
import { deliverLeanWorkItem } from "./lean-delivery.mjs";
import { finishLeanWorkItem } from "./lean-finish.mjs";
import { recoverLeanFinish } from "./lean-finish-recovery.mjs";
import { OperationError, operationErrorResult } from "./operation-errors.mjs";
import {
  addMembership,
  addAgentIdentity,
  addPrincipal,
  configureGovernanceRecovery,
  establishBootstrapOwner,
  grantHumanAuthority,
  migrateCollaborationState,
  normalizedCollaborationState,
  readCollaborationState,
  recordCollaborationValidation,
  retireBootstrapOwner,
  revokeHumanAuthority,
  setMembershipQualification,
  setCollaborationProfile,
  setPrincipalStatus,
  sponsorAgent
} from "./collaboration.mjs";
import { clearLocalActorBinding, readLocalActorBinding, writeLocalActorBinding } from "./local-identity.mjs";
import { assertSafeTarget, atomicWrite, formatJson, readJson } from "./files.mjs";
import { executeInit, formatInitPlan, planInit } from "./install.mjs";
import { invalidateEvidence, preserveEvidenceRevision, readEvidenceRegistry, recordEvidence } from "./evidence.mjs";
import { validateInitConfig } from "./model.mjs";
import {
  executePackInstall,
  executePackRemove,
  formatPackPlan,
  listPackState,
  planPackInstall,
  planPackRemove
} from "./packs.mjs";
import { withProjectMutationLock } from "./project.mjs";
import { queryLearningReviews, recordLearningReview } from "./learning-review.mjs";
import { buildStatus, compactStatus, renderStatusMarkdown, writeStatus } from "./status.mjs";
import { buildObserverProjection, writeObserverProjection } from "./observer.mjs";
import {
  ingestControlPlaneFixture,
  inspectControlPlane,
  rebuildControlPlane,
  startControlPlaneServer
} from "./control-plane-server.mjs";
import { startManagementConsoleServer } from "./management-console-server.mjs";
import { startUsageCollector } from "./usage-collector.mjs";
import { DEFAULT_LAN_VIEWER_PORT, prepareTailscalePrivateViewer } from "./private-network-viewer.mjs";
import {
  applyLocalObserverService,
  inspectLocalObserverService,
  planLocalObserverService,
  removeLocalObserverService
} from "./local-observer-service.mjs";
import { readControlPlaneConfig } from "./control-plane-config.mjs";
import { captureGitHubEvidence } from "./github-control-plane-provider.mjs";
import { resolveControlPlaneStateDirectory } from "./telemetry.mjs";
import { validateProjectSchemas } from "./schema-validation.mjs";
import { buildMigrationPlan } from "./migrations.mjs";
import {
  addLearningEntry,
  decideSkillProposal,
  listLearningEntries,
  listSkillPromotionCandidates,
  migrateLearningIndex,
  proposeSkillFromLearning,
  revalidateLearningEntry,
  syncLearningMetadata
} from "./learning.mjs";
import { evaluateRetrieval, readRetrievalConfig } from "./retrieval.mjs";
import { evaluatePolicy } from "./policy-evaluation.mjs";
import { buildUsageBaseline, buildUsagePreflight, evaluateMatchedModelFixture } from "./usage-attribution.mjs";
import { resolveExecutionRequestFile } from "./execution-routing.mjs";
import { buildModelOnboardingPlanFile } from "./model-onboarding.mjs";
import { installArchifyAdapter, inspectArchifyAdapter } from "./archify-adapter.mjs";
import { createHeadroomView, createHeadroomPayload, readHeadroomOriginal } from "./headroom-adapter.mjs";
import { listTasks, refreshTaskTitles, registerTask, updateTask } from "./tasks.mjs";
import {
  configureTracker,
  inspectAndPlanTrackerItem,
  linkTrackerItem,
  readTrackerConfig,
  reconcileTrackerItem,
  removeTrackerProvider,
  setTrackerVisibility,
  unlinkTrackerItem,
  writeTrackerView
} from "./tracker.mjs";
import { executeUpgrade, formatUpgradePlan, planUpgrade } from "./upgrade.mjs";
import {
  applyBackupRetention,
  applyRestore,
  createBackup,
  inspectBackup,
  inspectBackupSet,
  planBackupRetention,
  planRestore,
  recoverRestore
} from "./recovery.mjs";
import { writeAuditExport } from "./audit-export.mjs";
import { buildPublicationAudit } from "./publication-audit.mjs";
import {
  applyPublicationNormalization,
  buildPublicationNormalizationPlan
} from "./publication-normalization.mjs";
import {
  applyPublicationArtifactNormalization,
  buildPublicationArtifactNormalizationPlan,
  writePublicationArtifactNormalizationPlan
} from "./publication-artifact-normalization.mjs";
import { buildFederatedPortfolio, readFederationRegistry, validateFederationRegistry } from "./federation.mjs";
import {
  buildCrossRepositoryUsageReport,
  inspectValidationProgram,
  VALIDATION_PROGRAM_REPORT_VIEW
} from "./validation-program.mjs";
import { buildParallelPlan, writeParallelPlan } from "./orchestration.mjs";
import { defineResource, readResourceRegistry } from "./resources.mjs";
import { attachInternalWorker, listRuntimeWorkers, prepareWorkerDispatch, updateRuntimeWorker } from "./workers.mjs";
import {
  closeWorkItem,
  claimWorkItem,
  configureWorkItem,
  createHandoff,
  createWorkItem,
  evaluateParallelReadiness,
  listUnresolvedItems,
  migrateLegacyOutcome,
  releaseWorkItemClaim,
  reworkWorkItem,
  transitionWorkItem,
  updateUnresolvedItems
} from "./work-items.mjs";

const HELP = `Temple ${TEMPLATE_VERSION}

Usage:
  temple init [target] [--config path] [--dry-run] [--integrate-agents] [--self-host] [--json]
  temple upgrade [target] [--dry-run]
  temple backup create [target] --output directory [--json]
  temple backup inspect [target] --backup directory [--json]
  temple backup set-inspect [target] --root directory [--json]
  temple backup retention-preview [target] --root directory --minimum-to-keep number [--preserve name] [--json]
  temple backup retention-apply [target] --root directory --minimum-to-keep number --expected-plan sha256 --confirm-delete [--preserve name] [--json]
  temple restore preview [target] --backup directory [--json]
  temple restore apply [target] --backup directory --expected-plan sha256 [--allow-replace] [--json]
  temple restore recover [target] [--json]
  temple audit export [target] --output file [--work-item WI-ID] [--event-type type] [--redact-key key] [--max-events number] [--max-recovery-transactions number] [--max-event-bytes number] [--json]
  temple publication audit [target] [--profile private|public|restricted] [--surface repository|package|both] [--json]
  temple publication normalize-plan [target] [--json]
  temple publication normalize-apply [target] --work-item WI-ID --expected-plan sha256 --confirm-normalization [--actor id] [--json]
  temple publication artifact-plan [target] [--output path] [--json]
  temple publication artifact-apply [target] --work-item WI-ID --expected-plan sha256 --confirm-normalization [--actor id] [--output path] [--json]
  temple federation validate [target] [--json]
  temple portfolio build [target] [--allowed-root directory] [--no-write] [--json]
  temple experiment inspect [target] --manifest path --allowed-root directory [--json]
  temple experiment report [target] --manifest path --allowed-root directory [--no-write] [--json]
  temple doctor [target] [--json] [--compact]
  temple status [target] [--json] [--no-write] [--compact (requires --json)] [--work-item WI-ID (requires --compact)]
  temple observe [target] [--json] [--no-write]
  temple control-plane snapshot [target] [--state-dir path] [--json]
  temple control-plane ingest [target] --fixture path [--state-dir path] [--json]
  temple control-plane rebuild [target] [--state-dir path] [--json]
  temple control-plane capture-github [target] --provider-id id --work-item WI-ID --revision commit [--state-dir path] [--actor id] [--title text] [--summary text] [--json]
  temple control-plane start [target] [--host 127.0.0.1] [--port number] [--state-dir path] [--fixture path] [--codex] [--observation-mode off|on-demand|managed-local] [--codex-command absolute-path] [--tailscale-viewer] [--lan-viewer-host private-ip] [--lan-viewer-port number]
  temple control-plane observer-status [target] [--state-dir path] [--json]
  temple control-plane observer-plan [target] [--state-dir path] [--codex-command absolute-path] [--json]
  temple control-plane observer-apply [target] --expected-plan sha256 [--activate] [--confirm-replace] [--state-dir path] [--codex-command absolute-path] [--json]
  temple control-plane observer-remove [target] --expected-plan sha256 --confirm-delete [--state-dir path] [--json]
  temple console start [target] [--host 127.0.0.1] [--port number] [--state-dir path] [--tailscale-viewer] [--lan-viewer-host private-ip] [--lan-viewer-port number]
  temple collaboration show [target] [--json]
  temple collaboration readiness [target] [--principal-id id] [--work-item WI-ID] [--position role] [--json]
  temple collaboration preview-profile [target] --profile solo|collaborative|high-assurance [--actor-policy attributed|verified] [--json]
  temple collaboration apply-profile [target] --profile profile [--actor-policy policy] --fingerprint digest [--json]
  temple collaboration setup-contributor [target] --config authorized-member.json [--json]
  temple measurement capabilities [target] [--json]
  temple measurement inspect|run [target] --config measurement-plan.json [--json]
  temple measurement report [target] --config measurement-plan.json --work-item WI-ID --revision full-sha [--output filename.md] [--json]
  temple evidence durability [target] [--work-item WI-ID] [--revision ref] [--json]
  temple evidence view [target] --source repository-path [--format text|json|node-test] [--compact] [--expected-sha256 digest] [--json]
  temple evidence export-bundle [target] --evidence EVID-ID [--output path] [--json]
  temple evidence verify-bundle|import-bundle [target] --bundle path [--json]
  temple reconcile preview|apply [target] --config request-or-preview.json [--fingerprint digest] [--json]
  temple reconcile recover [target] --transaction-id id [--json]
  temple reconcile refresh-views [target] [--json]
  temple collaboration migrate [target] [--dry-run] [--json]
  temple collaboration show-identity [target] [--json]
  temple collaboration bind-identity [target] --principal-id principal-name|human --verification-class self-asserted|external-evidence|step-up-evidence [--provider-id id] [--provider-subject subject] [--provider-handle handle] [--evidence-ref ref] [--expires-at timestamp]
  temple collaboration clear-identity [target]
  temple collaboration set-profile [target] --profile solo|collaborative|high-assurance
  temple collaboration add-principal [target] --principal-id principal-name --name "Human Name" [--provider-id id --provider-subject subject --provider-handle handle --evidence-ref ref]
  temple collaboration set-principal-status [target] --principal-id principal-name --status active|suspended|inactive
  temple collaboration add-agent [target] --agent-id agent-name --name "Agent Name"
  temple collaboration sponsor [target] --principal-id principal-name --agent-id agent-name
  temple collaboration add-membership [target] --agent-id agent-name --position developer [--discipline backend]
  temple collaboration qualify-membership [target] --agent-id agent-name --position developer --status provisional|active|suspended|expired|revoked [--evidence ref] [--risk-tier tier] [--review-after timestamp] [--expires-at timestamp]
  temple collaboration grant-authority [target] --grant-id grant-name --principal-id principal-name --authority authority --scope scope --risk-tier tier --approved-by principal-name [--expires-at timestamp]
  temple collaboration revoke-authority [target] --grant-id grant-name --approved-by principal-name
  temple collaboration configure-recovery [target] --trustee principal-name --threshold number --approved-by principal-name
  temple collaboration establish-bootstrap [target] --principal-id principal-name --approved-by principal-name
  temple collaboration retire-bootstrap [target] --approved-by principal-name
  temple collaboration record-validation [target] --validation-level level --status status [--revision ref] [--evidence ref] [--participant-principal principal-name] [--environment id]
  temple work-item create [target] --title text [--scope text] [--acceptance text] [--affected-path path] [--context-ref id] [--spec-mode gate-evidence|indexed] [--spec-ref ID@revision] [--ui-mode mode] [--workflow-profile lean|standard|high-assurance] [--risk-tier low|standard|high|critical] [--scope-class bounded|ordinary|cross-system] [--escalation-trigger id] [--profile-rationale text] [--profile-evidence ref] [--discipline backend] [--stage-discipline build=backend] [--stage-resource test=ios-simulator[:units]] [--tracker-visibility internal|team-visible]
  temple work-item configure [target] --work-item WI-ID [--parent WI-ID] [--depends-on WI-ID] [--agent-id agent-name] [--workflow-profile profile] [--risk-tier tier] [--scope-class class] [--escalation-trigger id] [--profile-rationale text] [--profile-evidence ref] [--discipline backend] [--clear-disciplines] [--stage-discipline build=backend] [--stage-resource test=ios-simulator[:units]] [--clear-stage-requirement test] [--base-revision ref] [--parallel-mode mode] [--spec-ref ID@revision] [--replace-spec-refs]
  temple work-item contract [target] --work-item WI-ID --no-write --json
  temple work-item validate-contract [target] --source repository-file --no-write --json
  temple work-item propose [target] --title text --agent-id id --principal-id id [--position developer] [creation scope options; creates unclaimed intake only]
  temple work-item migrate-outcomes [target] [--work-item WI-ID] [--outcome no-go|inconclusive] [--reason text] [--dry-run] [--json]
  temple work-item claim [target] --work-item WI-ID --agent-id agent-name --principal-id principal-name --base-revision ref --branch name [--worktree path]
  temple work-item release [target] --work-item WI-ID [--agent-id agent-name] [--principal-id principal-name] [--reason text]
  temple work-item deliver [target] --work-item WI-ID --operation-id id --claim-id id --agent-id agent-name --principal-id principal-name --revision commit --completed text --evidence path [--unresolved text] [--dry-run] [--expected-plan sha256] [--json]
  temple work-item finish [target] --work-item WI-ID --position developer|quality_evaluator --operation-id id --claim-id id --agent-id id --principal-id id --revision commit [--completed text --evidence path | --judgment pass --test-evidence path --lean-closeout path] [--dry-run] [--expected-plan sha256] [--json]
  temple work-item finish [target] --work-item WI-ID --position developer --operation-id id --claim-id id --agent-id id --principal-id id --revision commit --mechanical-contract .ai-org/artifacts/WI-ID/mechanical-contract.json [--dry-run] [--expected-plan sha256] [--json]
  temple work-item rework [target] --work-item WI-ID --same-scope --input-revision full-sha --reason text --evidence repository-path [--actor agent-name] [--json]
  temple work-item finish-recover [target] --work-item WI-ID --operation-id id --agent-id id --principal-id id --approval-ref path [--dry-run | --expected-plan sha256] [--json]
  temple work-item unresolved [target] --work-item WI-0001 [--resolve text] [--merge text]
  temple parallel check [target] --work-item WI-ID [--agent-id agent-name] [--json]
  temple parallel plan [target] [--parent WI-ID] [--max-workers number] [--json] [--no-write]
  temple parallel prepare [target] --work-item WI-ID --agent-id agent-name --principal-id principal-name --base-revision ref --branch name --runtime-kind internal-subagent|user-task [--worktree path]
  temple resource define [target] --resource-id id --name "Display name" --capacity number [--description text]
  temple resource list [target] [--json]
  temple worker attach [target] --worker-id id --runtime-id id
  temple worker update [target] --worker-id id --status active|waiting|attention|completed|failed|cancelled [--revision ref] [--evidence ref]
  temple worker list [target] [--json]
  temple evidence git [target] --work-item WI-ID --revision ref [--title text] [--summary text]
  temple evidence preserve [target] --work-item WI-ID --revision ref
  temple evidence test [target] --work-item WI-ID --observation path [--title text] [--summary text]
  temple evidence runtime [target] --work-item WI-ID --observation path [--title text] [--summary text]
  temple evidence unverified [target] --work-item WI-ID --summary text --reason text --expected-verification text
  temple evidence risk [target] --work-item WI-ID --summary text --severity low|medium|high|critical --risk-status open|accepted|mitigated --mitigation text [--revision ref]
  temple evidence rollback [target] --work-item WI-ID --summary text --procedure path --rollback-status planned|verified [--revision ref]
  temple evidence invalidate [target] --evidence-id EVID-ID --reason text [--replacement-evidence-id EVID-ID] [--actor id]
  temple evidence list [target] [--work-item WI-ID] [--json]
  temple schema validate [target] [--json]
  temple migration plan [target] [--json]
  temple learning add-lesson [target] --title text --summary text --confidence low|medium|high [--tag value] [--applies-to value] [--source-work-item WI-ID] [--evidence ref]
  temple learning add-practice [target] --title text --summary text --confidence low|medium|high --derived-from LESSON-ID --owner-position position [--tag value] [--applies-to value]
  temple learning revalidate [target] --learning-id ID --result confirmed|narrowed|contradicted [--evidence ref] [--review-after timestamp]
  temple learning list [target] [--json]
  temple learning review-status [target] [--work-item WI-ID] [--compact] [--json]
  temple learning record-review [target] --work-item WI-ID --revision full-sha --result no-new-lesson|linked-lessons --actor agent-id --evidence repository-path [--learning-id LESSON-ID] [--supersedes review-digest --reason text] [--json]
  temple learning sync-metadata [target] --learning-id ID [--dry-run] [--json]
  temple learning skill-candidates [target] [--json]
  temple learning propose-skill [target] --learning-id PRACTICE-ID --work-item WI-ID --skill-name name --summary text --trigger text --non-trigger text --authority text --risk-class low|standard|high|critical --overlap-review text [--dependency value] [--alternative value] [--evidence ref] [--actor id] [--json]
  temple learning decide-skill [target] --proposal-id ID --decision approve|reject|defer --principal-id id --reason text [--review-after timestamp] [--json]
  temple learning migrate [target] [--dry-run] [--json]
  temple learning evaluate [target] --fixture path [--no-write] [--json]
  temple retrieval show [target] [--json]
  temple evaluation run [target] --fixture path [--no-write] [--json]
  temple usage report [target] [--state-dir path] [--no-write] [--json]
  temple delivery open|check|finish|rework|observe|pause|resume [target] --work-item WI-ID --agent-id id --principal-id id [--request repository-file] [--json]
  temple delivery next|report [target] --work-item WI-ID [--json]
  temple usage preflight [target] [--state-dir path] [--probe-codex-account] [--json]
  temple usage evaluate [target] --fixture .ai-org/evaluations/model/name.json [--no-write] [--json]
  temple usage collect [target] [--state-dir path] [--codex-command absolute-path] [--observation-mode on-demand|managed-local]
  temple execution resolve [target] --request path [--json]
  temple execution onboarding-plan [target] --input path [--json]
  temple adapter archify-status [target] [--json]
  temple adapter archify-install [target] --source local-git-checkout [--json]
  temple adapter headroom-view [target] --input file --kind log|json [--enable-headroom --python absolute-path --snapshot fresh-absolute-file] [--allow-lossy-headroom] [--query text] [--json]
  temple adapter headroom-payload [target] --input file --kind log|json [--enable-headroom --python absolute-path --snapshot fresh-absolute-file] [--allow-lossy-headroom] [--query text] [--json]
  temple adapter headroom-read [target] --input snapshot --expected-sha256 digest [--json]
  temple handoff [target] --work-item WI-0001 --to position --input-revision ref --completed text --evidence ref
  temple transition [target] --work-item WI-0001 --to state --satisfy requirement=reference
  temple close [target] --work-item WI-0001 --decision go|no-go --tested-revision ref --rollback text --approval record --satisfy accepted_scope=ref --satisfy test_evidence=ref --satisfy evaluation_report=ref --satisfy independent_qa_report=ref
  temple task register [target] --work-item WI-0001 --position developer --thread-id id [--worker-id worker-id] [--execution-origin codex-host-owned|temple-provider-owned] [--provider-id id] [--requested-model model] [--effective-model model] [--requested-reasoning-effort effort] [--observed-thread-reasoning-effort effort] [--effective-turn-reasoning-effort effort] [--reasoning-effort effort] [--reasoning-effort-source source] [--service-tier tier] [--launch-revision ref]
  temple task update [target] --task-id task-0001 --status completed [--effective-model model] [--requested-reasoning-effort effort] [--observed-thread-reasoning-effort effort] [--effective-turn-reasoning-effort effort] [--reasoning-effort effort] [--reasoning-effort-source source] [--service-tier tier]
  temple task refresh-titles [target] [--task-id task-0001] [--json]
  temple task list [target] [--json]
  temple tracker show [target] [--json]
  temple tracker configure [target] --tracker-profile linked-tracker --provider-id github-main --provider-kind github --project owner/repository [--write-policy plan-only]
  temple tracker remove-provider [target] --provider-id github-main
  temple tracker set-visibility [target] --work-item WI-0001 --visibility internal|team-visible
  temple tracker link [target] --work-item WI-0001 --provider-id github-main --item-id 123 --url https://github.com/owner/repository/issues/123 [--role primary]
  temple tracker unlink [target] --work-item WI-0001 --provider-id github-main --item-id 123
  temple tracker inspect [target] --work-item WI-0001 [--provider-id github-main] [--observation path] [--no-write] [--json]
  temple tracker plan [target] --work-item WI-0001 [--provider-id github-main] [--observation path] [--no-write] [--json]
  temple tracker reconcile [target] --work-item WI-0001 --observation path --resolution resolution --reason text
  temple pack list [target] [--json]
  temple pack install [target] --pack build-quality [--dry-run]
  temple pack remove [target] --pack build-quality [--dry-run]
  temple capability list [target] [--json]
  temple capability find [target] --query text [--position position] [--limit number] [--json]
  temple context resolve [target] --work-item WI-0001 [--position position] [--stage stage] [--purpose primary|integration|recovery] [--query text] [--revision ref] [--limit number] [--json] [--no-write] [--compact (requires --no-write --json)]
  temple context packet [target] --work-item WI-0001 --position position --no-write --json [--purpose primary|integration|recovery] [--material full|stage] [--expected-plan digest]
  temple context enter [target] --work-item WI-0001 --position position --agent-id agent-id --principal-id principal-id --no-write --json [--purpose primary|integration|recovery] [--material stage|task] [--format full|model] [--expected-plan digest] [--available-whole-sources JSON_ARRAY]
  temple --version

Core commands:
  init        Install Temple and project-specific Agent Identities.
  upgrade     Update only checksum-clean managed files; preserve project-owned state.
  backup      Create and verify a transparent, content-addressed backup of project-owned Temple state.
  restore     Preview, apply, or safely recover an interrupted project-owned-state restore.
  audit       Export a bounded privacy-filtered audit record to an exclusive output file.
  publication Audit publication surfaces or safely minimize machine-local details in terminal canonical state.
  federation  Validate coordinator-owned multi-repository federation configuration.
  portfolio   Build a read-only federated portfolio and optionally write its coordinator view.
  experiment  Inspect a bounded validation manifest or aggregate qualified participant usage.
  doctor      Validate managed files, identities, work items, tasks, and integrations.
  status      Rebuild the observable project status from canonical files.
  observe     Build a read-only lifecycle, evidence, approval, and recovery projection.
  control-plane Run the local replay-safe telemetry journal, provider surface, snapshot API, and SSE stream.
  console     Optionally serve the read-only human Management Console without starting collection.
  collaboration Configure Human Principals, Agent sponsorship, Position membership, and the operating profile.
  work-item   Create and configure work items, revisioned contracts, UI mode, claims, and unresolved items.
  parallel    Check one item or build deterministic safe dispatch waves for a group.
  resource    Define and inspect shared runtime or verification capacity.
  worker      Correlate reserved work with internal subagents or user-owned Codex tasks.
  evidence    Normalize local Git, test, runtime, claim, risk, and rollback observations without satisfying gates.
  schema      Validate cataloged project and generated JSON through Draft 2020-12 schemas.
  migration   Inspect versioned framework and explicit project-data migrations.
  learning    Capture, revalidate, retrieve, and evaluate project-owned engineering learning.
  retrieval   Inspect the deterministic default and unconfigured local-hybrid boundary.
  evaluation  Score versioned adversarial policy observations without changing lifecycle authority.
  usage       Collect optional provider telemetry or build a numeric usage-driver baseline without prompts, prices, or automatic model routing.
  execution   Resolve explainable per-step execution routes without contacting a Provider or changing project state.
  adapter     Inspect or install an opt-in, pinned, isolated local adapter.
  handoff     Create an evidence-bearing Position handoff artifact.
  transition  Enforce the workflow edge and its named gate requirements.
  close       Record release readiness and close or block a release-gate item.
  task        Register Codex task/thread identity, status, revision, and archive readiness.
  tracker     Link team-visible Work Items to external trackers through inspect, plan, and explicit reconciliation.
  pack        List, install, or remove checksum-managed optional Skill packs.
  capability  Discover installed repository Skills without taking ownership of project extensions.
  context     Resolve a bounded work-item Context Capsule through the configured Retrieval Provider.

Repeat --scope, --acceptance, --completed, --evidence, --unresolved, --resolve,
--merge, --affected-path, --context-ref, --spec-ref, --ux-ref, --ui-ref,
--contract-ref, --stage-discipline, --stage-resource, --clear-stage-requirement, --rollback, --reason,
or --satisfy as needed. Configure merges document refs by ID;
use the matching --replace-*-refs flag to replace or clear a complete category. Temple never creates, renames, or archives a
Codex task by itself; task registry entries make those app actions observable.
`;

const CHAMBER = `The chamber is open.

Outside: one idea.
Inside: many Positions learn, build, challenge, and verify in parallel.
Only evidence leaves the chamber.`;

const BOOLEAN_FLAGS = new Set([
  "--enable-headroom",
  "--allow-lossy-headroom",
  "--same-scope",
  "--compact",
  "--dry-run",
  "--integrate-agents",
  "--self-host",
  "--json",
  "--no-write",
  "--help",
  "--replace-spec-refs",
  "--replace-ux-refs",
  "--replace-ui-refs",
  "--replace-contract-refs",
  "--clear-disciplines",
  "--codex",
  "--tailscale-viewer",
  "--probe-codex-account",
  "--allow-replace",
  "--confirm-delete",
  "--activate",
  "--confirm-replace",
  "--confirm-normalization"
]);
const VALUE_FLAGS = new Set([
  "--kind", "--python", "--snapshot",
  "--actor-policy", "--fingerprint", "--bundle", "--incoming-revision", "--transaction-id", "--condition-kind",
  "--supersedes",
  "--available-whole-sources",
  "--judgment", "--test-evidence", "--lean-closeout",
  "--config",
  "--title",
  "--actor",
  "--work-item",
  "--evidence-id",
  "--replacement-evidence-id",
  "--to",
  "--input-revision",
  "--decision",
  "--tested-revision",
  "--approval",
  "--position",
  "--stage",
  "--purpose",
  "--material",
  "--mechanical-contract",
  "--format",
  "--expected-sha256",
  "--thread-id",
  "--client-thread-id",
  "--host-id",
  "--status",
  "--revision",
  "--launch-revision",
  "--execution-origin",
  "--requested-model",
  "--effective-model",
  "--reasoning-effort",
  "--requested-reasoning-effort",
  "--observed-thread-reasoning-effort",
  "--effective-turn-reasoning-effort",
  "--reasoning-effort-source",
  "--service-tier",
  "--task-id",
  "--notes",
  "--pack",
  "--query",
  "--request",
  "--input",
  "--limit",
  "--max-workers",
  "--scope",
  "--acceptance",
  "--completed",
  "--evidence",
  "--unresolved",
  "--resolve",
  "--merge",
  "--rollback",
  "--reason",
  "--satisfy",
  "--affected-path",
  "--context-ref",
  "--spec-ref",
  "--ux-ref",
  "--ui-ref",
  "--contract-ref",
  "--spec-mode",
  "--ui-mode",
  "--workflow-profile",
  "--scope-class",
  "--escalation-trigger",
  "--profile-rationale",
  "--profile-evidence",
  "--profile",
  "--surface",
  "--principal-id",
  "--verification-class",
  "--provider-subject",
  "--provider-handle",
  "--evidence-ref",
  "--expires-at",
  "--grant-id",
  "--approved-by",
  "--trustee",
  "--threshold",
  "--validation-level",
  "--participant-principal",
  "--environment",
  "--name",
  "--agent-id",
  "--discipline",
  "--stage-discipline",
  "--stage-resource",
  "--clear-stage-requirement",
  "--parent",
  "--depends-on",
  "--base-revision",
  "--parallel-mode",
  "--integration-owner",
  "--shared-contract-ref",
  "--contract-status",
  "--approval-ref",
  "--overlap-resolution",
  "--branch",
  "--worktree",
  "--tracker-profile",
  "--sync-granularity",
  "--provider-id",
  "--provider-kind",
  "--project",
  "--base-url",
  "--provider-status",
  "--read-policy",
  "--write-policy",
  "--default-provider",
  "--tracker-visibility",
  "--visibility",
  "--item-id",
  "--url",
  "--role",
  "--observation",
  "--resolution",
  "--resource-id",
  "--capacity",
  "--description",
  "--runtime-kind",
  "--worker-id",
  "--runtime-id",
  "--summary",
  "--expected-verification",
  "--severity",
  "--risk-status",
  "--mitigation",
  "--procedure",
  "--rollback-status",
  "--risk-tier",
  "--outcome",
  "--confidence",
  "--tag",
  "--applies-to",
  "--source-work-item",
  "--derived-from",
  "--owner-position",
  "--operation-id",
  "--claim-id",
  "--learning-id",
  "--proposal-id",
  "--skill-name",
  "--trigger",
  "--non-trigger",
  "--authority",
  "--risk-class",
  "--overlap-review",
  "--dependency",
  "--alternative",
  "--result",
  "--review-after",
  "--fixture",
  "--source",
  "--state-dir",
  "--host",
  "--port",
  "--lan-viewer-host",
  "--lan-viewer-port",
  "--repository-interval",
  "--observation-mode",
  "--codex-command",
  "--output",
  "--backup",
  "--expected-plan",
  "--root",
  "--backup-root",
  "--allowed-root",
  "--manifest",
  "--minimum-to-keep",
  "--preserve",
  "--event-type",
  "--redact-key",
  "--max-events",
  "--max-recovery-transactions",
  "--max-event-bytes"
]);
const REPEATABLE_FLAGS = new Set([
  "--test-evidence", "--lean-closeout",
  "--scope",
  "--acceptance",
  "--completed",
  "--evidence",
  "--unresolved",
  "--resolve",
  "--merge",
  "--rollback",
  "--reason",
  "--satisfy",
  "--affected-path",
  "--context-ref",
  "--spec-ref",
  "--ux-ref",
  "--ui-ref",
  "--contract-ref",
  "--discipline",
  "--stage-discipline",
  "--stage-resource",
  "--clear-stage-requirement",
  "--depends-on",
  "--shared-contract-ref",
  "--overlap-resolution",
  "--tag",
  "--applies-to",
  "--source-work-item",
  "--derived-from",
  "--dependency",
  "--alternative",
  "--preserve",
  "--event-type",
  "--redact-key",
  "--approved-by",
  "--trustee",
  "--participant-principal",
  "--environment"
]);
const NESTED_COMMANDS = new Set(["measurement", "reconcile", "delivery", "work-item", "task", "tracker", "pack", "capability", "context", "collaboration", "parallel", "resource", "worker", "evidence", "schema", "migration", "learning", "retrieval", "evaluation", "usage", "execution", "adapter", "control-plane", "console", "backup", "restore", "audit", "publication", "federation", "portfolio", "experiment"]);

function parseCommand(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", action: null, target: ".", flags: new Set(), options: {} };
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    return { command: "version", action: null, target: ".", flags: new Set(), options: {} };
  }

  const command = argv[0];
  let action = null;
  let start = 1;
  if (NESTED_COMMANDS.has(command)) {
    action = argv[1];
    if (!action || action.startsWith("--")) throw new Error(`${command} requires an action`);
    start = 2;
  }

  const flags = new Set();
  const options = {};
  const positionals = [];
  for (let index = start; index < argv.length; index += 1) {
    const token = argv[index];
    if (BOOLEAN_FLAGS.has(token)) {
      flags.add(token);
    } else if (VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
      if (command === "context" && action === "enter" && Object.hasOwn(options, token)) throw new OperationError("INVALID_INPUT", `Context enter option may appear only once: ${token}`);
      if (command === "learning" && token === "--learning-id" && action !== "record-review" && Object.hasOwn(options, token)) throw new Error("This Learning operation accepts exactly one --learning-id");
      if (REPEATABLE_FLAGS.has(token) || command === "learning" && action === "record-review" && token === "--learning-id") options[token] = [...(options[token] ?? []), value];
      else options[token] = value;
      index += 1;
    } else if (token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }
  if (positionals.length > 1) throw new Error(`Unexpected arguments: ${positionals.slice(1).join(" ")}`);
  return { command, action, target: positionals[0] ?? ".", flags, options };
}

function listOption(parsed, flag) {
  const value = parsed.options[flag];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function backupRootOption(parsed) {
  const root = parsed.options["--root"];
  const legacyRoot = parsed.options["--backup-root"];
  if (root && legacyRoot && root !== legacyRoot) {
    throw new Error("Use either --root or --backup-root for one backup-set directory");
  }
  return root ?? legacyRoot;
}

function parseSatisfied(values) {
  const output = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`Invalid --satisfy value ${value}; use requirement=reference`);
    }
    const requirement = value.slice(0, separator).trim();
    const reference = value.slice(separator + 1).trim();
    output[requirement] = [...(output[requirement] ?? []), reference];
  }
  return output;
}

function parseDocumentReferences(values, flag) {
  const references = [];
  const seen = new Set();
  for (const value of values) {
    const separator = value.indexOf("@");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`Invalid ${flag} value ${value}; use ID@revision`);
    }
    const id = value.slice(0, separator).trim();
    const revision = value.slice(separator + 1).trim();
    if (!id || !revision) throw new Error(`Invalid ${flag} value ${value}; use ID@revision`);
    if (seen.has(id)) throw new Error(`${flag} contains duplicate reference: ${id}`);
    seen.add(id);
    references.push({ id, revision });
  }
  return references;
}

function parseStageRequirements(disciplineValues, resourceValues, clearStages = []) {
  if (disciplineValues.length === 0 && resourceValues.length === 0 && clearStages.length === 0) return undefined;
  const output = {};
  for (const value of clearStages) {
    const stage = String(value).trim();
    if (!stage) throw new Error("--clear-stage-requirement requires a lifecycle stage");
    output[stage] = null;
  }
  for (const value of disciplineValues) {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`Invalid --stage-discipline value ${value}; use stage=discipline`);
    }
    const stage = value.slice(0, separator).trim();
    const discipline = value.slice(separator + 1).trim();
    output[stage] = { ...(output[stage] ?? {}), disciplines: [...(output[stage]?.disciplines ?? []), discipline] };
  }
  for (const value of resourceValues) {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`Invalid --stage-resource value ${value}; use stage=resource-id[:units]`);
    }
    const stage = value.slice(0, separator).trim();
    const resourceValue = value.slice(separator + 1).trim();
    const unitsSeparator = resourceValue.lastIndexOf(":");
    const hasUnits = unitsSeparator > 0 && /^[0-9]+$/.test(resourceValue.slice(unitsSeparator + 1));
    const resourceId = hasUnits ? resourceValue.slice(0, unitsSeparator) : resourceValue;
    const units = hasUnits ? Number(resourceValue.slice(unitsSeparator + 1)) : 1;
    output[stage] = {
      ...(output[stage] ?? {}),
      resources: [...(output[stage]?.resources ?? []), { resource_id: resourceId, units }]
    };
  }
  return output;
}

function projectIdFromDirectory(target) {
  const fallback = path.basename(path.resolve(target))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fallback || "software-project";
}

function shellQuote(value) {
  if (process.platform === "win32") return `'${String(value).replaceAll("'", "''")}'`;
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function directCliCommand(command, target, trailingArguments = []) {
  const commandArguments = Array.isArray(command) ? command : [command];
  const invocation = [
    process.execPath,
    path.join(path.resolve(target), "templew.mjs"),
    ...commandArguments,
    path.resolve(target),
    ...trailingArguments
  ]
    .map(shellQuote)
    .join(" ");
  return process.platform === "win32" ? `& ${invocation}` : invocation;
}

function summarizeInitPlan(plan) {
  const actionCounts = {};
  for (const action of plan.actions) actionCounts[action.type] = (actionCounts[action.type] ?? 0) + 1;
  return {
    actions: Object.fromEntries(Object.entries(actionCounts).sort(([left], [right]) => left.localeCompare(right))),
    warnings: plan.warnings,
    conflicts: plan.conflicts,
    agents_integration: plan.agentsIntegration,
    claude_integration: plan.claudeIntegration,
    repository_integration: plan.state.repositoryIntegration.status,
    installation_mode: plan.selfHost ? "toolkit-self-host" : "project"
  };
}

function initInstructionSources(agentsIntegration) {
  const agentsSources =
    agentsIntegration === "pending_merge"
      ? [
          {
            path: "AGENTS.md",
            role: "existing-project-instructions",
            integration: "preserved"
          },
          {
            path: ".ai-org/project/AGENTS.temple.md",
            role: "temple-instructions-pending-approved-merge",
            integration: "pending_merge"
          }
        ]
      : [
          {
            path: "AGENTS.md",
            role: "active-agent-instructions",
            integration: agentsIntegration
          }
        ];
  return [
    ...agentsSources,
    {
      path: "TEMPLE.md",
      role: "project-organization-operating-contract",
      integration: "managed"
    },
    {
      path: ".agents/skills/temple-work/SKILL.md",
      role: "canonical-lifecycle-mutation-skill",
      integration: "managed"
    }
  ];
}

function buildInitBootstrapRequirement(plan) {
  const pendingAgentsMerge = plan.agentsIntegration === "pending_merge";
  const pendingClaudeMerge = plan.claudeIntegration === "pending_merge";
  const doctorCommand = directCliCommand("doctor", plan.target);
  const statusCommand = directCliCommand("status", plan.target, ["--no-write", "--json"]);
  const contextCommandTemplate = directCliCommand(["context", "resolve"], plan.target, [
    "--work-item",
    "<WI-ID>",
    "--position",
    "<position>",
    "--no-write",
    "--json"
  ]);
  const instructionSources = initInstructionSources(plan.agentsIntegration);
  const freshSessionActions = [];
  if (pendingAgentsMerge) {
    freshSessionActions.push(
      "Complete an approved merge of .ai-org/project/AGENTS.temple.md into AGENTS.md; a fresh session alone cannot activate an unmerged root instruction contract."
    );
  }
  if (pendingClaudeMerge) {
    freshSessionActions.push(
      "Complete an approved merge of .ai-org/project/CLAUDE.temple.md into the existing project-owned CLAUDE.md; a fresh session alone cannot activate an unmerged Claude Code entrypoint."
    );
  }
  freshSessionActions.push(
    "For Claude Code, confirm through provider-owned context inspection that the fresh session loaded CLAUDE.md; for another Agent platform, confirm its supported entrypoint separately. This CLI does not perform or verify that observation.",
    "End the current Agent session.",
    "Start a fresh Agent session rooted at this initialized repository.",
    "Require the new session to follow the installed repository instructions before Temple-governed work."
  );
  return {
    schema_version: "temple.bootstrap-required/v1",
    marker: "TEMPLE_BOOTSTRAP_REQUIRED",
    status: "required",
    reason: "current_session_may_not_have_loaded_installed_instructions",
    temple_version: TEMPLATE_VERSION,
    target: path.resolve(plan.target),
    agents_integration: plan.agentsIntegration,
    claude_integration: plan.claudeIntegration,
    provider_entrypoint: {
      provider: "claude-code",
      path: "CLAUDE.md",
      integration: plan.claudeIntegration,
      status: pendingClaudeMerge ? "pending_merge" : "available",
      compatibility_verified: !pendingClaudeMerge,
      adapter_installed: !pendingClaudeMerge,
      adapter_created_by_init: plan.claudeIntegration === "installed",
      session_loading_verified: false,
      comprehension_verified: false,
      pending_merge_source: pendingClaudeMerge ? ".ai-org/project/CLAUDE.temple.md" : null,
      limitation: pendingClaudeMerge
        ? "The existing project-owned CLAUDE.md is preserved and does not yet import canonical AGENTS.md instructions."
        : "The documented import form is available, but provider session loading remains unverified."
    },
    instruction_sources: instructionSources,
    recommended_path: {
      id: "fresh-session",
      strength: "recommended",
      reason: "Agent instruction loading is platform-owned and may occur only when a session starts.",
      actions: freshSessionActions
    },
    continuation_path: {
      id: "explicit-read",
      strength: "supported",
      steps: [
        {
          id: "read-instruction-sources",
          instruction: "Read every instruction source named by this result before continuing.",
          paths: instructionSources.map((source) => source.path)
        },
        {
          id: "verify-installation",
          instruction: "Run the repository-pinned Doctor command.",
          command: doctorCommand
        },
        {
          id: "inspect-canonical-status",
          instruction: "Run read-only Status and use canonical Assignments to identify the intended Position and Agent Identity.",
          command: statusCommand
        },
        {
          id: "establish-work-item",
          instruction: "Identify or create one durable Work Item through the normal lifecycle; this bootstrap result grants no mutation authority."
        },
        {
          id: "resolve-work-item-context",
          instruction: "Before scoped work, replace the placeholders and run the read-only Context command.",
          command_template: contextCommandTemplate
        },
        {
          id: "report-bootstrap-context",
          instruction: "Report the Position, Agent Identity, Work Item ID, and next canonical action before governed mutation."
        }
      ]
    },
    verification: {
      first_post_init_action: "doctor-and-status-read-only-confirmation",
      doctor_command: doctorCommand,
      status_command: statusCommand,
      context_command_template: contextCommandTemplate,
      required_report_fields: ["position", "agent_identity", "work_item_id", "next_canonical_action"]
    },
    authority: {
      verifies_instruction_loading: false,
      verifies_model_comprehension: false,
      records_acknowledgement_as_evidence: false,
      creates_work_item: false,
      creates_claim: false,
      transitions_lifecycle: false,
      closes_work_item: false,
      performs_external_action: false
    }
  };
}

function buildInitResult(plan, status, options = {}) {
  return {
    schema_version: "temple.init-result/v1",
    status,
    temple_version: TEMPLATE_VERSION,
    target: path.resolve(plan.target),
    files_written: options.filesWritten ?? false,
    plan: summarizeInitPlan(plan),
    doctor: options.doctor ?? null,
    status_view: options.statusPath ?? null,
    commands: options.commands ?? null,
    bootstrap: options.bootstrap ?? null
  };
}

function formatInitBootstrapRequirement(requirement) {
  const lines = [
    requirement.marker,
    `Schema: ${requirement.schema_version}`,
    "Current session warning: the Agent may not have loaded the instruction sources installed or reconciled by init.",
    `Claude Code entrypoint: ${requirement.provider_entrypoint.status} (${requirement.claude_integration}).`,
    `AGENTS.md integration: ${requirement.agents_integration}`,
    `CLAUDE.md integration: ${requirement.claude_integration}`,
    "Instruction sources:"
  ];
  for (const source of requirement.instruction_sources) {
    lines.push(`  - ${source.path} (${source.role}; ${source.integration})`);
  }
  lines.push("Recommended path: fresh-session");
  requirement.recommended_path.actions.forEach((action, index) => lines.push(`  ${index + 1}. ${action}`));
  lines.push("Supported continuation: explicit-read");
  requirement.continuation_path.steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step.instruction}`);
    if (step.command) lines.push(`     ${step.command}`);
    if (step.command_template) lines.push(`     ${step.command_template}`);
  });
  lines.push(
    `Required report: ${requirement.verification.required_report_fields.join(", ")}`,
    "Authority boundary: this result does not prove instruction loading or comprehension and does not create evidence, authority, lifecycle progress, closeout, or an external action."
  );
  return lines.join("\n");
}

async function askWithDefault(interfaceInstance, prompt, defaultValue) {
  const answer = (await interfaceInstance.question(`${prompt} [${defaultValue}]: `)).trim();
  return answer || defaultValue;
}

async function collectInteractiveConfig(target) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "Non-interactive init requires --config. Start with docs/getting-started/temple-init.example.json; repository_integration is optional and defaults to unconfirmed. Use $temple-init in Codex for an inspected, user-confirmed setup."
    );
  }
  const prompt = readline.createInterface({ input, output });
  try {
    output.write("Temple will create project-specific identities. No names come from the template.\n");
    const defaultProjectId = projectIdFromDirectory(target);
    const projectName = await askWithDefault(prompt, "Project name", path.basename(path.resolve(target)) || "Software Project");
    const projectId = await askWithDefault(prompt, "Project ID", defaultProjectId);
    const agents = [];
    for (const slot of LEAN_ASSIGNMENT_SLOTS) {
      const displayName = (await prompt.question(`English name for ${slot.label}: `)).trim();
      agents.push({ display_name: displayName, positions: slot.positions });
    }
    return { schema_version: "temple.init/v1", project: { id: projectId, name: projectName }, naming_mode: "manual", agents };
  } finally {
    prompt.close();
  }
}

async function readStandardInput() {
  let content = "";
  input.setEncoding("utf8");
  for await (const chunk of input) content += chunk;
  return JSON.parse(content);
}

async function loadConfig(configPath, target) {
  if (!configPath) return collectInteractiveConfig(target);
  if (configPath === "-") return readStandardInput();
  return readJson(path.resolve(configPath));
}

async function refreshViews(target) {
  const registry = await buildCapabilityRegistry(target);
  const status = await buildStatus(target, { capabilityRegistry: registry });
  const [statusPath, capabilityPath] = await Promise.all([
    writeStatus(target, status),
    writeCapabilityRegistry(target, registry)
  ]);
  return { status, statusPath, capabilityPath };
}

function positiveIntegerOption(parsed, flag, fallback = 5) {
  const raw = parsed.options[flag];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error(`${flag} must be an integer from 1 to 50`);
  }
  return value;
}

function optionalPositiveIntegerOption(parsed, flag) {
  if (parsed.options[flag] === undefined) return null;
  return positiveIntegerOption(parsed, flag, null);
}

function boundedIntegerOption(parsed, flag, maximum) {
  const raw = parsed.options[flag];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${flag} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function printResult(parsed, result, lines) {
  if (parsed.flags.has("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(lines.join("\n"));
}

async function runInit(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const config = await validateInitConfig(await loadConfig(parsed.options["--config"], target));
  const json = parsed.flags.has("--json");
  const options = {
    integrateAgents: parsed.flags.has("--integrate-agents"),
    selfHost: parsed.flags.has("--self-host")
  };
  const plan = await planInit(target, config, options);
  if (!json) console.log(formatInitPlan(plan));
  if (plan.conflicts.length > 0) {
    if (json) console.log(JSON.stringify(buildInitResult(plan, "conflict"), null, 2));
    return 1;
  }
  if (parsed.flags.has("--dry-run")) {
    if (json) console.log(JSON.stringify(buildInitResult(plan, "planned"), null, 2));
    else console.log("Dry run complete; no files were written.");
    return 0;
  }
  const { doctor, statusPath, executedPlan } = await withProjectMutationLock(target, async () => {
    const lockedPlan = await planInit(target, config, options);
    if (lockedPlan.conflicts.length > 0) {
      throw new Error(`Initialization stopped before writing:\n- ${lockedPlan.conflicts.join("\n- ")}`);
    }
    await executeInit(lockedPlan);
    const lockedDoctor = await runDoctor(target);
    const views = await refreshViews(target);
    return { doctor: lockedDoctor, statusPath: views.statusPath, executedPlan: lockedPlan };
  });
  const commands = {
    doctor: directCliCommand("doctor", target),
    status: directCliCommand("status", target),
    status_read_only: directCliCommand("status", target, ["--no-write", "--json"])
  };
  const bootstrap = doctor.healthy ? buildInitBootstrapRequirement(executedPlan) : null;
  const result = buildInitResult(executedPlan, doctor.healthy ? "initialized" : "unhealthy", {
    filesWritten: true,
    doctor,
    statusPath,
    commands,
    bootstrap
  });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Initialized Temple ${TEMPLATE_VERSION}.`);
    console.log(formatDoctor(doctor));
    console.log(`Status view: ${statusPath}`);
    console.log(`Copyable project commands (${process.platform === "win32" ? "PowerShell" : "POSIX shell"}):`);
    console.log(`  Doctor: ${commands.doctor}`);
    console.log(`  Status: ${commands.status}`);
    if (bootstrap) console.log(formatInitBootstrapRequirement(bootstrap));
  }
  return doctor.healthy ? 0 : 1;
}

async function runUpgrade(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const plan = await planUpgrade(target);
  console.log(formatUpgradePlan(plan));
  if (plan.conflicts.length > 0) return 1;
  if (parsed.flags.has("--dry-run")) {
    console.log("Dry run complete; no files were written.");
    return 0;
  }
  await withProjectMutationLock(target, async () => {
    const lockedPlan = await planUpgrade(target);
    if (lockedPlan.conflicts.length > 0) throw new Error(`Upgrade stopped before writing:\n- ${lockedPlan.conflicts.join("\n- ")}`);
    await executeUpgrade(lockedPlan);
    await refreshViews(target);
  });
  const doctor = await runDoctor(target);
  console.log(
    plan.actions.some((action) => action.type === "update-lock")
      ? `Upgraded Temple to ${TEMPLATE_VERSION}.`
      : `Temple is already current at ${TEMPLATE_VERSION}.`
  );
  console.log(formatDoctor(doctor));
  return doctor.healthy ? 0 : 1;
}

async function runBackup(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "create") {
    if (!parsed.options["--output"]) throw new Error("backup create requires --output");
    const result = await withProjectMutationLock(target, () => createBackup(target, parsed.options["--output"]));
    printResult(parsed, result, [
      `Created Temple backup: ${result.backup}`,
      `Project / version: ${result.project_id} / ${result.temple_version}`,
      `Files / bytes: ${result.file_count} / ${result.total_size}`,
      `Content digest: ${result.content_digest}`,
      "Application source and external systems: not included"
    ]);
    return 0;
  }
  if (parsed.action === "inspect") {
    if (!parsed.options["--backup"]) throw new Error("backup inspect requires --backup");
    const result = await inspectBackup(parsed.options["--backup"]);
    printResult(parsed, result, [
      `Valid Temple backup: ${result.backup}`,
      `Project / version: ${result.project_id} / ${result.temple_version}`,
      `Files / bytes: ${result.file_count} / ${result.total_size}`,
      `Manifest digest: ${result.manifest_digest}`,
      "Canonical state changed: no"
    ]);
    return 0;
  }
  if (parsed.action === "set-inspect") {
    const backupRoot = backupRootOption(parsed);
    if (!backupRoot) throw new Error("backup set-inspect requires --root");
    const result = await inspectBackupSet(backupRoot, { projectRoot: target });
    printResult(parsed, result, [
      `Valid Temple backup set: ${result.backup_root}`,
      `Backups: ${result.backup_count}`,
      `Inspection digest: ${result.inspection_digest}`,
      "Canonical state changed: no"
    ]);
    return 0;
  }
  if (parsed.action === "retention-preview") {
    const backupRoot = backupRootOption(parsed);
    if (!backupRoot || !parsed.options["--minimum-to-keep"]) {
      throw new Error("backup retention-preview requires --root and --minimum-to-keep");
    }
    const plan = await planBackupRetention(target, backupRoot, {
      minimumToKeep: boundedIntegerOption(parsed, "--minimum-to-keep", 10_000),
      preserveBackupNames: listOption(parsed, "--preserve")
    });
    printResult(parsed, plan, [
      `Temple backup retention preview for ${plan.backup_root}`,
      `Keep / delete: ${plan.keep_count} / ${plan.delete_count}`,
      `Explicitly preserved: ${plan.preserve_backup_names.join(", ") || "none"}`,
      `Plan digest: ${plan.plan_digest}`,
      "Canonical state changed: no"
    ]);
    return 0;
  }
  if (parsed.action === "retention-apply") {
    const backupRoot = backupRootOption(parsed);
    if (
      !backupRoot ||
      !parsed.options["--minimum-to-keep"] ||
      !parsed.options["--expected-plan"]
    ) {
      throw new Error("backup retention-apply requires --root, --minimum-to-keep, and --expected-plan");
    }
    if (!parsed.flags.has("--confirm-delete")) {
      throw new Error("backup retention-apply requires --confirm-delete");
    }
    const result = await withProjectMutationLock(target, () =>
      applyBackupRetention(target, backupRoot, {
        minimumToKeep: boundedIntegerOption(parsed, "--minimum-to-keep", 10_000),
        preserveBackupNames: listOption(parsed, "--preserve"),
        expectedPlan: parsed.options["--expected-plan"],
        confirmDelete: true
      })
    );
    printResult(parsed, result, [
      `Applied Temple backup retention: ${result.plan_digest}`,
      `Deleted / preserved: ${result.deleted_count} / ${result.preserved_count}`,
      `Deleted backups: ${result.deleted.join(", ") || "none"}`,
      "Project canonical state changed: no"
    ]);
    return 0;
  }
  throw new Error(`Unknown backup action: ${parsed.action}`);
}

async function runAudit(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action !== "export") throw new Error(`Unknown audit action: ${parsed.action}`);
  if (!parsed.options["--output"]) throw new Error("audit export requires --output");
  const result = await writeAuditExport(target, parsed.options["--output"], {
    workItemIds: parsed.options["--work-item"] ? [parsed.options["--work-item"]] : [],
    eventTypes: listOption(parsed, "--event-type"),
    redactKeys: listOption(parsed, "--redact-key"),
    maxEvents: boundedIntegerOption(parsed, "--max-events", 10_000),
    maxRecoveryTransactions: boundedIntegerOption(parsed, "--max-recovery-transactions", 100),
    maxEventBytes: boundedIntegerOption(parsed, "--max-event-bytes", 1_048_576)
  });
  printResult(parsed, result, [
    `Created Temple audit export: ${result.output}`,
    `Events / recovery transactions: ${result.event_count} / ${result.recovery_transaction_count}`,
    `Export digest: ${result.export_digest}`,
    "Canonical state changed: no"
  ]);
  return 0;
}

async function runPublication(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "audit") {
    const result = await buildPublicationAudit(target, {
      profileId: parsed.options["--profile"],
      surface: parsed.options["--surface"]
    });
    printResult(parsed, result, [
      `Publication audit: ${result.status}`,
      `Profile / surface: ${result.profile} / ${result.requested_surface}`,
      `Blocked / review required: ${result.summary.blocked} / ${result.summary.review_required}`,
      `Files / binary review: ${result.summary.files} / ${result.summary.binary_files_requiring_review}`,
      result.legacy_baseline
        ? `Reviewed legacy baseline: ${result.legacy_baseline.revision}`
        : "Reviewed legacy baseline: none",
      "Matched values printed: no",
      "Canonical state changed: no",
      "Publication authorized: no"
    ]);
    return result.status === "blocked" ? 1 : 0;
  }
  if (parsed.action === "normalize-plan") {
    const result = await buildPublicationNormalizationPlan(target);
    printResult(parsed, result, [
      `Canonical normalization plan: ${result.status}`,
      `Changed files / fields: ${result.summary.changed_files} / ${result.summary.change_count}`,
      `Retained active coordinates: ${result.summary.retained_active_coordinates}`,
      `Plan digest: ${result.plan_digest}`,
      "Matched values printed: no",
      "Canonical state changed: no",
      "Publication authorized: no"
    ]);
    return 0;
  }
  if (parsed.action === "normalize-apply") {
    const result = await withProjectMutationLock(target, () => applyPublicationNormalization(target, {
      workItemId: parsed.options["--work-item"],
      expectedPlan: parsed.options["--expected-plan"],
      confirmNormalization: parsed.flags.has("--confirm-normalization"),
      actor: parsed.options["--actor"]
    }));
    printResult(parsed, result, [
      result.applied ? "Canonical normalization applied." : "Canonical state already minimized; no changes applied.",
      `Changed files / fields: ${result.changed_files} / ${result.change_count}`,
      `Plan digest: ${result.plan_digest}`,
      `Audit event recorded: ${result.event_recorded ? "yes" : "no"}`,
      "Publication authorized: no"
    ]);
    return 0;
  }
  if (parsed.action === "artifact-plan") {
    const result = parsed.options["--output"]
      ? await writePublicationArtifactNormalizationPlan(target, parsed.options["--output"])
      : await buildPublicationArtifactNormalizationPlan(target);
    printResult(parsed, result, [
      `Retained-artifact normalization plan: ${result.status}`,
      `Changed files / values: ${result.summary.changed_files} / ${result.summary.change_count}`,
      `Plan digest: ${result.plan_digest}`,
      "Matched values printed: no",
      "Git history changed: no",
      "Canonical state changed: no",
      "Publication authorized: no"
    ]);
    return 0;
  }
  if (parsed.action === "artifact-apply") {
    const result = await withProjectMutationLock(target, () => applyPublicationArtifactNormalization(target, {
      workItemId: parsed.options["--work-item"],
      expectedPlan: parsed.options["--expected-plan"],
      confirmNormalization: parsed.flags.has("--confirm-normalization"),
      actor: parsed.options["--actor"],
      output: parsed.options["--output"]
    }));
    printResult(parsed, result, [
      result.applied ? "Retained-artifact normalization applied." : "Retained artifacts already minimized; no changes applied.",
      `Changed files / values: ${result.changed_files} / ${result.change_count}`,
      `Plan digest: ${result.plan_digest}`,
      `Audit event recorded: ${result.event_recorded ? "yes" : "no"}`,
      "Git history changed: no",
      "Publication authorized: no"
    ]);
    return 0;
  }
  throw new Error(`Unknown publication action: ${parsed.action}`);
}

async function runFederation(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action !== "validate") throw new Error(`Unknown federation action: ${parsed.action}`);
  const registry = await readFederationRegistry(target);
  const result = validateFederationRegistry(registry);
  printResult(parsed, result, result.valid
    ? ["Federation registry is valid.", "Canonical state changed: no"]
    : ["Federation registry is invalid.", ...result.errors.map((error) => `- ${error}`), "Canonical state changed: no"]);
  return result.valid ? 0 : 1;
}

async function runPortfolio(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action !== "build") throw new Error(`Unknown portfolio action: ${parsed.action}`);
  const portfolio = await buildFederatedPortfolio(target, { allowedRoot: parsed.options["--allowed-root"] });
  const outputPath = path.join(target, ".ai-org/views/portfolio.json");
  if (!parsed.flags.has("--no-write")) await atomicWrite(outputPath, formatJson(portfolio));
  if (parsed.flags.has("--json")) console.log(JSON.stringify(portfolio, null, 2));
  else {
    console.log(`Federated portfolio for ${target}`);
    console.log(`Participants current / unknown: ${portfolio.summary.current} / ${portfolio.summary.unknown}`);
    console.log(`Work Items projected: ${portfolio.summary.work_items_projected}`);
    if (!parsed.flags.has("--no-write")) console.log(`Portfolio view: ${path.relative(target, outputPath).split(path.sep).join("/")}`);
    console.log("Participant and lifecycle state changed: no");
  }
  return 0;
}

async function runExperiment(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (!parsed.options["--manifest"] || !parsed.options["--allowed-root"]) {
    throw new Error(`experiment ${parsed.action ?? "command"} requires --manifest and --allowed-root`);
  }
  const options = {
    manifestPath: parsed.options["--manifest"],
    allowedRoot: parsed.options["--allowed-root"]
  };
  if (parsed.action === "inspect") {
    const inspection = await inspectValidationProgram(target, options);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(inspection, null, 2));
    else {
      console.log(`Validation program: ${inspection.id}`);
      console.log(`Participants / waves: ${inspection.participants.length} / ${inspection.waves.length}`);
      console.log(`Turns / concurrency: ${inspection.waves.reduce((sum, wave) => sum + wave.turns.length, 0)} / ${inspection.limits.max_concurrency}`);
      console.log(`Retries / network / external spend: ${inspection.limits.max_retries} / disabled / ¥0`);
      console.log("Model generation requested: no");
      console.log("Canonical state changed: no");
    }
    return 0;
  }
  if (parsed.action !== "report") throw new Error(`Unknown experiment action: ${parsed.action}`);
  const report = await buildCrossRepositoryUsageReport(target, options);
  const outputPath = path.join(target, VALIDATION_PROGRAM_REPORT_VIEW);
  if (!parsed.flags.has("--no-write")) await atomicWrite(outputPath, formatJson(report));
  if (parsed.flags.has("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Cross-repository usage: ${report.status}`);
    console.log(`Qualified Work Items: ${report.qualification.qualified_completed_work_items}/${report.qualification.required_completed_work_items}`);
    console.log(`Task shapes: ${report.qualification.qualified_task_shapes}/${report.qualification.required_task_shapes}`);
    console.log(`Qualified Tokens: ${report.totals.total_tokens ?? "unknown"}; monetary cost: unknown`);
    console.log("Savings, quality, enterprise-readiness, and routing claims: not authorized");
    if (!parsed.flags.has("--no-write")) console.log(`Report: ${VALIDATION_PROGRAM_REPORT_VIEW}`);
    console.log("Participant lifecycle state changed: no");
  }
  return 0;
}

async function runRestore(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "preview") {
    if (!parsed.options["--backup"]) throw new Error("restore preview requires --backup");
    const plan = await planRestore(target, parsed.options["--backup"]);
    const counts = Object.fromEntries(
      ["create", "replace", "identical"].map((action) => [
        action,
        plan.actions.filter((entry) => entry.action === action).length
      ])
    );
    printResult(parsed, plan, [
      `Temple restore preview for ${target}`,
      `Create / replace / identical: ${counts.create} / ${counts.replace} / ${counts.identical}`,
      `Target-only files preserved: ${plan.extras.length}`,
      `Upgrade required after restore: ${plan.compatibility.upgrade_required ? "yes" : "no"}`,
      `Conflicts: ${plan.conflicts.length}`,
      `Plan digest: ${plan.plan_digest}`,
      "Canonical state changed: no"
    ]);
    return plan.conflicts.length > 0 ? 1 : 0;
  }
  if (parsed.action === "apply") {
    if (!parsed.options["--backup"] || !parsed.options["--expected-plan"]) {
      throw new Error("restore apply requires --backup and --expected-plan");
    }
    const result = await withProjectMutationLock(target, async () => {
      const restored = await applyRestore(target, parsed.options["--backup"], {
        expectedPlan: parsed.options["--expected-plan"],
        allowReplace: parsed.flags.has("--allow-replace")
      });
      await refreshViews(target);
      return restored;
    });
    printResult(parsed, result, [
      `Restore transaction ${result.transaction_id}: ${result.status}`,
      `Created / replaced / identical: ${result.created} / ${result.replaced} / ${result.identical}`,
      `Target-only files preserved: ${result.extras_preserved}`,
      `Upgrade required: ${result.upgrade_required ? "yes" : "no"}`
    ]);
    return 0;
  }
  if (parsed.action === "recover") {
    const result = await withProjectMutationLock(target, async () => {
      const recovered = await recoverRestore(target);
      if (recovered.status === "rolled_back") await refreshViews(target);
      return recovered;
    });
    printResult(parsed, result, [
      result.status === "clean"
        ? `No interrupted Temple restore exists for ${target}`
        : `Restore transaction ${result.transaction_id}: ${result.status}`
    ]);
    return 0;
  }
  throw new Error(`Unknown restore action: ${parsed.action}`);
}

async function runDoctorCommand(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const result = await runDoctor(target);
  const output = parsed.flags.has("--compact") ? compactDoctor(result) : result;
  console.log(parsed.flags.has("--json") ? JSON.stringify(output, null, 2) : formatDoctor(output));
  return result.healthy ? 0 : 1;
}

async function runStatusCommand(parsed) {
  const compact = parsed.flags.has("--compact");
  if (compact && !parsed.flags.has("--json")) throw new Error("Compact Status requires --json");
  if (parsed.options["--work-item"] && !compact) throw new Error("Status --work-item requires --compact");
  const target = await assertSafeTarget(parsed.target);
  const registry = await buildCapabilityRegistry(target);
  const status = await buildStatus(target, { capabilityRegistry: registry });
  const output = compact ? compactStatus(status, parsed.options["--work-item"]) : status;
  if (!parsed.flags.has("--no-write")) {
    await Promise.all([writeStatus(target, status), writeCapabilityRegistry(target, registry)]);
  }
  console.log(parsed.flags.has("--json") ? JSON.stringify(output, null, 2) : renderStatusMarkdown(status));
  return 0;
}

async function runObserveCommand(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const projection = await buildObserverProjection(target);
  if (!parsed.flags.has("--no-write")) await writeObserverProjection(target, projection);
  if (parsed.flags.has("--json")) console.log(JSON.stringify(projection, null, 2));
  else {
    console.log(`${projection.project.name} Observer`);
    console.log(`Work: ${projection.work.total}`);
    console.log(`Active / blocked / QA / approval / queued: ${projection.work.categories.active} / ${projection.work.categories.blocked} / ${projection.work.categories.qa_pending} / ${projection.work.categories.approval_pending} / ${projection.work.categories.queued}`);
    console.log(`Evidence: ${projection.evidence.total} (${projection.evidence.stale} stale, ${projection.evidence.unverified} unverified, ${projection.evidence.failed} failed)`);
    console.log(`Attention: ${projection.attention.length}`);
    console.log(`Canonical state changed: no`);
    console.log(`External action: not performed`);
  }
  return 0;
}

function controlPlanePort(parsed) {
  if (parsed.options["--port"] === undefined) return undefined;
  const port = Number(parsed.options["--port"]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 to 65535");
  return port;
}

function controlPlaneInterval(parsed) {
  if (parsed.options["--repository-interval"] === undefined) return undefined;
  const interval = Number(parsed.options["--repository-interval"]);
  if (!Number.isInteger(interval) || interval < 50 || interval > 60000) {
    throw new Error("--repository-interval must be an integer from 50 to 60000 milliseconds");
  }
  return interval;
}

function controlPlaneLanPort(parsed) {
  const host = parsed.options["--lan-viewer-host"];
  const value = parsed.options["--lan-viewer-port"];
  if (!host && value !== undefined) throw new Error("--lan-viewer-port requires --lan-viewer-host");
  if (!host) return undefined;
  if (value === undefined) return DEFAULT_LAN_VIEWER_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--lan-viewer-port must be an integer from 0 to 65535");
  }
  return port;
}

async function runControlPlane(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const options = {
    stateDirectory: parsed.options["--state-dir"],
    fixturePath: parsed.options["--fixture"]
  };
  const observerOptions = {
    stateDirectory: parsed.options["--state-dir"],
    codexCommand: parsed.options["--codex-command"]
  };
  if (parsed.action === "observer-status") {
    const status = await inspectLocalObserverService(target, options);
    printResult(parsed, status, [
      `Observation mode: ${status.observation_mode}`,
      `Managed service: ${status.service_status}`,
      `Running: ${status.running ? "yes" : "no"}`,
      `Retained usage state: ${status.state_directory}`,
      "Canonical state changed: no",
      "External action: not performed"
    ]);
    return 0;
  }
  if (parsed.action === "observer-plan") {
    const plan = await planLocalObserverService(target, observerOptions);
    printResult(parsed, plan, plan.supported ? [
      `Experimental managed Usage Collector plan: ${plan.plan_digest}`,
      "Management Console: not started or exposed",
      `Codex executable: ${plan.service.codex_command}`,
      "No files written and no service started."
    ] : [
      `Managed local Usage Collector is unsupported on ${plan.platform}.`,
      "No files written and no service started."
    ]);
    return plan.supported ? 0 : 1;
  }
  if (parsed.action === "observer-apply") {
    if (!parsed.options["--expected-plan"]) throw new Error("control-plane observer-apply requires --expected-plan");
    const result = await applyLocalObserverService(target, {
      ...observerOptions,
      expectedPlan: parsed.options["--expected-plan"],
      activate: parsed.flags.has("--activate"),
      confirmReplace: parsed.flags.has("--confirm-replace")
    });
    printResult(parsed, result, [
      `Experimental managed Usage Collector: ${result.service_status}`,
      `Plan: ${result.plan_digest}`,
      `Definition: ${result.plist_path}`,
      `Retained usage state: ${result.state_directory}`,
      `Service activation performed: ${result.external_action_performed ? "yes" : "no"}`,
      "Canonical state changed: no"
    ]);
    return 0;
  }
  if (parsed.action === "observer-remove") {
    if (!parsed.options["--expected-plan"]) throw new Error("control-plane observer-remove requires --expected-plan");
    const result = await removeLocalObserverService(target, {
      stateDirectory: parsed.options["--state-dir"],
      expectedPlan: parsed.options["--expected-plan"],
      confirmDelete: parsed.flags.has("--confirm-delete")
    });
    printResult(parsed, result, [
      "Managed local Usage Collector removed.",
      `Retained telemetry: ${result.retained_telemetry ? "yes" : "no"}`,
      `Service stop performed: ${result.external_action_performed ? "yes" : "no"}`,
      "Canonical state changed: no"
    ]);
    return 0;
  }
  if (parsed.action === "snapshot") {
    const result = await inspectControlPlane(target, options);
    printResult(parsed, result.snapshot, [
      `${result.snapshot.project.name} control plane`,
      `State: ${result.stateDirectory}`,
      `Events: ${result.snapshot.journal.retained_events}`,
      `Providers: ${result.snapshot.providers.providers.map((provider) => `${provider.id}:${provider.status}`).join(", ")}`,
      "Canonical state changed: no",
      "External action: not performed"
    ]);
    return 0;
  }
  if (parsed.action === "ingest") {
    if (!parsed.options["--fixture"]) throw new Error("control-plane ingest requires --fixture");
    const result = await ingestControlPlaneFixture(target, parsed.options["--fixture"], options);
    printResult(parsed, result, [
      `Fixture provider: ${result.result.provider_id}`,
      `Appended / duplicate: ${result.result.appended} / ${result.result.duplicates}`,
      `State: ${result.stateDirectory}`
    ]);
    return 0;
  }
  if (parsed.action === "rebuild") {
    const result = await rebuildControlPlane(target, options);
    printResult(parsed, result, [
      `Rebuilt control-plane journal from canonical repository state.`,
      `Canonical events: ${result.repository.source_events}`,
      `Archive: ${result.archivePath ?? "none"}`,
      `State: ${result.stateDirectory}`
    ]);
    return 0;
  }
  if (parsed.action === "capture-github") {
    if (!parsed.options["--provider-id"] || !parsed.options["--work-item"] || !parsed.options["--revision"]) {
      throw new Error("control-plane capture-github requires --provider-id, --work-item, and --revision");
    }
    const config = await readControlPlaneConfig(target);
    const stateDirectory = resolveControlPlaneStateDirectory(
      target,
      parsed.options["--state-dir"] ?? config.state_directory
    );
    const entry = await captureGitHubEvidence(target, stateDirectory, {
      providerId: parsed.options["--provider-id"],
      workItemId: parsed.options["--work-item"],
      revision: parsed.options["--revision"],
      actor: parsed.options["--actor"],
      title: parsed.options["--title"],
      summary: parsed.options["--summary"]
    });
    printResult(parsed, entry, [
      `Captured GitHub evidence: ${entry.id}`,
      `Work Item / revision: ${entry.work_item_id} / ${entry.scope_revision}`,
      `Outcome: ${entry.outcome}`,
      "Lifecycle gate changed: no",
      "External action: not performed"
    ]);
    return 0;
  }
  if (parsed.action === "start") {
    const requestedObservationMode = parsed.options["--observation-mode"];
    if (requestedObservationMode && !["off", "on-demand", "managed-local"].includes(requestedObservationMode)) {
      throw new Error("--observation-mode must be off, on-demand, or managed-local");
    }
    if (requestedObservationMode && requestedObservationMode !== "off" && !parsed.flags.has("--codex")) {
      throw new Error(`${requestedObservationMode} observation requires --codex`);
    }
    if (requestedObservationMode === "off" && parsed.flags.has("--codex")) {
      throw new Error("--observation-mode off cannot be combined with --codex");
    }
    const tailscaleViewer = parsed.flags.has("--tailscale-viewer")
      ? await prepareTailscalePrivateViewer()
      : null;
    const controlPlane = await startControlPlaneServer(target, {
      ...options,
      host: parsed.options["--host"],
      port: controlPlanePort(parsed),
      repositoryIntervalMs: controlPlaneInterval(parsed),
      enableCodex: parsed.flags.has("--codex"),
      observationMode: requestedObservationMode ?? (parsed.flags.has("--codex") ? "on-demand" : undefined),
      codexCommand: parsed.options["--codex-command"],
      privateViewerHost: tailscaleViewer?.host,
      lanViewerHost: parsed.options["--lan-viewer-host"],
      lanViewerPort: controlPlaneLanPort(parsed)
    });
    const shutdown = createShutdownSignalLatch();
    let privateShare = null;
    try {
      if (tailscaleViewer) privateShare = await tailscaleViewer.enable(controlPlane.port);
      console.log(`Control plane: ${controlPlane.url}`);
      if (controlPlane.lanViewerUrl) console.log(`Home LAN read-only Dashboard: ${controlPlane.lanViewerUrl}`);
      if (privateShare) console.log(`Private read-only Dashboard: ${privateShare.url}`);
      console.log(`State: ${controlPlane.stateDirectory}`);
      console.log("Press Ctrl-C to stop.");
      await shutdown.wait;
    } finally {
      try {
        if (privateShare) await privateShare.close();
      } finally {
        try {
          await controlPlane.close();
        } finally {
          shutdown.dispose();
        }
      }
    }
    return 0;
  }
  throw new Error("control-plane action must be snapshot, ingest, rebuild, capture-github, start, observer-status, observer-plan, observer-apply, or observer-remove");
}

async function runConsole(parsed) {
  if (parsed.action !== "start") throw new Error(`Unknown console action: ${parsed.action}`);
  const target = await assertSafeTarget(parsed.target);
  const tailscaleViewer = parsed.flags.has("--tailscale-viewer")
    ? await prepareTailscalePrivateViewer()
    : null;
  const server = await startManagementConsoleServer(target, {
    stateDirectory: parsed.options["--state-dir"],
    host: parsed.options["--host"],
    port: controlPlanePort(parsed),
    privateViewerHost: tailscaleViewer?.host,
    lanViewerHost: parsed.options["--lan-viewer-host"],
    lanViewerPort: controlPlaneLanPort(parsed)
  });
  const shutdown = createShutdownSignalLatch();
  let privateShare = null;
  try {
    if (tailscaleViewer) privateShare = await tailscaleViewer.enable(server.port);
    console.log(`Management Console: ${server.url}`);
    if (server.lanViewerUrl) console.log(`Home LAN read-only Console: ${server.lanViewerUrl}`);
    if (privateShare) console.log(`Private read-only Console: ${privateShare.url}`);
    console.log("Usage collection: not started");
    console.log("Writer lease: not acquired");
    console.log("Press Ctrl-C to stop.");
    await shutdown.wait;
  } finally {
    try {
      if (privateShare) await privateShare.close();
    } finally {
      await server.close();
      shutdown.dispose();
    }
  }
  return 0;
}

export function createShutdownSignalLatch(signalSource = process) {
  let resolveSignal;
  let firstSignal = null;
  let disposed = false;
  const wait = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const receive = (signal) => {
    if (firstSignal !== null) return;
    firstSignal = signal;
    resolveSignal({ signal });
  };
  const onSigint = () => receive("SIGINT");
  const onSigterm = () => receive("SIGTERM");
  signalSource.on("SIGINT", onSigint);
  signalSource.on("SIGTERM", onSigterm);
  return {
    wait,
    dispose() {
      if (disposed) return;
      disposed = true;
      signalSource.off("SIGINT", onSigint);
      signalSource.off("SIGTERM", onSigterm);
    }
  };
}

async function runEvidence(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "view") {
    assertCommandOptions(parsed, ["--source", "--format", "--expected-sha256"], ["--compact", "--json"]);
    const { evidenceView, renderEvidenceView } = await import("./evidence-view.mjs");
    const result = await evidenceView(target, { source: parsed.options["--source"], format: parsed.options["--format"],
      compact: parsed.flags.has("--compact"), expectedSha256: parsed.options["--expected-sha256"] });
    if (parsed.flags.has("--json")) console.log(JSON.stringify(result));
    else console.log(renderEvidenceView(result));
    return 0;
  }
  if (parsed.action === "list") {
    const registry = await readEvidenceRegistry(target);
    const entries = parsed.options["--work-item"]
      ? registry.entries.filter((entry) => entry.work_item_id === parsed.options["--work-item"])
      : registry.entries;
    if (parsed.flags.has("--json")) console.log(JSON.stringify({ ...registry, entries }, null, 2));
    else if (entries.length === 0) console.log("No normalized evidence recorded.");
    else for (const entry of entries) console.log(`${entry.id}\t${entry.work_item_id}\t${entry.kind}\t${entry.outcome}\t${entry.scope_revision ?? "unbound"}`);
    return 0;
  }
  if (parsed.action === "preserve") {
    if (!parsed.options["--work-item"] || !parsed.options["--revision"]) {
      throw new Error("evidence preserve requires --work-item and --revision");
    }
    const result = await withProjectMutationLock(target, () => preserveEvidenceRevision(target, {
      workItemId: parsed.options["--work-item"],
      revision: parsed.options["--revision"],
      actor: parsed.options["--actor"]
    }));
    printResult(parsed, result, [
      `${result.created ? "Created" : "Retained"} local evidence tag: ${result.tag}`,
      `Revision: ${result.revision}`,
      `Evidence entries: ${result.evidence_ids.join(", ")}`,
      `Remote preservation: git push origin refs/tags/${result.tag}`,
      "External action: not performed"
    ]);
    return 0;
  }
  if (parsed.action === "invalidate") {
    const result = await withProjectMutationLock(target, async () => {
      const invalidated = await invalidateEvidence(target, {
        evidenceId: parsed.options["--evidence-id"],
        replacementEvidenceId: parsed.options["--replacement-evidence-id"],
        reason: listOption(parsed, "--reason").join("; "),
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return invalidated;
    });
    printResult(parsed, result, [
      `Invalidated ${result.id}`,
      `Work Item: ${result.work_item_id}`,
      `Replacement: ${result.details.invalidation.replacement_evidence_id ?? "none"}`,
      "Evidence deleted: no",
      "External action: not performed"
    ]);
    return 0;
  }
  const kindByAction = {
    git: "git-revision",
    test: "test",
    runtime: "runtime",
    unverified: "unverified-claim",
    risk: "risk",
    rollback: "rollback"
  };
  const kind = kindByAction[parsed.action];
  if (!kind) throw new Error(`Unknown evidence action: ${parsed.action}`);
  if (!parsed.options["--work-item"]) throw new Error(`evidence ${parsed.action} requires --work-item`);
  const entry = await withProjectMutationLock(target, () => recordEvidence(target, kind, {
    workItemId: parsed.options["--work-item"],
    actor: parsed.options["--actor"],
    title: parsed.options["--title"],
    summary: parsed.options["--summary"],
    revision: parsed.options["--revision"],
    observation: parsed.options["--observation"],
    reason: listOption(parsed, "--reason").join("; "),
    expectedVerification: parsed.options["--expected-verification"],
    severity: parsed.options["--severity"],
    riskStatus: parsed.options["--risk-status"],
    mitigation: parsed.options["--mitigation"],
    procedure: parsed.options["--procedure"],
    rollbackStatus: parsed.options["--rollback-status"]
  }));
  printResult(parsed, entry, [
    `Recorded ${entry.id}: ${entry.kind} (${entry.outcome})`,
    `Scope revision: ${entry.scope_revision ?? "unbound"}`,
    `Reusable gate reference (copy exactly): ${entry.id}`,
    `Lifecycle gate satisfied: no`,
    `External action: not performed`
  ]);
  return 0;
}

async function runSchema(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action !== "validate") throw new Error(`Unknown schema action: ${parsed.action}`);
  const report = await validateProjectSchemas(target);
  if (parsed.flags.has("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Runtime JSON Schema validation: ${report.valid ? "PASS" : "FAIL"}`);
    console.log(`Documents: ${report.documents_checked}; Schemas: ${report.schemas_checked}`);
    for (const error of report.errors) console.log(`[FAIL] ${error.document ?? error.schema}${error.instance_path}: ${error.message}`);
  }
  return report.valid ? 0 : 1;
}

async function runMigration(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action !== "plan") throw new Error(`Unknown migration action: ${parsed.action}`);
  const plan = await buildMigrationPlan(target);
  if (parsed.flags.has("--json")) console.log(JSON.stringify(plan, null, 2));
  else {
    console.log(`Migration plan: ${plan.from_version} -> ${plan.to_version}`);
    if (plan.pending.length === 0) console.log("No pending migrations.");
    else for (const entry of plan.pending) console.log(`${entry.id}\t${entry.mode}\t${entry.description}`);
    console.log("Project-owned content changed: no");
    console.log("External action: not performed");
  }
  return 0;
}

async function runLearning(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "review-status") {
    assertCommandOptions(parsed, ["--work-item"], ["--json", "--compact"]);
    const result = await queryLearningReviews(target, { workItemId: parsed.options["--work-item"], compact: parsed.flags.has("--compact") });
    if (parsed.flags.has("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      if (result.items) for (const item of result.items) console.log(`${item.work_item_id}\t${item.status}\t${item.lesson_ids.join(", ") || "—"}\t${item.reason}`);
      else for (const [status, count] of Object.entries(result.counts)) console.log(`${status}\t${count}`);
      for (const error of result.errors) console.error(error);
    }
    return result.errors.length ? 1 : 0;
  }
  if (parsed.action === "record-review") {
    assertCommandOptions(parsed, ["--work-item", "--revision", "--result", "--actor", "--evidence", "--learning-id", "--supersedes", "--reason"], ["--json"]);
    if (listOption(parsed, "--evidence").length !== 1) throw new Error("record-review requires exactly one --evidence review note");
    if (listOption(parsed, "--reason").length > 1) throw new Error("record-review accepts one --reason");
    const result = await withProjectMutationLock(target, () => recordLearningReview(target, {
      workItemId: parsed.options["--work-item"], revision: parsed.options["--revision"],
      result: parsed.options["--result"], actor: parsed.options["--actor"],
      evidence: listOption(parsed, "--evidence")[0], learningIds: listOption(parsed, "--learning-id"),
      supersedes: parsed.options["--supersedes"], reason: listOption(parsed, "--reason")[0]
    }));
    printResult(parsed, result, [`${result.idempotent ? "Already recorded" : "Recorded"}: ${result.record.work_item_id} ${result.record.result}`, `Review: ${result.path}`]);
    return 0;
  }
  if (parsed.action === "sync-metadata") {
    assertCommandOptions(parsed, ["--learning-id"], ["--json", "--dry-run"]);
    const ids = listOption(parsed, "--learning-id");
    if (ids.length !== 1) throw new Error("sync-metadata requires exactly one --learning-id");
    const result = await withProjectMutationLock(target, () => syncLearningMetadata(target, { learningId: ids[0], dryRun: parsed.flags.has("--dry-run") }));
    printResult(parsed, result, [`${result.dry_run ? "Preview" : "Synchronized"}: ${result.learning_id}`, `Metadata differs: ${result.changed}`, "New revalidation: no"]);
    return 0;
  }
  if (["add-lesson", "add-practice"].includes(parsed.action)) {
    const kind = parsed.action === "add-lesson" ? "lesson" : "practice";
    const entry = await withProjectMutationLock(target, () => addLearningEntry(target, kind, {
      title: parsed.options["--title"],
      summary: parsed.options["--summary"],
      confidence: parsed.options["--confidence"],
      tags: listOption(parsed, "--tag"),
      appliesTo: listOption(parsed, "--applies-to"),
      sourceWorkItems: listOption(parsed, "--source-work-item"),
      evidence: listOption(parsed, "--evidence"),
      derivedFrom: listOption(parsed, "--derived-from"),
      ownerPosition: parsed.options["--owner-position"],
      actor: parsed.options["--actor"]
    }));
    printResult(parsed, entry, [`Created ${entry.id}: ${entry.title}`, `Index: .ai-org/learning/index.json`, `Record: ${entry.path}`]);
    return 0;
  }
  if (parsed.action === "revalidate") {
    const entry = await withProjectMutationLock(target, () => revalidateLearningEntry(target, {
      learningId: parsed.options["--learning-id"],
      result: parsed.options["--result"],
      evidence: listOption(parsed, "--evidence"),
      reviewAfter: parsed.options["--review-after"],
      actor: parsed.options["--actor"]
    }));
    printResult(parsed, entry, [`Revalidated ${entry.id}: ${entry.revalidation.last_result}`, `Signal: ${entry.revalidation.signal}`]);
    return 0;
  }
  if (parsed.action === "list") {
    const result = await listLearningEntries(target);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(result, null, 2));
    else if (result.entries.length === 0) console.log("No project learning recorded.");
    else for (const entry of result.entries) console.log(`${entry.id}\t${entry.status}\t${entry.revalidation.signal}\t${entry.title}`);
    return 0;
  }
  if (parsed.action === "skill-candidates") {
    const result = await listSkillPromotionCandidates(target);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(result, null, 2));
    else if (result.candidates.length === 0) console.log("No Practices recorded for Skill promotion.");
    else {
      for (const entry of result.candidates) {
        console.log(`${entry.learning_id}\t${entry.eligible ? "eligible" : entry.decision_signal}\t${entry.recurrence_count}\t${entry.title}`);
      }
      console.log("Human approval required: yes");
      console.log("Automatic Skill activation: no");
    }
    return 0;
  }
  if (parsed.action === "propose-skill") {
    const proposal = await withProjectMutationLock(target, () => proposeSkillFromLearning(target, {
      learningId: parsed.options["--learning-id"],
      reviewWorkItemId: parsed.options["--work-item"],
      skillName: parsed.options["--skill-name"],
      summary: parsed.options["--summary"],
      trigger: parsed.options["--trigger"],
      nonTrigger: parsed.options["--non-trigger"],
      authority: parsed.options["--authority"],
      riskClass: parsed.options["--risk-class"],
      dependencies: listOption(parsed, "--dependency"),
      alternatives: listOption(parsed, "--alternative"),
      overlapReview: parsed.options["--overlap-review"],
      evidence: listOption(parsed, "--evidence"),
      actor: parsed.options["--actor"]
    }));
    printResult(parsed, proposal, [
      `Created ${proposal.id} for ${proposal.skill_path}`,
      `Decision: pending human approval`,
      `Skill created or activated: no`
    ]);
    return 0;
  }
  if (parsed.action === "decide-skill") {
    const result = await withProjectMutationLock(target, () => decideSkillProposal(target, {
      proposalId: parsed.options["--proposal-id"],
      decision: parsed.options["--decision"],
      principalId: parsed.options["--principal-id"],
      reason: listOption(parsed, "--reason").join("; "),
      reviewAfter: parsed.options["--review-after"]
    }));
    printResult(parsed, result, [
      `${result.proposal.id}: ${result.proposal.status}${result.idempotent ? " (already recorded)" : ""}`,
      `Authoring Work Item: ${result.authoring_work_item?.id ?? "not created"}`,
      `Skill created or activated: no`
    ]);
    return 0;
  }
  if (parsed.action === "migrate") {
    const result = await withProjectMutationLock(target, () => migrateLearningIndex(target, { dryRun: parsed.flags.has("--dry-run") }));
    printResult(parsed, result, [`Learning index: ${result.from_schema} -> ${result.to_schema}`, `Changed: ${result.changed && !parsed.flags.has("--dry-run") ? "yes" : "no"}`, `Dry run: ${parsed.flags.has("--dry-run") ? "yes" : "no"}`]);
    return 0;
  }
  if (parsed.action === "evaluate") {
    if (!parsed.options["--fixture"]) throw new Error("learning evaluate requires --fixture");
    const report = await evaluateRetrieval(target, parsed.options["--fixture"], { write: !parsed.flags.has("--no-write") });
    if (parsed.flags.has("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Retrieval evaluation: ${report.summary.passed}/${report.summary.cases} cases`);
      console.log(`Hit rate: ${report.summary.hit_rate_at_limit}; MRR: ${report.summary.mean_reciprocal_rank}`);
      console.log(`Large-repository validation: ${report.large_repository_validation}`);
    }
    return report.summary.passed === report.summary.cases ? 0 : 1;
  }
  throw new Error(`Unknown learning action: ${parsed.action}`);
}

async function runRetrieval(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action !== "show") throw new Error(`Unknown retrieval action: ${parsed.action}`);
  const config = await readRetrievalConfig(target);
  if (parsed.flags.has("--json")) console.log(JSON.stringify(config, null, 2));
  else {
    console.log(`Selected provider: ${config.selected_provider}`);
    console.log(`Local hybrid: ${config.local_hybrid.status} (${config.local_hybrid.privacy}, deterministic fallback=${config.local_hybrid.deterministic_fallback})`);
    console.log("Installed model / embeddings / vector database / daemon: no / no / no / no");
  }
  return 0;
}

async function runEvaluation(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action !== "run") throw new Error(`Unknown evaluation action: ${parsed.action}`);
  if (!parsed.options["--fixture"]) throw new Error("evaluation run requires --fixture");
  const report = await evaluatePolicy(target, parsed.options["--fixture"], { write: !parsed.flags.has("--no-write") });
  if (parsed.flags.has("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Policy evaluation: ${report.status}`);
    console.log(`Scenarios: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.incomplete} incomplete`);
    console.log(`Profile: ${report.profile}; catalog: ${report.catalog.catalog_version}`);
    console.log("Lifecycle gate changed: no");
    console.log("External action: not performed");
  }
  return report.status === "passed" ? 0 : report.status === "incomplete" ? 2 : 1;
}

async function runUsage(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "collect") {
    const mode = parsed.options["--observation-mode"] ?? "on-demand";
    if (!["on-demand", "managed-local"].includes(mode)) {
      throw new Error("usage collect --observation-mode must be on-demand or managed-local");
    }
    const collector = await startUsageCollector(target, {
      stateDirectory: parsed.options["--state-dir"],
      codexCommand: parsed.options["--codex-command"],
      observationMode: mode
    });
    const shutdown = createShutdownSignalLatch();
    try {
      console.log(`Usage Collector: ${collector.mode}`);
      console.log(`Provider: ${collector.provider_id}`);
      console.log(`Retained state: ${collector.state_directory}`);
      console.log("HTTP listener: not started");
      console.log("Press Ctrl-C to stop.");
      await shutdown.wait;
    } finally {
      await collector.close();
      shutdown.dispose();
    }
    return 0;
  }
  if (parsed.action === "evaluate") {
    if (!parsed.options["--fixture"]) throw new Error("usage evaluate requires --fixture");
    const report = await evaluateMatchedModelFixture(target, parsed.options["--fixture"]);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Matched evaluation: ${report.status}`);
      console.log(`Evaluation: ${report.evaluation_id ?? "unknown"}; task shape: ${report.task_shape ?? "unknown"}`);
      console.log(`Recommendation: ${report.recommended_profile_id ?? "none"}; confidence: ${report.confidence}`);
      console.log(`Reason: ${report.reason}`);
      console.log("Automatic model routing: disabled");
      console.log("Provider call: not performed");
      console.log("Canonical state changed: no");
    }
    return ["available", "qualified-shadow"].includes(report.status) ? 0 : report.status === "invalid" ? 1 : 2;
  }
  if (parsed.action === "preflight") {
    const report = await buildUsagePreflight(target, {
      stateDirectory: parsed.options["--state-dir"],
      probeCodexAccount: parsed.flags.has("--probe-codex-account"),
      version: TEMPLATE_VERSION
    });
    if (parsed.flags.has("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Detailed usage: ${report.detailed_thread_usage.status}`);
      console.log(`Live / terminal registered tasks: ${report.task_topology.live_resumable} / ${report.task_topology.terminal}`);
      console.log(`Detailed observations: ${report.detailed_thread_usage.observations}; baseline: ${report.baseline_qualification.status}`);
      console.log(`Account probe: ${report.account_usage.availability} (${report.account_usage.scope}, ${report.account_usage.allocation})`);
      console.log(`Matched advisory: ${report.routing.matched_advisory.status}`);
      console.log(`Next: ${report.recommended_next_action}`);
      console.log("Automatic model routing: disabled");
      console.log("Canonical state changed: no");
    }
    return 0;
  }
  if (parsed.action !== "report") throw new Error(`Unknown usage action: ${parsed.action}`);
  const report = await buildUsageBaseline(target, {
    stateDirectory: parsed.options["--state-dir"],
    write: !parsed.flags.has("--no-write")
  });
  if (parsed.flags.has("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    const coverage = report.source.longitudinal_coverage;
    console.log(`Usage baseline: ${report.baseline_status}`);
    console.log(`Observations: ${report.source.observations}; total tokens: ${report.totals.total_tokens ?? "unknown"}`);
    console.log(`Completed Work Items with registered tasks: ${coverage.registered_task_coverage.completed_work_items_with_registered_task}/${coverage.canonical_work_items.completed}`);
    console.log(`Live / historical-only tasks: ${coverage.task_eligibility.live_resumable} / ${coverage.task_eligibility.historical_only}`);
    console.log(`Correlated Work Items: ${coverage.detailed_token_observation_coverage.correlated_work_items}/${coverage.qualification.required_correlated_work_items}; remaining: ${coverage.qualification.remaining_correlated_work_items}`);
    console.log(`Driver groups: ${report.driver_groups.length}; monetary cost: ${report.totals.cost_status}`);
    console.log(`Matched advisory: ${report.routing.matched_advisory.status}`);
    console.log("Automatic model routing: disabled");
    console.log("Lifecycle gate changed: no");
  }
  return 0;
}

async function runExecution(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "onboarding-plan") {
    if (!parsed.options["--input"]) throw new Error("execution onboarding-plan requires --input");
    const plan = await buildModelOnboardingPlanFile(target, parsed.options["--input"]);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(`Model onboarding plan: ${plan.summary.proposed} proposed, ${plan.summary.already_adopted} already adopted, ${plan.summary.unresolved} unresolved`);
      for (const profile of plan.profiles) {
        const candidate = profile.recommendation?.candidate;
        const mapping = candidate
          ? `${candidate.provider_id}/${candidate.model}/${candidate.reasoning_effort}`
          : profile.status;
        console.log(`${profile.profile_id}: ${mapping}${profile.recommendation ? ` (${profile.recommendation.basis})` : ""}`);
        for (const reason of profile.unresolved_reasons) console.log(`  Reason: ${reason}`);
      }
      console.log("Provider contact: not performed");
      console.log("Policy mutation: not performed");
      console.log("Model execution: not performed");
      console.log("Automatic adoption: disabled");
    }
    return plan.summary.unresolved > 0 ? 2 : 0;
  }
  if (parsed.action !== "resolve") throw new Error(`Unknown execution action: ${parsed.action}`);
  if (!parsed.options["--request"]) throw new Error("execution resolve requires --request");
  const route = await resolveExecutionRequestFile(target, parsed.options["--request"]);
  if (parsed.flags.has("--json")) console.log(JSON.stringify(route, null, 2));
  else {
    console.log(`Execution route: ${route.summary.resolved}/${route.summary.steps} steps resolved`);
    for (const step of route.steps) {
      console.log(`${step.step_id}: ${step.selected?.profile_id ?? "unresolved"} (${step.selection.mode}, ${step.selection.rule_id ?? "no matching rule"})`);
      if (step.selection.unresolved_reason) console.log(`  Reason: ${step.selection.unresolved_reason}`);
    }
    console.log("Automatic execution: disabled");
    console.log("Provider contact: not performed");
    console.log("Canonical state changed: no");
  }
  return route.summary.unresolved > 0 ? 2 : 0;
}

async function runAdapter(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (["headroom-view", "headroom-payload", "headroom-read"].includes(parsed.action)) {
    if (!parsed.options["--input"]) throw new Error(`${parsed.action} requires --input`);
    const input = path.resolve(target, parsed.options["--input"]);
    const result = parsed.action === "headroom-read"
      ? await readHeadroomOriginal({ input, sha256: parsed.options["--expected-sha256"] })
      : await (parsed.action === "headroom-payload" ? createHeadroomPayload : createHeadroomView)({ input, kind: parsed.options["--kind"],
        enabled: parsed.flags.has("--enable-headroom"), allowLossy: parsed.flags.has("--allow-lossy-headroom"), python: parsed.options["--python"],
        snapshot: parsed.options["--snapshot"], query: parsed.options["--query"] ?? "" });
    if (parsed.action === "headroom-payload" && !parsed.flags.has("--json")) process.stdout.write(result.text);
    else console.log(formatJson(result));
    return 0;
  }
  if (parsed.action === "archify-status") {
    const status = await inspectArchifyAdapter(target);
    printResult(parsed, status, [
      `Archify adapter: ${status.status}`,
      `Usable: ${status.usable ? "yes" : "no"}`,
      `Reason: ${status.reason}`,
      "External action: not performed"
    ]);
    return status.status === "invalid" ? 1 : 0;
  }
  if (parsed.action === "archify-install") {
    if (!parsed.options["--source"]) throw new Error("adapter archify-install requires --source");
    const manifest = await withProjectMutationLock(target, () => installArchifyAdapter(target, parsed.options["--source"]));
    printResult(parsed, manifest, [
      `Installed Archify ${manifest.provenance.tag} at ${manifest.provenance.commit}`,
      `Files: ${manifest.files.length}`,
      `Isolation root: ${manifest.isolation_root}`,
      "External action: not performed"
    ]);
    return 0;
  }
  throw new Error(`Unknown adapter action: ${parsed.action}`);
}

async function runWorkItemCreate(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const created = await createWorkItem(target, {
      proposal: parsed.action === "propose", proposalPosition: parsed.options["--position"],
      agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"],
      title: parsed.options["--title"],
      actor: parsed.options["--actor"],
      scope: listOption(parsed, "--scope"),
      acceptance: listOption(parsed, "--acceptance"),
      affectedPaths: listOption(parsed, "--affected-path"),
      contextRefs: listOption(parsed, "--context-ref"),
      specRefs: parseDocumentReferences(listOption(parsed, "--spec-ref"), "--spec-ref"),
      uxRefs: parseDocumentReferences(listOption(parsed, "--ux-ref"), "--ux-ref"),
      uiRefs: parseDocumentReferences(listOption(parsed, "--ui-ref"), "--ui-ref"),
      contractRefs: parseDocumentReferences(listOption(parsed, "--contract-ref"), "--contract-ref"),
      specificationMode: parsed.options["--spec-mode"],
      uiDeliveryMode: parsed.options["--ui-mode"],
      workflowProfile: parsed.options["--workflow-profile"],
      riskTier: parsed.options["--risk-tier"],
      scopeClass: parsed.options["--scope-class"],
      escalationTriggers: listOption(parsed, "--escalation-trigger"),
      profileRationale: parsed.options["--profile-rationale"],
      profileEvidence: listOption(parsed, "--profile-evidence"),
      parentWorkItemId: parsed.options["--parent"],
      dependencies: listOption(parsed, "--depends-on"),
      requiredDisciplines: listOption(parsed, "--discipline"),
      stageRequirements: parseStageRequirements(
        listOption(parsed, "--stage-discipline"),
        listOption(parsed, "--stage-resource"),
        listOption(parsed, "--clear-stage-requirement")
      ),
      baseRevision: parsed.options["--base-revision"],
      integrationOwnerAgentId: parsed.options["--integration-owner"],
      sharedContractRefs: listOption(parsed, "--shared-contract-ref"),
      contractStatus: parsed.options["--contract-status"],
      overlapResolution: listOption(parsed, "--overlap-resolution"),
      evidence: listOption(parsed, "--evidence"),
      unresolved: listOption(parsed, "--unresolved"),
      trackerVisibility: parsed.options["--tracker-visibility"]
    });
    await refreshViews(target);
    return created;
  });
  printResult(parsed, result, [
    `${parsed.action === "propose" ? "Proposed" : "Created"} ${result.item.id}: ${result.item.title}`,
    `State: ${result.item.state} (${result.item.owner_position})`,
    `Suggested Codex title: ${result.suggested_title}`
  ]);
  return 0;
}

async function runCollaboration(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "show") {
    const document = normalizedCollaborationState(await readCollaborationState(target));
    printResult(parsed, document, [
      `Profile: ${document.profile}`,
      `Human Principals: ${(document.principals ?? []).filter((entry) => entry.status === "active").length} active`,
      `Sponsorships: ${(document.sponsorships ?? []).length}`,
      `Position memberships: ${(document.memberships ?? []).filter((entry) => entry.status === "active").length} active`,
      `Authority grants: ${(document.authority_grants ?? []).filter((entry) => entry.status === "active").length} active`,
      `Real Collaborative validation: ${document.validation?.real_collaborative?.status ?? "not_run"}`
    ]);
    return 0;
  }
  if (parsed.action === "show-identity") {
    const result = await readLocalActorBinding(target);
    printResult(parsed, result, [
      `Local actor binding: ${result.status}`,
      `Principal: ${result.binding?.principal_id ?? "not bound"}`,
      `Verification: ${result.binding?.verification_class ?? "not available"}`,
      `Stored outside tracked project files: ${result.path}`
    ]);
    return 0;
  }
  if (parsed.action === "bind-identity") {
    const result = await writeLocalActorBinding(target, {
      principalId: parsed.options["--principal-id"],
      verificationClass: parsed.options["--verification-class"],
      providerId: parsed.options["--provider-id"],
      providerSubject: parsed.options["--provider-subject"],
      providerHandle: parsed.options["--provider-handle"],
      evidenceRef: parsed.options["--evidence-ref"],
      expiresAt: parsed.options["--expires-at"]
    });
    printResult(parsed, result, [
      `Bound this Git clone to ${result.binding.principal_id}`,
      `Verification: ${result.binding.verification_class}`,
      `Credentials stored: no`
    ]);
    return 0;
  }
  if (parsed.action === "clear-identity") {
    const result = await clearLocalActorBinding(target);
    printResult(parsed, result, [result.removed ? "Removed the local actor binding" : "No local actor binding existed"]);
    return 0;
  }
  const result = await withProjectMutationLock(target, async () => {
    let changed;
    if (parsed.action === "migrate") {
      changed = await migrateCollaborationState(target, {
        dryRun: parsed.flags.has("--dry-run"),
        actor: parsed.options["--actor"]
      });
    } else if (parsed.action === "set-profile") {
      changed = await setCollaborationProfile(target, parsed.options["--profile"]);
    } else if (parsed.action === "add-principal") {
      changed = await addPrincipal(target, {
        principalId: parsed.options["--principal-id"],
        displayName: parsed.options["--name"],
        providerId: parsed.options["--provider-id"],
        providerSubject: parsed.options["--provider-subject"],
        providerHandle: parsed.options["--provider-handle"],
        evidenceRef: parsed.options["--evidence-ref"]
      });
    } else if (parsed.action === "set-principal-status") {
      changed = await setPrincipalStatus(target, {
        principalId: parsed.options["--principal-id"],
        status: parsed.options["--status"],
        actor: parsed.options["--actor"]
      });
    } else if (parsed.action === "add-agent") {
      changed = await addAgentIdentity(target, {
        agentId: parsed.options["--agent-id"],
        displayName: parsed.options["--name"]
      });
    } else if (parsed.action === "sponsor") {
      changed = await sponsorAgent(target, {
        principalId: parsed.options["--principal-id"],
        agentId: parsed.options["--agent-id"]
      });
    } else if (parsed.action === "add-membership") {
      changed = await addMembership(target, {
        agentId: parsed.options["--agent-id"],
        positionId: parsed.options["--position"],
        disciplines: listOption(parsed, "--discipline")
      });
    } else if (parsed.action === "qualify-membership") {
      changed = await setMembershipQualification(target, {
        agentId: parsed.options["--agent-id"],
        positionId: parsed.options["--position"],
        status: parsed.options["--status"],
        evidenceRefs: listOption(parsed, "--evidence"),
        riskCeiling: parsed.options["--risk-tier"],
        reviewAfter: parsed.options["--review-after"],
        expiresAt: parsed.options["--expires-at"],
        actor: parsed.options["--actor"]
      });
    } else if (parsed.action === "grant-authority") {
      changed = await grantHumanAuthority(target, {
        grantId: parsed.options["--grant-id"],
        principalId: parsed.options["--principal-id"],
        authority: parsed.options["--authority"],
        scope: parsed.options["--scope"],
        riskCeiling: parsed.options["--risk-tier"],
        approvedBy: listOption(parsed, "--approved-by"),
        expiresAt: parsed.options["--expires-at"],
        actor: parsed.options["--actor"]
      });
    } else if (parsed.action === "revoke-authority") {
      changed = await revokeHumanAuthority(target, {
        grantId: parsed.options["--grant-id"],
        approvedBy: listOption(parsed, "--approved-by"),
        actor: parsed.options["--actor"]
      });
    } else if (parsed.action === "configure-recovery") {
      changed = await configureGovernanceRecovery(target, {
        trusteePrincipalIds: listOption(parsed, "--trustee"),
        threshold: parsed.options["--threshold"],
        approvedBy: listOption(parsed, "--approved-by"),
        actor: parsed.options["--actor"]
      });
    } else if (parsed.action === "establish-bootstrap") {
      changed = await establishBootstrapOwner(target, {
        principalId: parsed.options["--principal-id"],
        approvedBy: listOption(parsed, "--approved-by"),
        actor: parsed.options["--actor"]
      });
    } else if (parsed.action === "retire-bootstrap") {
      changed = await retireBootstrapOwner(target, {
        approvedBy: listOption(parsed, "--approved-by"),
        actor: parsed.options["--actor"]
      });
    } else if (parsed.action === "record-validation") {
      changed = await recordCollaborationValidation(target, {
        level: parsed.options["--validation-level"],
        status: parsed.options["--status"],
        revision: parsed.options["--revision"],
        evidenceRefs: listOption(parsed, "--evidence"),
        participants: listOption(parsed, "--participant-principal"),
        environments: listOption(parsed, "--environment"),
        actor: parsed.options["--actor"]
      });
    } else {
      throw new Error(`Unknown collaboration action: ${parsed.action}`);
    }
    if (!(parsed.action === "migrate" && parsed.flags.has("--dry-run"))) await refreshViews(target);
    return changed;
  });
  printResult(parsed, result, [`Updated collaboration state: ${parsed.action}`]);
  return 0;
}

async function runTaskContract(parsed) {
  const projection = parsed.action === "contract";
  assertCommandOptions(parsed, [projection ? "--work-item" : "--source"], ["--no-write", "--json"]);
  if (!parsed.flags.has("--no-write") || !parsed.flags.has("--json")) throw new OperationError("INVALID_INPUT", "Task contract inspection requires --no-write and --json");
  const target = await assertSafeTarget(parsed.target);
  const { inspectLegacyTaskContract, readTaskContractInput, validateTaskContract } = await import("./task-contract.mjs");
  const result = projection ? await inspectLegacyTaskContract(target, parsed.options["--work-item"]) :
    validateTaskContract((await readTaskContractInput(target, parsed.options["--source"])).document);
  console.log(JSON.stringify(result, null, 2));
  return (projection ? result.valid : result.contract_complete) ? 0 : 1;
}

async function runWorkItemConfigure(parsed) {
  // Global recognition is not command support. Reject before locking or refreshing views.
  const allowedOptions = new Set([
    "--work-item", "--actor", "--parent", "--depends-on", "--discipline",
    "--stage-discipline", "--stage-resource", "--clear-stage-requirement",
    "--base-revision", "--parallel-mode", "--integration-owner", "--agent-id",
    "--shared-contract-ref", "--contract-status", "--overlap-resolution",
    "--spec-ref", "--ux-ref", "--ui-ref", "--contract-ref", "--spec-mode", "--ui-mode",
    "--workflow-profile", "--risk-tier", "--scope-class", "--escalation-trigger",
    "--profile-rationale", "--profile-evidence"
  ]);
  const allowedFlags = new Set([
    "--clear-disciplines", "--replace-spec-refs", "--replace-ux-refs",
    "--replace-ui-refs", "--replace-contract-refs", "--json"
  ]);
  for (const flag of [...Object.keys(parsed.options), ...parsed.flags]) {
    if (!allowedOptions.has(flag) && !allowedFlags.has(flag)) {
      throw new OperationError("INVALID_INPUT", `Unsupported work-item configure option: ${flag}. See temple work-item configure --help.`);
    }
  }
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const configured = await configureWorkItem(target, {
      workItemId: parsed.options["--work-item"],
      actor: parsed.options["--actor"],
      parentWorkItemId: parsed.options["--parent"],
      dependencies: parsed.options["--depends-on"] === undefined ? undefined : listOption(parsed, "--depends-on"),
      requiredDisciplines: parsed.flags.has("--clear-disciplines")
        ? []
        : parsed.options["--discipline"] === undefined
          ? undefined
          : listOption(parsed, "--discipline"),
      stageRequirements: parseStageRequirements(
        listOption(parsed, "--stage-discipline"),
        listOption(parsed, "--stage-resource"),
        listOption(parsed, "--clear-stage-requirement")
      ),
      baseRevision: parsed.options["--base-revision"],
      parallelMode: parsed.options["--parallel-mode"],
      integrationOwnerAgentId: parsed.options["--integration-owner"],
      agentId: parsed.options["--agent-id"],
      sharedContractRefs:
        parsed.options["--shared-contract-ref"] === undefined ? undefined : listOption(parsed, "--shared-contract-ref"),
      contractStatus: parsed.options["--contract-status"],
      overlapResolution:
        parsed.options["--overlap-resolution"] === undefined ? undefined : listOption(parsed, "--overlap-resolution"),
      specRefs:
        parsed.options["--spec-ref"] === undefined
          ? undefined
          : parseDocumentReferences(listOption(parsed, "--spec-ref"), "--spec-ref"),
      replaceSpecRefs: parsed.flags.has("--replace-spec-refs"),
      uxRefs:
        parsed.options["--ux-ref"] === undefined
          ? undefined
          : parseDocumentReferences(listOption(parsed, "--ux-ref"), "--ux-ref"),
      replaceUxRefs: parsed.flags.has("--replace-ux-refs"),
      uiRefs:
        parsed.options["--ui-ref"] === undefined
          ? undefined
          : parseDocumentReferences(listOption(parsed, "--ui-ref"), "--ui-ref"),
      replaceUiRefs: parsed.flags.has("--replace-ui-refs"),
      contractRefs:
        parsed.options["--contract-ref"] === undefined
          ? undefined
          : parseDocumentReferences(listOption(parsed, "--contract-ref"), "--contract-ref"),
      replaceContractRefs: parsed.flags.has("--replace-contract-refs"),
      specificationMode: parsed.options["--spec-mode"],
      uiDeliveryMode: parsed.options["--ui-mode"],
      workflowProfile: parsed.options["--workflow-profile"],
      riskTier: parsed.options["--risk-tier"],
      scopeClass: parsed.options["--scope-class"],
      escalationTriggers:
        parsed.options["--escalation-trigger"] === undefined ? undefined : listOption(parsed, "--escalation-trigger"),
      profileRationale: parsed.options["--profile-rationale"],
      profileEvidence:
        parsed.options["--profile-evidence"] === undefined ? undefined : listOption(parsed, "--profile-evidence")
    });
    await refreshViews(target);
    return configured;
  });
  printResult(parsed, result, [
    `Configured ${result.item.id}: ${result.item.parallel_mode}`,
    `Parallel ready: ${result.readiness.ready ? "yes" : "no"}`,
    `Recommendation: ${result.readiness.recommended_mode}`
  ]);
  return 0;
}

async function runWorkItemClaim(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const claimed = await claimWorkItem(target, {
      workItemId: parsed.options["--work-item"],
      agentId: parsed.options["--agent-id"],
      principalId: parsed.options["--principal-id"],
      baseRevision: parsed.options["--base-revision"],
      branch: parsed.options["--branch"],
      worktree: parsed.options["--worktree"]
    });
    await refreshViews(target);
    return claimed;
  });
  printResult(parsed, result, [
    `Claimed ${result.item.id}: ${result.item.claim.id}`,
    `Agent: ${result.item.claim.agent_id}`,
    `Principal: ${result.item.claim.principal_id}`,
    `Base revision: ${result.item.claim.base_revision}`
  ]);
  return 0;
}

async function runWorkItemRelease(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const item = await withProjectMutationLock(target, async () => {
    const released = await releaseWorkItemClaim(target, {
      workItemId: parsed.options["--work-item"],
      agentId: parsed.options["--agent-id"],
      principalId: parsed.options["--principal-id"],
      reason: parsed.options["--reason"]
    });
    await refreshViews(target);
    return released;
  });
  printResult(parsed, item, [`Released ${item.id}: ${item.claim.id}`, `Reason: ${item.claim.release_reason}`]);
  return 0;
}

async function runWorkItemRework(parsed) {
  const allowedOptions = new Set(["--work-item", "--input-revision", "--reason", "--evidence", "--actor"]);
  const allowedFlags = new Set(["--same-scope", "--json"]);
  for (const flag of [...Object.keys(parsed.options), ...parsed.flags]) {
    if (!allowedOptions.has(flag) && !allowedFlags.has(flag)) throw new Error(`Unsupported rework option: ${flag}`);
  }
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const reworked = await reworkWorkItem(target, {
      workItemId: parsed.options["--work-item"], sameScope: parsed.flags.has("--same-scope"),
      inputRevision: parsed.options["--input-revision"], actor: parsed.options["--actor"],
      reason: listOption(parsed, "--reason"), evidence: listOption(parsed, "--evidence")
    });
    await refreshViews(target);
    return reworked;
  });
  printResult(parsed, result, [`${result.item.id}: returned to Build (rework ${result.entry.sequence})`, `Rejected candidate: ${result.entry.rejected_revision}`, "Reviewer claim released. Claim as Developer, record a corrected commit and rerun the remaining gates."]);
  return 0;
}

function assertCommandOptions(parsed, options, flags) {
  const allowed = new Set([...options, ...flags]);
  for (const name of [...Object.keys(parsed.options), ...parsed.flags]) {
    if (!allowed.has(name)) throw new OperationError("INVALID_INPUT", `Unsupported ${parsed.command} ${parsed.action} option: ${name}`);
  }
}

async function runWorkItemDeliver(parsed) {
  assertCommandOptions(parsed,
    ["--work-item", "--operation-id", "--claim-id", "--agent-id", "--principal-id", "--revision", "--completed", "--evidence", "--unresolved", "--expected-plan"],
    ["--dry-run", "--json"]);
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const delivered = await deliverLeanWorkItem(target, {
      workItemId: parsed.options["--work-item"], operationId: parsed.options["--operation-id"],
      claimId: parsed.options["--claim-id"], agentId: parsed.options["--agent-id"],
      principalId: parsed.options["--principal-id"], revision: parsed.options["--revision"],
      completed: listOption(parsed, "--completed"), evidence: listOption(parsed, "--evidence"),
      unresolved: listOption(parsed, "--unresolved"), dryRun: parsed.flags.has("--dry-run"),
      expectedPlan: parsed.options["--expected-plan"]
    });
    if (!delivered.dry_run && delivered.status !== "already_applied") await refreshViews(target);
    return delivered;
  }, { leanDeliveryOperation: `${parsed.options["--work-item"]}/${parsed.options["--operation-id"]}` });
  printResult(parsed, result, [`Lean delivery: ${result.status}`, `Work Item: ${result.work_item_id}`, `Handoff: ${result.handoff}`, result.next_action]);
  return 0;
}

async function runWorkItemFinish(parsed) {
  assertCommandOptions(parsed,
    ["--work-item", "--position", "--operation-id", "--claim-id", "--agent-id", "--principal-id", "--revision", "--completed", "--evidence", "--unresolved", "--expected-plan", "--judgment", "--test-evidence", "--lean-closeout", "--mechanical-contract"],
    ["--dry-run", "--json"]);
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, () => finishLeanWorkItem(target, {
    workItemId: parsed.options["--work-item"], position: parsed.options["--position"],
    mechanicalContract: parsed.options["--mechanical-contract"],
    operationId: parsed.options["--operation-id"], claimId: parsed.options["--claim-id"], agentId: parsed.options["--agent-id"],
    principalId: parsed.options["--principal-id"], revision: parsed.options["--revision"],
    completed: listOption(parsed, "--completed"), evidence: listOption(parsed, "--evidence"), unresolved: listOption(parsed, "--unresolved"),
    judgment: parsed.options["--judgment"], testEvidence: listOption(parsed, "--test-evidence"), leanCloseout: listOption(parsed, "--lean-closeout"),
    dryRun: parsed.flags.has("--dry-run"), expectedPlan: parsed.options["--expected-plan"]
  }), { leanDeliveryOperation: `${parsed.options["--work-item"]}/${parsed.options["--operation-id"]}` });
  printResult(parsed, result, [`Lean finish: ${result.status}`, `Lifecycle: ${result.mutation.status}`, `Diagnostics: ${result.diagnostics.status}`, result.next_action]);
  return result.success || result.mutation.dry_run ? 0 : 1;
}

async function runWorkItemFinishRecovery(parsed) {
  assertCommandOptions(parsed, ["--work-item", "--operation-id", "--agent-id", "--principal-id", "--approval-ref", "--expected-plan"], ["--dry-run", "--json"]);
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, () => recoverLeanFinish(target, {
    workItemId: parsed.options["--work-item"], operationId: parsed.options["--operation-id"],
    agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"],
    approvalRef: parsed.options["--approval-ref"], expectedPlan: parsed.options["--expected-plan"], dryRun: parsed.flags.has("--dry-run")
  }));
  printResult(parsed, result, [result.status ?? "Recovery preview", result.next_action]);
  return 0;
}

async function runDailyDelivery(parsed) {
  const readOnly = ["next", "report"].includes(parsed.action);
  assertCommandOptions(parsed, readOnly ? ["--work-item"] : ["--work-item", "--agent-id", "--principal-id", "--request"], ["--json"]);
  const api = await import("./daily-delivery.mjs");
  const methods = { open: api.openDelivery, check: api.checkDelivery, finish: api.finishDelivery, rework: api.reworkDelivery, observe: api.observeDelivery, pause: api.pauseDelivery, resume: api.resumeDelivery, next: api.inspectDelivery, report: api.inspectDelivery };
  if (!methods[parsed.action]) throw new OperationError("INVALID_INPUT", "Unknown delivery action");
  const humanReport = parsed.action === "report" && !parsed.flags.has("--json");
  const target = await assertSafeTarget(parsed.target), options = { workItemId: parsed.options["--work-item"], agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"], requestRef: parsed.options["--request"], report: parsed.action === "report", humanReadable: humanReport };
  let key = null;
  if (parsed.action === "finish") {
    const { readSource } = await import("./delivery-ledger.mjs");
    const request = JSON.parse((await readSource(target, options.requestRef)).body);
    key = `${options.workItemId}/${request.operation_id}`;
  }
  const result = readOnly ? await methods[parsed.action](target, options) : await withProjectMutationLock(target, () => methods[parsed.action](target, options), { leanDeliveryOperation: key });
  printResult(parsed, result, humanReport ? result : [JSON.stringify(result, null, 2)]);
  return result.check && !result.check.accepted || result.finish && !result.finish.success ? 1 : 0;
}

async function runWorkItemMigrateOutcomes(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const migrated = await migrateLegacyOutcome(target, {
      workItemId: parsed.options["--work-item"],
      outcome: parsed.options["--outcome"],
      reason: listOption(parsed, "--reason"),
      dryRun: parsed.flags.has("--dry-run"),
      actor: parsed.options["--actor"]
    });
    if (!migrated.dry_run) await refreshViews(target);
    return migrated;
  });
  printResult(parsed, result, [
    `Legacy no-go candidates: ${result.candidates.length}`,
    `Changed: ${result.changed}`,
    `Dry run: ${result.dry_run ? "yes" : "no"}`
  ]);
  return 0;
}

async function runParallel(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "prepare") {
    const prepared = await withProjectMutationLock(target, async () => {
      const result = await prepareWorkerDispatch(target, {
        workItemId: parsed.options["--work-item"],
        agentId: parsed.options["--agent-id"],
        principalId: parsed.options["--principal-id"],
        baseRevision: parsed.options["--base-revision"],
        branch: parsed.options["--branch"],
        worktree: parsed.options["--worktree"],
        runtimeKind: parsed.options["--runtime-kind"]
      });
      await refreshViews(target);
      return result;
    });
    printResult(parsed, prepared, [
      `Prepared ${prepared.worker.id} for ${prepared.worker.work_item_id}`,
      `Runtime kind: ${prepared.worker.runtime_kind}`,
      `Claim: ${prepared.claim.id}`,
      prepared.instruction
    ]);
    return 0;
  }
  if (parsed.action === "plan") {
    const plan = await buildParallelPlan(target, {
      parentWorkItemId: parsed.options["--parent"],
      maxWorkers: optionalPositiveIntegerOption(parsed, "--max-workers")
    });
    let outputPath = null;
    if (!parsed.flags.has("--no-write")) {
      outputPath = await writeParallelPlan(target, plan);
      await refreshViews(target);
    }
    if (parsed.flags.has("--json")) console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(
        `Parallel plan: ${plan.summary.waves} wave(s), ${plan.summary.dispatchable} dispatchable, ${plan.summary.active} active, ${plan.summary.sequential} sequential, ${plan.summary.blocked} blocked`
      );
      for (const wave of plan.waves) {
        console.log(`[${wave.id}] ${wave.dispatch.map((entry) => entry.work_item_id).join(", ")}`);
      }
      for (const entry of plan.sequential) console.log(`[SEQUENTIAL] ${entry.work_item_id}: ${entry.reasons.join(", ")}`);
      for (const entry of plan.blocked) console.log(`[BLOCKED] ${entry.work_item_id}: ${entry.reasons.join(", ")}`);
      console.log("No Codex task, claim, or external action was performed.");
      if (outputPath) console.log(`Parallel plan: ${path.relative(target, outputPath).split(path.sep).join("/")}`);
    }
    return 0;
  }
  if (parsed.action !== "check") throw new Error(`Unknown parallel action: ${parsed.action}`);
  const result = await evaluateParallelReadiness(target, parsed.options["--work-item"], {
    agentId: parsed.options["--agent-id"]
  });
  if (parsed.flags.has("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.work_item_id}: ${result.ready ? "parallel-ready" : result.recommended_mode}`);
    for (const check of result.checks) console.log(`[${check.pass ? "PASS" : "FAIL"}] ${check.id}`);
    for (const overlap of result.overlaps) console.log(`[OVERLAP] ${overlap.work_item_id}: ${overlap.paths.join(", ")}`);
  }
  return result.ready ? 0 : 2;
}

async function runWorker(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "list") {
    const workers = await listRuntimeWorkers(target);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(workers, null, 2));
    else if (workers.length === 0) console.log("No runtime workers registered.");
    else for (const worker of workers) console.log(`${worker.id}\t${worker.runtime_kind}\t${worker.status}\t${worker.work_item_id}`);
    return 0;
  }
  const worker = await withProjectMutationLock(target, async () => {
    let result;
    if (parsed.action === "attach") {
      result = await attachInternalWorker(target, {
        workerId: parsed.options["--worker-id"],
        runtimeId: parsed.options["--runtime-id"]
      });
    } else if (parsed.action === "update") {
      result = await updateRuntimeWorker(target, {
        workerId: parsed.options["--worker-id"],
        status: parsed.options["--status"],
        revision: parsed.options["--revision"],
        evidence: listOption(parsed, "--evidence"),
        actor: parsed.options["--actor"]
      });
    } else throw new Error(`Unknown worker action: ${parsed.action}`);
    await refreshViews(target);
    return result;
  });
  printResult(parsed, worker, [`${worker.id}: ${worker.status}`, `Work Item: ${worker.work_item_id}`]);
  return 0;
}

async function runResource(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "list") {
    const registry = await readResourceRegistry(target);
    printResult(parsed, registry, [
      `Shared resources: ${(registry.resources ?? []).length}`,
      `Active reservations: ${(registry.reservations ?? []).filter((entry) => entry.status === "active").length}`
    ]);
    return 0;
  }
  if (parsed.action !== "define") throw new Error(`Unknown resource action: ${parsed.action}`);
  const result = await withProjectMutationLock(target, async () => {
    const capacity = Number(parsed.options["--capacity"]);
    const defined = await defineResource(target, {
      resourceId: parsed.options["--resource-id"],
      displayName: parsed.options["--name"],
      capacity,
      description: parsed.options["--description"],
      actor: parsed.options["--actor"]
    });
    await refreshViews(target);
    return defined;
  });
  printResult(parsed, result, [`Defined shared resource ${result.id}: capacity ${result.capacity}`]);
  return 0;
}

async function runWorkItemUnresolved(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const resolutions = listOption(parsed, "--resolve");
  const additions = listOption(parsed, "--merge");
  if (resolutions.length === 0 && additions.length === 0) {
    const result = await listUnresolvedItems(target, parsed.options["--work-item"]);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(result, null, 2));
    else if (result.unresolved.length === 0) console.log(`No unresolved items for ${result.work_item_id}.`);
    else {
      console.log(`${result.work_item_id} unresolved items:`);
      result.unresolved.forEach((entry, index) => console.log(`${index + 1}. ${entry}`));
    }
    return 0;
  }

  const result = await withProjectMutationLock(target, async () => {
    const updated = await updateUnresolvedItems(target, {
      conditionKind: parsed.options["--condition-kind"],
      agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"],
      workItemId: parsed.options["--work-item"],
      actor: parsed.options["--actor"],
      resolve: resolutions,
      merge: additions
    });
    if (updated.changed) await refreshViews(target);
    return updated;
  });
  printResult(parsed, result, [
    `${result.item.id} unresolved items: ${result.item.unresolved.length}`,
    `Resolved: ${result.resolved.length ? result.resolved.join(" | ") : "none"}`,
    `Merged: ${result.merged.length ? result.merged.join(" | ") : "none"}`,
    `Changed: ${result.changed ? "yes" : "no"}`
  ]);
  return 0;
}

async function runHandoff(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const handoff = await createHandoff(target, {
      agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"],
      workItemId: parsed.options["--work-item"],
      toPosition: parsed.options["--to"],
      inputRevision: parsed.options["--input-revision"],
      actor: parsed.options["--actor"],
      completed: listOption(parsed, "--completed"),
      evidence: listOption(parsed, "--evidence"),
      unresolved: listOption(parsed, "--unresolved")
    });
    await refreshViews(target);
    return handoff;
  });
  printResult(parsed, result, [
    `Created handoff: ${result.artifact}`,
    `Next Position: ${result.item.next_position}`,
    `Suggested Codex title: ${result.suggested_title}`
  ]);
  return 0;
}

async function runTransition(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const transitioned = await transitionWorkItem(target, {
      agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"],
      workItemId: parsed.options["--work-item"],
      toState: parsed.options["--to"],
      actor: parsed.options["--actor"],
      satisfied: parseSatisfied(listOption(parsed, "--satisfy")),
      evidence: listOption(parsed, "--evidence")
    });
    await refreshViews(target);
    return transitioned;
  });
  printResult(parsed, result, [
    `${result.item.id}: ${result.item.state}`,
    `Owner: ${result.item.owner_position} (${result.item.assigned_agent_id})`,
    `Suggested Codex title: ${result.suggested_title}`
  ]);
  return 0;
}

async function runClose(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const result = await withProjectMutationLock(target, async () => {
    const closed = await closeWorkItem(target, {
      agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"],
      workItemId: parsed.options["--work-item"],
      decision: parsed.options["--decision"],
      outcome: parsed.options["--outcome"],
      testedRevision: parsed.options["--tested-revision"],
      approval: parsed.options["--approval"],
      actor: parsed.options["--actor"],
      rollback: listOption(parsed, "--rollback"),
      reason: listOption(parsed, "--reason"),
      evidence: listOption(parsed, "--evidence"),
      satisfied: parseSatisfied(listOption(parsed, "--satisfy"))
    });
    await refreshViews(target);
    return closed;
  });
  printResult(parsed, result, [
    `${result.item.id}: ${result.item.state}`,
    `Release gate: ${result.item.release_gate_result}`,
    `Record: ${result.artifact}`,
    "External release: not performed"
  ]);
  return 0;
}

async function runTask(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "register") {
    const task = await withProjectMutationLock(target, async () => {
      const registered = await registerTask(target, {
        workItemId: parsed.options["--work-item"],
        positionId: parsed.options["--position"],
        threadId: parsed.options["--thread-id"],
        clientThreadId: parsed.options["--client-thread-id"],
        hostId: parsed.options["--host-id"],
        executionOrigin: parsed.options["--execution-origin"],
        providerId: parsed.options["--provider-id"],
        requestedModel: parsed.options["--requested-model"],
        effectiveModel: parsed.options["--effective-model"],
        reasoningEffort: parsed.options["--reasoning-effort"],
        requestedReasoningEffort: parsed.options["--requested-reasoning-effort"],
        observedThreadReasoningEffort: parsed.options["--observed-thread-reasoning-effort"],
        effectiveTurnReasoningEffort: parsed.options["--effective-turn-reasoning-effort"],
        reasoningEffortSource: parsed.options["--reasoning-effort-source"],
        serviceTier: parsed.options["--service-tier"],
        launchRevision: parsed.options["--launch-revision"],
        status: parsed.options["--status"],
        revision: parsed.options["--revision"],
        notes: parsed.options["--notes"],
        workerId: parsed.options["--worker-id"],
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return registered;
    });
    printResult(parsed, task, [
      `Registered ${task.id} for ${task.work_item_id}`,
      `Suggested Codex title: ${task.suggested_title}`,
      `Status: ${task.status}`
    ]);
    return 0;
  }
  if (parsed.action === "update") {
    const task = await withProjectMutationLock(target, async () => {
      const updated = await updateTask(target, {
        taskId: parsed.options["--task-id"],
        status: parsed.options["--status"],
        revision: parsed.options["--revision"],
        effectiveModel: parsed.options["--effective-model"],
        reasoningEffort: parsed.options["--reasoning-effort"],
        requestedReasoningEffort: parsed.options["--requested-reasoning-effort"],
        observedThreadReasoningEffort: parsed.options["--observed-thread-reasoning-effort"],
        effectiveTurnReasoningEffort: parsed.options["--effective-turn-reasoning-effort"],
        reasoningEffortSource: parsed.options["--reasoning-effort-source"],
        serviceTier: parsed.options["--service-tier"],
        notes: parsed.options["--notes"],
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return updated;
    });
    printResult(parsed, task, [`Updated ${task.id}: ${task.status}`, `Revision: ${task.current_revision ?? "not recorded"}`]);
    return 0;
  }
  if (parsed.action === "refresh-titles") {
    const result = await withProjectMutationLock(target, async () => {
      const refreshed = await refreshTaskTitles(target, {
        taskId: parsed.options["--task-id"],
        actor: parsed.options["--actor"]
      });
      if (refreshed.updated_count > 0) await refreshViews(target);
      return refreshed;
    });
    printResult(parsed, result, [
      `Refreshed task title suggestions: ${result.updated_count}`,
      `Already current: ${result.unchanged_count}`,
      "Codex app tasks renamed: no"
    ]);
    return 0;
  }
  if (parsed.action === "list") {
    const tasks = await listTasks(target);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(tasks, null, 2));
    else if (tasks.length === 0) console.log("No Codex tasks registered.");
    else for (const task of tasks) console.log(`${task.id}\t${task.status}\t${task.suggested_title}\tarchive=${task.archive_ready}`);
    return 0;
  }
  throw new Error(`Unknown task action: ${parsed.action}`);
}

async function runTracker(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "show") {
    const config = await readTrackerConfig(target);
    printResult(parsed, config, [
      `Tracker profile: ${config.profile}`,
      `Sync granularity: ${config.sync_granularity}`,
      `Providers: ${(config.providers ?? []).map((provider) => provider.id).join(", ") || "none"}`
    ]);
    return 0;
  }
  if (parsed.action === "configure") {
    const config = await withProjectMutationLock(target, async () => {
      const updated = await configureTracker(target, {
        profile: parsed.options["--tracker-profile"],
        syncGranularity: parsed.options["--sync-granularity"],
        defaultProviderId: parsed.options["--default-provider"],
        providerId: parsed.options["--provider-id"],
        providerKind: parsed.options["--provider-kind"],
        project: parsed.options["--project"],
        baseUrl: parsed.options["--base-url"],
        providerStatus: parsed.options["--provider-status"],
        readPolicy: parsed.options["--read-policy"],
        writePolicy: parsed.options["--write-policy"],
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return updated;
    });
    printResult(parsed, config, [
      `Tracker profile: ${config.profile}`,
      `Sync granularity: ${config.sync_granularity}`,
      `Default provider: ${config.default_provider_id ?? "none"}`
    ]);
    return 0;
  }
  if (parsed.action === "remove-provider") {
    const config = await withProjectMutationLock(target, async () => {
      const updated = await removeTrackerProvider(target, {
        providerId: parsed.options["--provider-id"],
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return updated;
    });
    printResult(parsed, config, [`Removed tracker provider`, `Tracker profile: ${config.profile}`]);
    return 0;
  }
  if (parsed.action === "set-visibility") {
    const item = await withProjectMutationLock(target, async () => {
      const updated = await setTrackerVisibility(target, {
        workItemId: parsed.options["--work-item"],
        visibility: parsed.options["--visibility"],
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return updated;
    });
    printResult(parsed, item, [`${item.id} tracker visibility: ${item.tracker_visibility}`]);
    return 0;
  }
  if (parsed.action === "link") {
    const result = await withProjectMutationLock(target, async () => {
      const linked = await linkTrackerItem(target, {
        workItemId: parsed.options["--work-item"],
        providerId: parsed.options["--provider-id"],
        itemId: parsed.options["--item-id"],
        url: parsed.options["--url"],
        role: parsed.options["--role"],
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return linked;
    });
    printResult(parsed, result, [
      `Linked ${result.item.id} to ${result.reference.provider_id}:${result.reference.item_id}`,
      `External write: not performed`
    ]);
    return 0;
  }
  if (parsed.action === "unlink") {
    const item = await withProjectMutationLock(target, async () => {
      const updated = await unlinkTrackerItem(target, {
        workItemId: parsed.options["--work-item"],
        providerId: parsed.options["--provider-id"],
        itemId: parsed.options["--item-id"],
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return updated;
    });
    printResult(parsed, item, [`Unlinked tracker item from ${item.id}`, `External write: not performed`]);
    return 0;
  }
  if (["inspect", "plan"].includes(parsed.action)) {
    const result = await inspectAndPlanTrackerItem(target, {
      workItemId: parsed.options["--work-item"],
      providerId: parsed.options["--provider-id"],
      observationPath: parsed.options["--observation"],
      writeView: false
    });
    if (!parsed.flags.has("--no-write")) {
      await withProjectMutationLock(target, async () => {
        await writeTrackerView(target, result.item, result.observation, result.plan);
        await refreshViews(target);
      });
    }
    if (parsed.flags.has("--json")) {
      console.log(JSON.stringify(parsed.action === "inspect" ? result.observation : result.plan, null, 2));
    } else if (parsed.action === "inspect") {
      console.log(`${result.observation.provider_id}:${result.observation.item_id} ${result.observation.status}`);
      console.log(`Title: ${result.observation.title}`);
      console.log(`Revision: ${result.observation.revision}`);
      console.log(`External write: not performed`);
    } else {
      console.log(`${result.plan.work_item_id}: ${result.plan.review_count} tracker action(s)`);
      for (const action of result.plan.actions) console.log(`[${action.severity.toUpperCase()}] ${action.id}: ${action.reason}`);
      console.log(`External write: not performed`);
    }
    return 0;
  }
  if (parsed.action === "reconcile") {
    if (!parsed.options["--observation"]) throw new Error("tracker reconcile requires --observation for reproducible evidence");
    const result = await withProjectMutationLock(target, async () => {
      const reconciled = await reconcileTrackerItem(target, {
        workItemId: parsed.options["--work-item"],
        providerId: parsed.options["--provider-id"],
        observationPath: parsed.options["--observation"],
        resolution: parsed.options["--resolution"],
        reason: listOption(parsed, "--reason").join("; "),
        actor: parsed.options["--actor"]
      });
      await refreshViews(target);
      return reconciled;
    });
    printResult(parsed, result, [
      `Reconciled ${result.item.id}: ${result.resolution}`,
      `Evidence: ${result.artifact}`,
      `External write: not performed`
    ]);
    return 0;
  }
  throw new Error(`Unknown tracker action: ${parsed.action}`);
}

async function runPack(parsed) {
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action === "list") {
    const packs = await listPackState(target);
    if (parsed.flags.has("--json")) console.log(JSON.stringify(packs, null, 2));
    else {
      for (const pack of packs) {
        console.log(
          `${pack.id}\t${pack.installed ? `installed@${pack.installed_version}` : "available"}\t${pack.skills.join(",")}`
        );
      }
    }
    return 0;
  }
  if (!parsed.options["--pack"]) throw new Error(`pack ${parsed.action ?? "command"} requires --pack`);
  if (parsed.action === "install") {
    const plan = await planPackInstall(target, parsed.options["--pack"]);
    console.log(formatPackPlan(plan, "install"));
    if (plan.conflicts.length > 0) return 1;
    if (parsed.flags.has("--dry-run")) {
      console.log("Dry run complete; no files were written.");
      return 0;
    }
    await withProjectMutationLock(target, async () => {
      const lockedPlan = await planPackInstall(target, parsed.options["--pack"]);
      if (lockedPlan.conflicts.length > 0) {
        throw new Error(`Pack installation stopped before writing:\n- ${lockedPlan.conflicts.join("\n- ")}`);
      }
      await executePackInstall(lockedPlan);
      await refreshViews(target);
    });
    const doctor = await runDoctor(target);
    console.log(`Installed optional pack ${parsed.options["--pack"]}.`);
    console.log(formatDoctor(doctor));
    return doctor.healthy ? 0 : 1;
  }
  if (parsed.action === "remove") {
    const plan = await planPackRemove(target, parsed.options["--pack"]);
    console.log(formatPackPlan(plan, "remove"));
    if (plan.conflicts.length > 0) return 1;
    if (parsed.flags.has("--dry-run")) {
      console.log("Dry run complete; no files were written.");
      return 0;
    }
    await withProjectMutationLock(target, async () => {
      const lockedPlan = await planPackRemove(target, parsed.options["--pack"]);
      if (lockedPlan.conflicts.length > 0) {
        throw new Error(`Pack removal stopped before writing:\n- ${lockedPlan.conflicts.join("\n- ")}`);
      }
      await executePackRemove(lockedPlan);
      await refreshViews(target);
    });
    const doctor = await runDoctor(target);
    console.log(`Removed optional pack ${parsed.options["--pack"]}.`);
    console.log(formatDoctor(doctor));
    return doctor.healthy ? 0 : 1;
  }
  throw new Error(`Unknown pack action: ${parsed.action}`);
}

async function runCapability(parsed) {
  const target = await assertSafeTarget(parsed.target);
  const registry = await buildCapabilityRegistry(target);
  if (parsed.action === "list") {
    if (parsed.flags.has("--json")) console.log(JSON.stringify(registry, null, 2));
    else if (registry.capabilities.length === 0) console.log("No repository Skills discovered.");
    else {
      for (const capability of registry.capabilities) {
        console.log(
          `${capability.id}\t${capability.status}\t${capability.distribution}\t${capability.invocation}\t${capability.path}`
        );
      }
    }
    return registry.issues.length ? 1 : 0;
  }
  if (parsed.action === "find") {
    const query = String(parsed.options["--query"] ?? "").trim();
    if (!query) throw new Error("capability find requires --query");
    const results = await findCapabilities(target, {
      query,
      position: parsed.options["--position"],
      limit: positiveIntegerOption(parsed, "--limit"),
      registry
    });
    if (parsed.flags.has("--json")) console.log(JSON.stringify(results, null, 2));
    else if (results.length === 0) console.log("No matching repository capability found.");
    else {
      for (const result of results) {
        console.log(`${result.id}\t${result.score}\t${result.reasons.join(",")}\t${result.source.path}`);
      }
    }
    return registry.issues.length ? 1 : 0;
  }
  throw new Error(`Unknown capability action: ${parsed.action}`);
}

async function runContext(parsed) {
  if (parsed.action === "enter") {
    assertCommandOptions(parsed, ["--work-item", "--position", "--agent-id", "--principal-id", "--purpose", "--expected-plan", "--available-whole-sources", "--material", "--format"], ["--no-write", "--json"]);
    if (!parsed.flags.has("--no-write") || !parsed.flags.has("--json")) throw new OperationError("INVALID_INPUT", "Context enter requires --no-write and --json");
    const format = parsed.options["--format"] ?? "full";
    if (!["full", "model"].includes(format)) throw new OperationError("INVALID_INPUT", "Context enter format must be full or model");
    const target = await assertSafeTarget(parsed.target);
    const { enterWorkItemContext } = await import("./context-enter.mjs");
    let availableWholeSources;
    if (parsed.options["--available-whole-sources"] !== undefined) {
      try { availableWholeSources = JSON.parse(parsed.options["--available-whole-sources"]); }
      catch { throw new OperationError("INVALID_INPUT", "Available whole sources must be valid JSON"); }
    }
    const result = await enterWorkItemContext(target, { workItemId: parsed.options["--work-item"], position: parsed.options["--position"], agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"], purpose: parsed.options["--purpose"], expectedPlan: parsed.options["--expected-plan"], availableWholeSources, material: parsed.options["--material"] });
    const { modelContextView } = await import("./context-enter.mjs");
    console.log(JSON.stringify(format === "model" ? modelContextView(result) : result, null, 2));
    return result.status === "eligible" ? 0 : 1;
  }
  if (parsed.action === "packet") {
    assertCommandOptions(parsed, ["--work-item", "--position", "--purpose", "--material", "--expected-plan"], ["--no-write", "--json"]);
    if (!parsed.flags.has("--no-write") || !parsed.flags.has("--json")) throw new OperationError("INVALID_INPUT", "Context packet requires --no-write and --json");
    const target = await assertSafeTarget(parsed.target);
    const { acquireContextPacket } = await import("./context-packet.mjs");
    const packet = await acquireContextPacket(target, {
      workItemId: parsed.options["--work-item"], position: parsed.options["--position"],
      purpose: parsed.options["--purpose"], material: parsed.options["--material"], expectedPlan: parsed.options["--expected-plan"]
    });
    console.log(JSON.stringify(packet, null, 2));
    return packet.acquisition === "complete" ? 0 : 1;
  }
  if (parsed.flags.has("--compact")) {
    assertCommandOptions(parsed, ["--work-item", "--position", "--agent-id", "--principal-id", "--query", "--revision", "--stage", "--purpose", "--limit"], ["--compact", "--no-write", "--json"]);
    if (!parsed.flags.has("--no-write") || !parsed.flags.has("--json")) throw new OperationError("INVALID_INPUT", "Compact context requires --no-write and --json");
    if (!parsed.options["--work-item"]) throw new OperationError("INVALID_INPUT", "context resolve requires --work-item");
  }
  const target = await assertSafeTarget(parsed.target);
  if (parsed.action !== "resolve") throw new Error(`Unknown context action: ${parsed.action}`);
  if (!parsed.options["--work-item"]) throw new Error("context resolve requires --work-item");
  const capsule = await resolveWorkItemContext(target, {
    agentId: parsed.options["--agent-id"], principalId: parsed.options["--principal-id"],
    workItemId: parsed.options["--work-item"],
    position: parsed.options["--position"],
    query: parsed.options["--query"],
    revision: parsed.options["--revision"],
    stage: parsed.options["--stage"],
    purpose: parsed.options["--purpose"],
    limit: positiveIntegerOption(parsed, "--limit"),
    compact: parsed.flags.has("--compact")
  });
  const outputPath = parsed.flags.has("--no-write") ? null : await writeContextCapsule(target, capsule);
  if (parsed.flags.has("--json")) console.log(JSON.stringify(capsule, null, 2));
  else {
    console.log(`${capsule.work_item.id} context for ${capsule.position.name} / ${capsule.agent.display_name}`);
    console.log(`Revision: ${capsule.revision ?? "not recorded"}`);
    console.log(`Route: ${capsule.route.stage} / ${capsule.route.purpose} (${capsule.route.stage_source})`);
    console.log(`Context routes: ${capsule.context_routes.map((entry) => entry.id).join(", ") || "none"}`);
    console.log(`Learning: ${capsule.learning.map((entry) => entry.id).join(", ") || "none"}`);
    console.log(`Capabilities: ${capsule.capabilities.map((entry) => entry.id).join(", ") || "none"}`);
    console.log(`Affected-path overlaps: ${capsule.affected_path_overlaps.length}`);
    console.log(
      `Parallel execution: ${capsule.parallel_execution.disposition ?? "unplanned"} (fresh=${capsule.parallel_execution.plan_fresh ?? "n/a"})`
    );
    console.log(`Retrieval: ${capsule.retrieval.provider_id} (semantic=${capsule.retrieval.semantic})`);
    console.log(`Selected sources: ${capsule.source_manifest.measured_source_count}/${capsule.source_manifest.source_count} measured, ${capsule.source_manifest.measured_bytes} bytes`);
    console.log(`Selection digest: ${capsule.source_manifest.selection_digest}`);
    if (outputPath) console.log(`Context Capsule: ${path.relative(target, outputPath).split(path.sep).join("/")}`);
    if (capsule.warnings.length) console.log(`Warnings: ${capsule.warnings.join(" | ")}`);
  }
  return 0;
}

async function dispatch(argv) {
  const parsed = parseCommand(argv);
  if (parsed.command === "help" || parsed.flags.has("--help")) {
    console.log(HELP);
    return 0;
  }
  if (parsed.command === "version") {
    console.log(TEMPLATE_VERSION);
    return 0;
  }
  if (parsed.command === "chamber") {
    console.log(CHAMBER);
    return 0;
  }
  if (["measurement", "reconcile"].includes(parsed.command) ||
      parsed.command === "collaboration" && ["readiness", "preview-profile", "apply-profile", "setup-contributor"].includes(parsed.action) ||
      parsed.command === "evidence" && ["durability", "export-bundle", "verify-bundle", "import-bundle"].includes(parsed.action)) {
    const { runFieldCommand } = await import("./field-commands.mjs");
    return runFieldCommand(parsed);
  }
  if (parsed.command === "init") return runInit(parsed);
  if (parsed.command === "upgrade") return runUpgrade(parsed);
  if (parsed.command === "backup") return runBackup(parsed);
  if (parsed.command === "restore") return runRestore(parsed);
  if (parsed.command === "audit") return runAudit(parsed);
  if (parsed.command === "publication") return runPublication(parsed);
  if (parsed.command === "federation") return runFederation(parsed);
  if (parsed.command === "portfolio") return runPortfolio(parsed);
  if (parsed.command === "experiment") return runExperiment(parsed);
  if (parsed.command === "doctor") return runDoctorCommand(parsed);
  if (parsed.command === "status") return runStatusCommand(parsed);
  if (parsed.command === "observe") return runObserveCommand(parsed);
  if (parsed.command === "control-plane") return runControlPlane(parsed);
  if (parsed.command === "console") return runConsole(parsed);
  if (parsed.command === "collaboration") return runCollaboration(parsed);
  if (parsed.command === "work-item" && ["contract", "validate-contract"].includes(parsed.action)) return runTaskContract(parsed);
  if (parsed.command === "work-item" && ["create", "propose"].includes(parsed.action)) return runWorkItemCreate(parsed);
  if (parsed.command === "work-item" && parsed.action === "configure") return runWorkItemConfigure(parsed);
  if (parsed.command === "work-item" && parsed.action === "claim") return runWorkItemClaim(parsed);
  if (parsed.command === "work-item" && parsed.action === "release") return runWorkItemRelease(parsed);
  if (parsed.command === "work-item" && parsed.action === "deliver") return runWorkItemDeliver(parsed);
  if (parsed.command === "work-item" && parsed.action === "finish") return runWorkItemFinish(parsed);
  if (parsed.command === "work-item" && parsed.action === "finish-recover") return runWorkItemFinishRecovery(parsed);
  if (parsed.command === "work-item" && parsed.action === "rework") return runWorkItemRework(parsed);
  if (parsed.command === "work-item" && parsed.action === "migrate-outcomes") return runWorkItemMigrateOutcomes(parsed);
  if (parsed.command === "work-item" && parsed.action === "unresolved") return runWorkItemUnresolved(parsed);
  if (parsed.command === "parallel") return runParallel(parsed);
  if (parsed.command === "resource") return runResource(parsed);
  if (parsed.command === "worker") return runWorker(parsed);
  if (parsed.command === "evidence") return runEvidence(parsed);
  if (parsed.command === "schema") return runSchema(parsed);
  if (parsed.command === "migration") return runMigration(parsed);
  if (parsed.command === "learning") return runLearning(parsed);
  if (parsed.command === "retrieval") return runRetrieval(parsed);
  if (parsed.command === "evaluation") return runEvaluation(parsed);
  if (parsed.command === "usage") return runUsage(parsed);
  if (parsed.command === "delivery") return runDailyDelivery(parsed);
  if (parsed.command === "execution") return runExecution(parsed);
  if (parsed.command === "adapter") return runAdapter(parsed);
  if (parsed.command === "handoff") return runHandoff(parsed);
  if (parsed.command === "transition") return runTransition(parsed);
  if (parsed.command === "close") return runClose(parsed);
  if (parsed.command === "task") return runTask(parsed);
  if (parsed.command === "tracker") return runTracker(parsed);
  if (parsed.command === "pack") return runPack(parsed);
  if (parsed.command === "capability") return runCapability(parsed);
  if (parsed.command === "context") return runContext(parsed);
  throw new Error(`Unknown command: ${parsed.command}${parsed.action ? ` ${parsed.action}` : ""}\n\n${HELP}`);
}

export async function main(argv) {
  const delivery = argv[0] === "delivery" || argv[0] === "work-item" && ["deliver", "finish"].includes(argv[1]);
  const compact = argv[0] === "context" && ((argv[1] === "resolve" && argv.includes("--compact")) || ["packet", "enter"].includes(argv[1]));
  if (!delivery && !compact && !argv.includes("--json")) {
    try { return await dispatch(argv); }
    catch (error) {
      if (error.next_action) error.message += `\nNext action: ${error.next_action}`;
      throw error;
    }
  }
  try {
    try {
      const seen = new Set();
      for (let i = 2; i < argv.length; i++) {
        const name = argv[i];
        if (!name.startsWith("--")) continue;
        const learningId = argv[0] === "learning" && name === "--learning-id";
        if (seen.has(name) && learningId && argv[1] !== "record-review") throw new Error("This Learning operation accepts exactly one --learning-id");
        if (seen.has(name) && !REPEATABLE_FLAGS.has(name) && !(learningId && argv[1] === "record-review")) throw new Error(`Duplicate option: ${name}`);
        seen.add(name);
        if (VALUE_FLAGS.has(name)) i++;
      }
      parseCommand(argv);
    } catch (error) {
      throw new OperationError("INVALID_INPUT", error.message);
    }
    return await dispatch(argv);
  } catch (error) {
    if (!argv.includes("--json")) throw error;
    console.log(JSON.stringify(operationErrorResult(error, { readOnly: compact || argv[0] === "delivery" && ["next", "report"].includes(argv[1]) || argv[0] === "work-item" && ["contract", "validate-contract"].includes(argv[1]) }), null, 2));
    console.error(`Temple error: ${error.message}`);
    return 1;
  }
}
