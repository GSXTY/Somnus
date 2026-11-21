# Explorer platform acceptance

The upgrade gate is local and does not package, publish, or synchronize Standard.

Run `python tools/platform_gate.py check --report .tmp/platform-gate.json` with the project test dependencies installed. It runs the bounded state/recovery, permission/model/mode, group/plugin, host lifecycle/contracts/resource suites. A failing or timed out group fails the gate. Each report records exact source and built UI asset hashes, the top-level DSH version pin, and any locally resolved runtime lock hashes. A local lock fingerprint is evidence of this installation, not a promise that ranged upstream dependencies can always be reinstalled identically.

Run `python tools/platform_gate.py verify --report .tmp/platform-gate.json` immediately before review. Any source or UI asset change invalidates the report. To create a review artifact, use `python tools/platform_gate.py candidate --report .tmp/platform-gate.json --candidate .tmp/platform-candidate.json`. Candidate files are exclusive-create and bind both source fingerprint and report hash; `verify --candidate` checks that binding. This is a local review candidate, not authorization to release. The human still decides what reaches Standard and GitHub.

`build_electron.py` runs a fresh gate before any backend or shell build. The release workflow runs the same gate before the older standalone packaging path. No workflow was started as part of this change.

Portable plugin tools: `python tools/plugin_contract.py template example.json` creates a v1 text-only Skill package; `validate example.json` uses the same real importer validator. Existing v1 packages remain supported. Optional v1 contract declarations allow only known runtime/capabilities and cannot install commands, credentials, or browser components. MCP references bind to the target user's existing configuration; they do not export secrets or grant tool permission. UI slots require an explicit supported adapter and are not claimed as compatible by a text package.
