# atrium-backend — the executor app

This is the **executor / settlement venue** from the design. In production it:

1. Holds the operator party and a connection to the Canton **JSON Ledger API**.
2. Serves per-party queries to the frontend (scoped by the requesting party).
3. Drives the close: on an accepted `Offer`, builds the `AllocationRequest`, then
   **fetches choice contexts from each token registry's OpenAPI**, attaches them as
   disclosed contracts (deduped by contract-id), and exercises `Allocation_ExecuteTransfer`
   on both legs in one transaction.

Right now it returns mock data so the system runs without LocalNet. Every place that
needs the real ledger is marked `// TODO(ledger)`. The frontend defaults to its own
in-browser mock client, so you don't need this running for the standalone demo — wire
it in at Stage 3 when LocalNet is up.

```bash
npm install
npm run dev   # http://localhost:8080
```
