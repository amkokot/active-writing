# Optional local assistance

A local helper is an optional second opinion for routine extraction, log triage,
test planning or a short writing critique. Use deterministic tools first. Keep
research direction, hard reasoning, mathematical judgment and final integration
with the main agent. Do not spend a helper request on a task quicker to do directly.

```text
node APP_CODE/scripts/awDelegate.ts status
node APP_CODE/scripts/awDelegate.ts ask --workspace DATA_HOME --project ID --entry CONVERSATION --file REQUEST.json
```

`status` reads configuration without starting a runtime. `ask` validates ownership,
caches source-linked proposals and retains attempt receipts. It does not execute
suggestions or edit manuscripts. A result is untrusted; validate the useful part
and save it in the owning notebook. Stop after an unhelpful attempt rather than
building a reviewer loop.

No helper is installed or configured by normal Aw setup. Configure a loopback-only
runtime/model explicitly, with bounded context, output, wall time and concurrency.
Inspect `awDelegate.py --help` and `awLocalRuntime.py --help` for the supported
configuration and exact, checksum-verified Linux runtime installer. Weights are
separate downloads and should stay outside paper repositories and sync packets.
Keep keys out of notebooks and public repositories. There is no paid fallback.

## Compute budgets belong to the current machine

Do not assume a particular GPU, RAM capacity, cluster account or free allocation.
Check available resources once before substantial work; agree on aggregate thread,
memory and time caps. Start with a small pilot, use seeds/checkpoints, and set
BLAS/OpenMP thread limits before library imports. Multiple agents share one budget.
Do not evict another job to make room for inference or a simulation.

Notebook runs retain their 30/120/300-second limits. Longer authorized experiments
can run as separately checkpointed scripts and import compact, correctly labelled
results. Keep scratch disposable and evidence durable. Simulations are evidence,
not proofs. Cloud and cluster routes need their own setup and permission.
