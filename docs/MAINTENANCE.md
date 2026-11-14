# Optional maintenance worker

Normal Aw setup does not enroll or start an autonomous repair worker. Most users
can leave it that way. Sync already has deterministic guards, reconnect backoff,
change journals and recovery receipts; an LLM is not needed for ordinary transfer.

The experimental `awMaintenance.py` worker can accept bounded incidents and ask
an explicitly configured local model for a proposal. Read the script's help and
policy before enrolling it. It needs Linux sandbox support and a working local
helper; there is no unsandboxed or paid fallback. Its `--auto-deploy` mode is a
separate opt-in operation, not part of installing or enabling sync.

Candidate edits are limited to the worker's allowlist. Deployment requires fixed
targeted tests, typechecking, unchanged code hashes, a deployment lock and retained
before-images/receipts. It cannot modify its own policy, accept arbitrary commands,
edit research stores or restart another owner's service. Do not widen these limits
to make a weak model's patch pass. Passing tests is not general safety evidence.

Inspect current incident, proposal, complete check logs, deployment receipt and
progress before acting on an escalation. Preserve partial preparations and
originals. Never delete sync history, force a lock or overwrite human text to make
a status indicator green. If the configured model/runtime is unavailable, defer
or escalate; do not silently download one. Work already in progress keeps running.
