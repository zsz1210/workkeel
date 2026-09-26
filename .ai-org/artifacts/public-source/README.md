# Public source integration

The repository owner approved publishing the completed Workkeel source changes
without exposing new private task records or machine-local execution sources.
This candidate starts from public main `960cf0ea94422bea66d38e9a307936d3366e2228`.
It carries the accepted product source from the maintainer's local candidate;
it does not import the private candidate's Git ancestry or canonical task records.

Previously public legacy records remain byte-identical. The pinned Workkeel
migration API initializes a native project over that quiescent public history,
using task-policy.json in this directory. The new public project initially has
no native tasks; that is not a claim that the maintainer has done no native work.
Existing local task records, measurements and the observer service stay local.
Future public tasks use WORKKEEL.md and the native lifecycle. Registered builder
and reviewer identifiers describe separate actual executors, not job titles.

This is source integration only. Package publication, a version tag and a GitHub
Release remain separate operations. Publication checks, source equivalence and
exact-candidate verification are recorded in this directory when completed.
