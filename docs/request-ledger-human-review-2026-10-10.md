# Request-ledger human review — 2026-10-10

Status: **contents explicitly human-confirmed, 2026-10-10**. The user answered `Confermo i quattro ledger corretti`. This confirms the four contents below, without authorizing new model calls. Native desktop application and cancellation were subsequently verified with retained-response replay; real-model candidate and ambiguity qualification remain separate. These are concrete human-approved edits to the four retained model drafts. Stable surviving IDs, original request text and source lines are retained. Original drafts, wire evidence, failed acceptance and frozen expectations remain unchanged. This document does not reclassify the extraction campaign as passing.

Production review already supports editing fields, deleting redundant obligations and explicit confirmation. Confirmation is request-bound; it must never be inferred from native validation or from approval of a schema/call budget. [Runtime contract](./agent-runtime.md#request-first-coverage-ledger--approved-implementation-2026-10-10).

Evidence: `OnlyRag-Live/request-ledger-extraction-target-invariants-v1-2026-10-10T16-16-14-501Z-db53b9a6`. Four native passes, **1/4 full semantic acceptance**; Buttons redundancy is retained separately as a review residue. All proposed corrections below preserve the original independently frozen meanings, without adding features or conditions.

## 1. Universal button touch targets

Remove only the redundant second obligation. Keep the accepted universal Buttons requirement, open inventory and empty conditions/targets.

Proposed ledger:

```json
{
  "request": "- Buttons must have a minimum touch target of 44×44 px.",
  "obligations": [
    {
      "id": "OBL-001",
      "sourceLines": [
        1
      ],
      "requirement": "Buttons must have a minimum touch target of 44×44 px.",
      "subject": "Buttons",
      "scope": "global",
      "targets": [],
      "closedInventory": false,
      "conditions": []
    }
  ]
}
```

## 2. CSV and JSON record order

Remove the duplicate property-based obligation and invented activation conditions. Preserve the complete closed CSV/JSON inventory under exports and global ordering requirement.

Proposed ledger:

```json
{
  "request": "CSV and JSON exports preserve the source record order.",
  "obligations": [
    {
      "id": "OBL-001",
      "sourceLines": [
        1
      ],
      "requirement": "CSV and JSON exports preserve the source record order.",
      "subject": "exports",
      "scope": "global",
      "targets": [
        "CSV",
        "JSON"
      ],
      "closedInventory": true,
      "conditions": []
    }
  ]
}
```

## 3. Conditional CSV encoding and quoting

Keep the two valid distinct-clause obligations and CSV-request trigger. Restore local scope, named CSV target and closed inventory for each.

Proposed ledger:

```json
{
  "request": "If CSV is requested, retain UTF-8 encoding and quote fields containing delimiters.",
  "obligations": [
    {
      "id": "OBL-001",
      "sourceLines": [
        1
      ],
      "requirement": "retain UTF-8 encoding",
      "subject": "CSV export",
      "scope": "local",
      "targets": [
        "CSV"
      ],
      "closedInventory": true,
      "conditions": [
        "CSV is requested"
      ]
    },
    {
      "id": "OBL-002",
      "sourceLines": [
        1
      ],
      "requirement": "quote fields containing delimiters",
      "subject": "CSV export",
      "scope": "local",
      "targets": [
        "CSV"
      ],
      "closedInventory": true,
      "conditions": [
        "CSV is requested"
      ]
    }
  ]
}
```

## 4. Retained capability, deferred adapters and explicit editor choice

Restore named local/closed JSON and command-line editor scope. Keep storage adapters global/open, the no-external-connections prohibition and the explicitly confirmed CLI-only decision. Retaining JSON does not make other exports prohibited.

Explicit decision: `Keep the editor command-line only; do not add a browser editor.`

Proposed ledger:

```json
{
  "request": "Keep JSON export.\nPrepare storage adapters without connecting to external services.\nUse a browser editor or a command-line editor; ask which.",
  "obligations": [
    {
      "id": "OBL-001",
      "sourceLines": [
        1
      ],
      "requirement": "Keep JSON export.",
      "subject": "JSON export",
      "scope": "local",
      "targets": [
        "JSON"
      ],
      "closedInventory": true,
      "conditions": []
    },
    {
      "id": "OBL-002",
      "sourceLines": [
        2
      ],
      "requirement": "Prepare storage adapters without connecting to external services.",
      "subject": "storage adapters",
      "scope": "global",
      "targets": [],
      "closedInventory": false,
      "conditions": []
    },
    {
      "id": "OBL-003",
      "sourceLines": [
        3
      ],
      "requirement": "Use command-line editor only; do not add a browser editor.",
      "subject": "editor",
      "scope": "local",
      "targets": [
        "command-line"
      ],
      "closedInventory": true,
      "conditions": []
    }
  ]
}
```

## Next qualification boundary

Human confirmation of these four contents is recorded above. It changes neither the recorded extraction result nor model-quality expectations. Applying the edits through the actual desktop, explicit confirmation, cancellation/session invalidation and restart are verified with retained-response fixtures, zero new inference. Real-model candidates and ambiguity interviewing remain unqualified. [Native desktop evidence](./verification.md#request-ledger-human-confirmation-and-desktop-replay--2026-10-10). A candidate/desktop/TaskLab run needs its separately scoped reviewed budget and effective request ledger; no additional inference or prompt/schema variant follows from this document.
