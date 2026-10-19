# Develop the framework without publishing development data

The public repository is a framework distribution and source repository. Keep
the process of building it in a separate private workspace. This rule also applies
to ignored files: a clean public checkout is not a place to store real tasks.

| Public framework source | Private development workspace |
| --- | --- |
| Runtime and CLI source | Actual tasks, assignments, plans and approvals |
| Public usage, architecture and contribution documentation | Conversations, prompts, dispatch and host records |
| Fictional examples | Experiment captures, measurements and real project data |
| Reproducible product tests and synthetic fixtures | Raw test output, screenshots, review and acceptance evidence |
| Concise product-facing PR and release descriptions | Workkeel task state, local policy, machine settings and backups |

Create public examples from fictional inputs; removing names from a real record
is not sufficient review.

## Set up the private workspace

Keep the public source checkout and private workspace in separate directories,
not nested in one another. The private workspace holds a working copy of the
public framework so native Workkeel can validate its exact Git candidate. It has
no public push destination and is not a second framework implementation.

```sh
WORKKEEL_SOURCE=/path/to/workkeel
WORKKEEL_WORKSPACE=/path/to/private/workkeel-development
git clone --no-hardlinks "$WORKKEEL_SOURCE" "$WORKKEEL_WORKSPACE"
git -C "$WORKKEEL_WORKSPACE" remote set-url --push origin DISABLED
cd "$WORKKEEL_WORKSPACE"
npm ci --ignore-scripts
node bin/workkeel.mjs init .
node bin/workkeel.mjs doctor .
```

The fetch remote is the local public checkout. Do not change this private
workspace's push URL to a public host. Keep actual policy, work orders, task
records and evidence uncommitted, even here; preserve them in a separate private
backup. Never push this workspace wholesale to either public or private remotes.
Backups preserve state separately from the framework's source history.

`init .` registers the `builder` and `reviewer` Agents described in the
[native setup guide](../getting-started/workkeel.md). To use a different reviewed
policy instead, save it as `.workkeel-private/policy.json` **inside the private
workspace** and run `node bin/workkeel.mjs init . --policy .workkeel-private/policy.json`.

Read [AGENTS.md](../../AGENTS.md) and the generated `WORKKEEL.md`. Use the pinned
source CLI and [daily lifecycle](workkeel-daily-work.md) there: approved brief,
claim, implementation, exact-candidate checks, actual different-Agent review and
authorized acceptance. Store lifecycle requests and evidence under private
`.ai-org/` paths. Do not follow generic product examples that place real work
orders in public `docs/`. The public checkout needs no initialization for source
inspection or product tests.

For an existing initialized checkout, stop its writers, copy state and referenced
evidence to the private workspace, verify file digests and native Doctor there,
and verify an independent backup before removing anything from the public checkout.
Preserve pinned evidence bytes and source commits; do not rewrite task history to
make relocation pass. Keep the original state in the private backup for recovery.

## Verify and promote only source

Implement and run candidate verification in the private workspace. Redirect raw
logs there and run browser gates there, since failure screenshots are development
output. Product tests create isolated synthetic temporary fixtures. Review source
diffs, explicitly stage public files and update `public-files.json` only for new
files whose purpose and contents have been reviewed.

Framework content checks exclude the root `.workkeel-private/` evidence directory,
as they exclude native `.ai-org/` records and generated output. Retained failures
and multilingual review observations are not public documentation or JSON fixtures.
Native Doctor still checks canonical state and pinned evidence. Publication and
`check:source-checkout` remain separate boundaries and reject private records in
public source; this exclusion grants no permission to commit or transfer them.

Commit only framework files. Run the required [testing gate](../getting-started/testing.md)
on the exact candidate and get a different Agent's review. Run the history scanner
in the private workspace too: ignored state is not committed state.

To transfer an approved source candidate without copying its working directory:

```sh
# Set CANDIDATE to the full reviewed commit ID and choose an unused workkeel/* branch name.
git -C "$WORKKEEL_SOURCE" fetch --no-tags "$WORKKEEL_WORKSPACE" "$CANDIDATE"
git -C "$WORKKEEL_SOURCE" switch -c workkeel/reviewed-change FETCH_HEAD
cd "$WORKKEEL_SOURCE"
npm run setup:hooks
npm run check:source-checkout
npm run check:publication
npm run check:public-history
```

Confirm the public checkout's HEAD equals the reviewed candidate. Do not copy
`.ai-org/`, `WORKKEEL.md`, launchers, policies, output or backups across. If source
integration changes the candidate, verify and review the new candidate. Run
`check:source-checkout` again after local verification to detect newly created
data paths.

Push only within the authorized scope. The pre-push hook installed by
`npm run setup:hooks` refuses every push except to `workkeel/*` branches, so
`main` changes only through a PR. It also reruns `check:source-checkout` and the
history check over every outgoing commit. CI runs `npm run verify` and the
publication checks on each PR; keep a short check summary in the PR and full
evidence privately.

`check:source-checkout` is deliberately for the public checkout and will reject
an initialized private workspace. It recursively checks known private path names
while skipping Git metadata and root dependencies. It cannot prove that all
arbitrary prose is public. The [publication guard](publication-boundary.md), file
review and private backup are separate controls.
