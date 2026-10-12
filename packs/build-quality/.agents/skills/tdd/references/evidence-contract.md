# Test observation evidence contract

Use `temple.test-observation/v1` only after the named command has actually run. Record the exact Git revision, argument-array command, pass or fail result, numeric exit code, start and completion timestamps, and repository-relative artifact references.

`result: pass` requires `exit_code: 0`; `result: fail` requires a non-zero exit code. A skipped, unavailable, or partially observed environment is not a pass. Preserve it as an explicitly unverified claim or risk instead.

The bundled validator checks the document shape and result consistency. It does not execute the command, inspect the runtime, satisfy a Temple gate, or replace Independent QA.
