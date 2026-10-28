# QuickXBuild Self-Improving Model Foundation (MODEL-001)

This phase adds the foundation for QuickXBuild to learn from teacher-assisted development
runs. It does **not** train a model. Everything is behind feature flags that default to off.

- Service: [`services/model-server`](../services/model-server/README.md) (Python, FastAPI)
- Runtime integration: `apps/web/ai/model-gateway/*`, `apps/web/ai/agent/gateway-*.ts`,
  `apps/web/ai/agent/complete-run.ts`

## 1. Architecture

```text
User
  |
  v
QuickXBuild (apps/web, /api/ai)
  |
  v
Agent Runtime (runAgentLoop: mutation lock, tools, sandbox, Phase 3 build/repair/preview, gate)
  |
  v
Model Gateway (apps/web/ai/model-gateway/client.ts  ->  services/model-server)
  |
  +---- QuickXBuild Model   (LocalModelProvider: OpenAI-compatible endpoint you host)
  |
  +---- Test Model          (TestModelProvider: deterministic, dev/CI only)
  |
  +---- Future Models       (ModelProvider ABC + ModelRegistry versions)

Model uncertainty (low confidence, repeated build failure, no valid action, ...)
  |
  v
Teacher Gateway (budgeted, sanitized, bounded retries)
  |
  v
OpenAI Teacher (strict JSON schema, no chain-of-thought)
  |
  v
Structured Guidance (summary, steps, proposed actions, confidence, warnings)
  |
  v
QuickXBuild Model re-plans with guidance  ->  Agent Runtime validates + executes

Successful trajectory
  |
  v
Sanitize (TS redaction, then server re-sanitization + secret re-scan)
  |
  v
Quality Score (gate copied from runtime-gate.ts, never recomputed)
  |
  v
Dataset (deterministic, versioned, only explicitly eligible trajectories)
  |
  v
Future Training (interfaces only: SFT / LoRA / preference / reward)
  |
  v
QuickXBuild Model v2 (registered as development -> evaluation -> candidate -> production)
```

Key rule: **the Agent Runtime remains the only execution authority.** There is no second
sandbox, no second build system and no second mutation lock. The model service only returns
proposals; `gateway-pass.ts` executes each proposal through the existing `createAgentTools`
tools (`write_file`, `apply_patch`, `install_packages`, `execute_command`), which persist through
`persistMutation` into the sandbox with durable history and runtime events. Builds always run in
the shared Phase 3 pipeline (`completeAgentRun` in `complete-run.ts`), used by both the provider
path and the gateway path, so both share one gate implementation.

## 2. Model Gateway

- Web side: `createModelGatewayClient(config)` calls `POST /v1/inference/stream` server to server,
  parses NDJSON events (`model.status`, `model.teacher_escalation`, `model.final`, `model.failed`)
  and validates the final response with zod (`contracts.ts`) **before** any proposal reaches a tool.
  Unsafe paths (absolute, `..`, `.env*`, `.git`, `node_modules`), unknown tools, extra fields and
  unsafe package names are rejected.
- Service side: `ModelGateway.infer` (`app/inference/engine.py`) calls the active `ModelProvider`
  with bounded retries, drops actions for tools the runtime did not offer, runs the escalation
  policy, optionally consults the teacher and re-infers with the guidance.
- Runtime flow when `QUICKXBUILD_MODEL_SERVICE_ENABLED=true`:
  `agent_start` → model turn → tool execution → Phase 3 build → on failure, repair turns with the
  diagnostic (`runtime_state.phase=repair`) → preview → gate → `agent_done`.
- Fallback: if the model service cannot answer the **first** turn (unreachable, invalid response),
  nothing has been mutated yet and the run continues on the existing provider path. Repair-turn
  failures end the repair attempt; the Phase 3 failure budget still applies.

## 3. Teacher Gateway

- `TeacherProvider` ABC with `OpenAITeacherProvider` and `TestTeacherProvider`.
  **OpenAI is the teacher, not the QuickXBuild model.**
- The OpenAI request uses a strict `json_schema` response format. It asks for structured guidance
  only and never requests chain-of-thought or reasoning traces.
- `EscalationPolicy` (`app/teacher/policy.py`), evaluated in order: repeated build failure (repair
  phase with `build_failures >= TEACHER_MAX_REPAIR_ATTEMPTS`), repeated preview failure, repeated
  tool failure, model signals (unknown framework, unfamiliar package, unrepairable diagnostic),
  no valid action, low confidence (`< TEACHER_CONFIDENCE_THRESHOLD`), complexity exceeded.
- Blocks: teacher disabled, runtime did not allow it (`QUICKXBUILD_TEACHER_ENABLED=false`), or
  per-task budget exhausted (`TEACHER_MAX_CALLS_PER_TASK`).
- The teacher never writes to the sandbox. Its guidance goes back to the QuickXBuild model, and the
  resulting proposals are validated and executed by the Agent Runtime like any other.

## 4. Model service

FastAPI app (`app/main.py`, `create_app(settings, container)`), with:
request ids (`X-Request-ID`), an error envelope `{"error": {code, message, request_id}}`,
validation errors that never echo input, docs disabled in production, optional bearer auth
(`hmac.compare_digest`), JSON logs with correlation ids, and local JSON storage behind a `Storage`
ABC (`app/storage`). See the [service README](../services/model-server/README.md) for endpoints.

## 5. Trajectory lifecycle

1. With `QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED=true`, `runAgentLoop` wraps `onAgentEvent` with
   a recorder (`trajectory-recorder.ts`). It observes the **same runtime events** the browser gets,
   skipping legacy `progress`/`timeline`/`build_plan`, and adds `model_decision`,
   `teacher_intervention` and `repair_attempt` steps. Tool results are tagged `source: model|teacher`.
2. After the run, and **after the project mutation lock is released**, the payload is submitted to
   `POST /v1/trajectories` with a short timeout. Failures are logged and never fail the request.
3. The server validates it (forbidden reasoning keys are rejected recursively), sanitizes it,
   re-scans for secrets (rejects if any remain), scores it and stores it with
   `training_eligible=false`.
4. A human/operator process may mark it eligible with
   `PATCH /v1/trajectories/{id}/eligibility` (re-scanned for secrets first).

No chain-of-thought is stored anywhere: only prompts, runtime events, model decisions (content,
confidence, proposed actions), teacher summaries/steps and final file snapshots.

## 6. Dataset lifecycle

`POST /v1/datasets/build {dataset_version: "vN", min_quality: 0.7, require_gate_success: true}`:

- Candidates are sorted by id so builds are deterministic.
- Rejections are recorded with a reason: `not_training_eligible`, `gate_failed`,
  `below_quality_threshold`, `secret_detected`. Every example is re-scanned before inclusion.
- Each example contains task, context, solution, tool actions (with source), diagnostics,
  teacher guidance and outcome. `example_id = ex-<sha>`, `dataset_id = ds-<sha16>` of content.
- Same version + same content is idempotent; same version + different content → 409;
  no examples → 422. A JSONL export is written alongside the manifest.

## 7. Quality scoring

`app/learning/scoring.py`, scorer version `q1`. Gate success is **copied** from the Agent
Runtime gate (`runtime-gate.ts`), never recomputed.

| Component | Weight |
|---|---|
| task success (gate) | 0.35 |
| build success | 0.20 |
| preview success | 0.15 |
| tests (0.5 if none ran) | 0.10 |
| requested changes written | 0.10 |
| valid dependencies | 0.10 |

Penalties: 0.05 per repair (max 0.20), 0.02 per failed tool (max 0.10), 0.30 for a write
outside allowed paths, 0.20 when secrets were found during sanitization. Score is clamped to 0–1.

## 8. Model versioning

Versions are named `quickxbuild-model-vN` and move through
`development → evaluation → candidate → production → retired`.

| From | Allowed to |
|---|---|
| development | evaluation, retired |
| evaluation | development, candidate, retired |
| candidate | evaluation, production, retired |
| production | retired |

`candidate` and `production` require evaluation results. Only one version can be `production`.
There is **no automatic promotion**; every transition is an explicit API call with a reason.

## 9. Security

- No API keys in source, Git, logs, trajectories or datasets. `OPENAI_API_KEY` is read only by the
  model server (as `SecretStr`); `MODEL_SERVICE_TOKEN` only by the web server. Neither is a
  `NEXT_PUBLIC_*` variable and the browser never talks to the model service.
- The model service cannot execute commands or write files. Proposals are validated twice
  (pydantic on the server, zod in the web app) and then executed by the Agent Runtime tools, which
  re-validate paths and use the allowlisted command runner.
- Project isolation and the existing project mutation lock remain authoritative.
- Production mode requires a service token and refuses the test provider.

## 10. Privacy

- Two-layer redaction: `sanitize.ts` in the web app before submission, then
  `app/security/sanitization.py` on ingest (private keys, OpenAI/Anthropic/Google/GitHub/AWS/
  Stripe/Slack tokens, JWTs, bearer and authorization headers, URL credentials, cookies, env-style
  secret assignments, JSON secret values, and email addresses except `example.*` domains).
- `.env*` file contents are replaced with `[REDACTED_ENV_FILE]`.
- Trajectories are ingested with `training_eligible=false`; nothing enters a dataset without an
  explicit eligibility change and a clean secret re-scan.

## 11. Testing

| Suite | Where | Network |
|---|---|---|
| Python unit/API/scenario tests | `services/model-server/tests` | none (test provider + test teacher, `httpx.MockTransport`) |
| Opt-in real teacher test | `tests/test_teacher_integration.py` | OpenAI, only with `RUN_TEACHER_INTEGRATION_TESTS=true` + `OPENAI_API_KEY` |
| TS unit tests (client, contracts, recorder, flags) | `apps/web/ai/__tests__/model-gateway-unit.test.ts` | none |
| TS E2E against the real server | `apps/web/ai/__tests__/model-gateway-e2e.test.ts` | localhost only |

Deterministic acceptance scenarios (both in Python and through the real Agent Runtime in TS):

- **30 Hotel website**: build fails on a missing `BookingWidget`, the model's repair creates the
  wrong file, the second failure escalates to the teacher, the guided repair passes, then preview
  and gate succeed. The trajectory is stored, refused by the dataset builder until marked eligible,
  then built into a dataset.
- **31 "Change the homepage hero heading to 'Discover Nepal'"**: one patch, no teacher.
- **32 Low confidence**: "Add a testimonials section" escalates before the build; guided changes pass.
- **33 Build fails twice**: build_error → repair → build_error → repair + teacher → build_success.

## 12. Environment variables

Web app (`apps/web/env.mjs`, server-only):

| Variable | Default | Meaning |
|---|---|---|
| `QUICKXBUILD_MODEL_SERVICE_ENABLED` | `false` | Route generation through the ModelGateway |
| `QUICKXBUILD_TEACHER_ENABLED` | `false` | Allow teacher escalation for runtime requests |
| `QUICKXBUILD_TRAJECTORY_RECORDING_ENABLED` | `false` | Record and submit trajectories |
| `MODEL_SERVICE_URL` | — | e.g. `http://localhost:3010` (flags are inert without it) |
| `MODEL_SERVICE_TOKEN` | — | Bearer token shared with the model server |
| `MODEL_SERVICE_TIMEOUT_MS` | `120000` | Per-inference timeout |

Model server:

| Variable | Default | Meaning |
|---|---|---|
| `SERVICE_ENV` | `development` | `production` requires a token and a non-test provider |
| `MODEL_PROVIDER` | `test` | `test` or `local` (OpenAI-compatible endpoint) |
| `MODEL_NAME`, `MODEL_VERSION` | test model, `quickxbuild-model-v0` | Active model identity |
| `MODEL_BASE_URL`, `MODEL_API_KEY` | — | Required for `local` |
| `MODEL_DATA_DIR` | `data` | Local JSON storage root |
| `TEACHER_ENABLED` | `false` | Enable the teacher |
| `TEACHER_PROVIDER` | `openai` | `openai` or `test` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | —, `gpt-4.1-mini` | Teacher credentials/model |
| `TEACHER_CONFIDENCE_THRESHOLD` | `0.6` | Low-confidence threshold |
| `TEACHER_MAX_REPAIR_ATTEMPTS` | `2` | Build failures before escalation |
| `TEACHER_MAX_CALLS_PER_TASK` | `3` | Teacher budget per task |
| `TEST_MODEL_PROVIDER` | — | Forces the test provider |
| `RUN_TEACHER_INTEGRATION_TESTS` | `false` | Enables the real OpenAI test |

## 13. Local development

```bash
# Model server
cd services/model-server
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # Windows
MODEL_PROVIDER=test TEACHER_ENABLED=true TEACHER_PROVIDER=test \
  .venv/Scripts/python -m uvicorn app.main:app_factory --factory --port 3010

# Web app (.env)
QUICKXBUILD_MODEL_SERVICE_ENABLED=true
MODEL_SERVICE_URL=http://localhost:3010
bun dev:web

# Or with Docker
docker compose --profile model up model-server
```

## 14. Future training architecture

`app/training/base.py` defines `TrainingBackend` plus `SupervisedFineTuning`, `LoraPeftTraining`,
`PreferenceOptimization` and `RewardOptimization` interfaces. The only implementation is
`NotImplementedTrainingBackend`: `POST /v1/training/jobs` records a job with status
`not_implemented`. No training, GPU usage or model upload happens in this phase.

A later, separately approved phase would add: a Postgres storage backend for trajectories/datasets,
a real trainer consuming dataset JSONL exports, offline evaluation suites producing
`EvaluationResult`s, and registration of the trained model as `quickxbuild-model-v1` in
`development`, promoted only through explicit transitions.
