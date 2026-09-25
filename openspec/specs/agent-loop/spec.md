# agent-loop Specification

## Purpose
Defines how the worker ⇄ validator build loop picks a model, effort and turn budget for each agent, keeps agent context compact, and reports token usage for every round so cost can be measured and tuned.

## Requirements

### Requirement: Agent model policy

The repository SHALL declare each loop agent's model, effort, turn budget, cache lifetime and allowed MCP servers in a single policy file, and every loop agent definition MUST match it. The quality gate MUST fail when an agent definition omits any of these settings, uses a model or effort value outside the allowed set, or differs from the policy.

#### Scenario: Policy-compliant agents pass

- **WHEN** every agent in `.claude/agents/` declares the model, effort, turn budget and cache lifetime given for it in the policy
- **THEN** `pnpm check:agents` exits 0 and prints a routing table with one row per agent

#### Scenario: Agent without a model is rejected

- **WHEN** an agent definition has no `model` setting
- **THEN** `pnpm check:agents` exits non-zero and names the agent and the missing setting

#### Scenario: Agent drifts from the policy

- **WHEN** an agent definition declares a model or effort different from the policy (for example the validator set to `sonnet`)
- **THEN** `pnpm check:agents` exits non-zero and shows the expected and actual values

#### Scenario: Browser tools are limited to browser QA

- **WHEN** the agents are checked
- **THEN** only the `browser-qa` agent may use the Playwright MCP tools, and an agent that the policy denies them to but that can still reach them is reported as a violation

### Requirement: Worker model escalation

The loop SHALL run the worker on the policy's default model, and SHALL escalate it to the higher-capability model for a round when the change's design declares high complexity, or when the same finding was marked blocking in both of the two previous reviews. The decision MUST be printed together with its reason.

#### Scenario: No escalation by default

- **WHEN** `pnpm loop:route --change <id> --round 1` runs for a change whose design does not declare `complexity: high`
- **THEN** it prints `sonnet` with the reason "policy default"

#### Scenario: Escalate a complex change

- **WHEN** the change's `design.md` contains `complexity: high`
- **THEN** `pnpm loop:route` prints `opus` with the reason "design declares complexity: high" for every round

#### Scenario: Escalate on a repeated blocking finding

- **WHEN** reviews for rounds 1 and 2 both contain a blocking finding with the same title (ignoring case, spacing and the finding number) and the route is requested for round 3
- **THEN** it prints `opus` and names the repeated finding

#### Scenario: Resolved finding does not escalate

- **WHEN** a blocking finding in round 1 no longer appears as blocking in round 2
- **THEN** the route for round 3 stays on the default model

### Requirement: Compact gate output for agents

The quality gate SHALL offer a summary mode that writes each gate's full output to a log file under `artifacts/verify/` and prints only the gate summary, plus, for each failing gate, its last 40 lines and the path of its log. The default mode MUST keep streaming full output.

#### Scenario: Passing gates print only the summary

- **WHEN** `pnpm verify --summary` runs and every gate passes
- **THEN** the output contains the summary table and no gate output, and each gate's full output is in `artifacts/verify/<gate>.log`

#### Scenario: A failing gate prints its tail and log path

- **WHEN** a gate fails in summary mode
- **THEN** the output contains the last 40 lines of that gate's output and the path to its full log, and the command exits non-zero

### Requirement: Token usage report

The loop SHALL provide `pnpm tokens`, which reads the project's Claude Code session transcripts. The report MUST count each API response once, and aggregate per agent and per model: requests, input tokens, output tokens, cache-write tokens, cache-read tokens and cache-hit percentage. It SHALL show a list-price dollar estimate that is clearly labelled as an estimate, from a pricing table that records its source and date. A model missing from the pricing table MUST be shown as unpriced, never as zero cost.

#### Scenario: Report per agent

- **WHEN** `pnpm tokens` runs on a session whose transcripts include a main conversation and subagents
- **THEN** it prints one row per agent and model with requests, input, output, cache write, cache read and cache-hit %, followed by a total row

#### Scenario: Streaming duplicates counted once

- **WHEN** a transcript contains several records with the same response id
- **THEN** that response's usage is counted exactly once

#### Scenario: Unknown model is unpriced

- **WHEN** a transcript contains usage for a model that is not in the pricing table
- **THEN** its tokens are reported and its estimate reads "unpriced"

#### Scenario: No transcripts found

- **WHEN** no transcripts exist for the project or the selected session
- **THEN** `pnpm tokens` prints a clear "no usage found" message naming the directory it searched, and exits 0

### Requirement: Token usage in the round record

The build loop SHALL append a "Tokens" section to every round's review record. The section MUST give the token usage of that round's worker, browser QA, validator and orchestrator. The orchestrator's usage is the main session's usage between the round's recorded start and end marks. The final report MUST total usage across all rounds, including rounds recorded in earlier sessions.

#### Scenario: Round record includes token usage

- **WHEN** a round's review record is written
- **THEN** it ends with a "Tokens" section showing one row per agent that ran in that round, in the same columns as `pnpm tokens`

#### Scenario: Orchestrator usage is attributed to its round

- **WHEN** start and end marks were recorded for a round and the main session made API calls between them
- **THEN** the round's "Tokens" section includes an "orchestrator rN" row with exactly the main-session usage whose timestamps fall inside that window

#### Scenario: Change total spans sessions

- **WHEN** a change's rounds ran in two different sessions and `pnpm tokens --change <id>` runs without `--session`
- **THEN** the report includes the rounds from both sessions and names both sessions

### Requirement: Cost-aware status line

The project SHALL provide a status line that shows the current model, effort, context usage, cache-hit percentage and the session's list-price estimate, and that omits any value Claude Code does not supply.

#### Scenario: Status line renders session data

- **WHEN** the status line command receives Claude Code session JSON with model, effort, context-window and cost fields
- **THEN** it prints one line like `Opus · high · ctx 42% · cache 91% · ~$1.23 list`

#### Scenario: Missing fields are omitted

- **WHEN** the session JSON lacks the cost or prompt-cache fields
- **THEN** the status line prints the remaining parts without "undefined", "NaN" or empty separators
