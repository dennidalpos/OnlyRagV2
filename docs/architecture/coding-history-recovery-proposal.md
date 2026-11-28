# Coding history close and interruption recovery

Historical approved recovery boundary, implemented and qualified in the dated evidence below. Current usage is in [Coding Agent](../coding-agent.md) and [Main](../electron-main.md); this proposal does not create a new implementation or qualification task.


The current `history.json`/`session_history.json` format remains canonical.



Contenuto datato trasferito nel dossier SecondBrain: `02-areas/products/OnlyRagV2/history/imported/docs/architecture/coding-history-recovery-proposal.md`. Originale e SHA-256 nel rapporto di migrazione; questa voce conserva i riferimenti esistenti e non autorizza nuovi interventi.

## Recovery boundary

- Main retains a versioned, per-session recovery snapshot under `sessions/history-recovery` in app user data. It validates the session identity, workspace owner and digest on every read. The renderer sends each persistable revision immediately, while canonical history writes remain coalesced.
- Main never removes a recovery snapshot until the identical revision is acknowledged in canonical history. A newer snapshot cannot be erased by an older save response. A refused canonical write retains recovery bytes.
- On restart, Main lists retained recovery snapshots separately. The user can explicitly Retry or Export; recovery does not silently replace a readable canonical session. A conflicting canonical revision is refused for manual review. Confirmed session deletion removes only its matching recovery snapshot after the deletion transaction is complete.
- Normal window close waits for pending snapshot acknowledgements. If both Main recovery storage and canonical history are unavailable, the app keeps the view open for Retry or direct export of the snapshots still held in renderer memory. Abrupt termination before Main acknowledges a snapshot remains outside the durability guarantee; power loss requires separate qualification.

Direct memory export uses the validated `sessions:export-snapshot` IPC with the existing session schema and an explicit destination directory. Main writes a separate version-1 JSON envelope containing the normalized session and its SHA-256. A random filename, exclusive creation, file flush and exact readback precede success; this path does not read or write either internal store. Export does not acknowledge canonical history, discard pending revisions or release the close guard. There is no automatic import or retry from the exported file. If a write/readback fails, the UI reports failure; any partial external file is not acknowledged as a recovery copy.


The IPC contract adds stage, list and Retry/Export actions. The recovery file is retained until the identical normalized session has a canonical acknowledgement. An older acknowledgement advances its base digest without removing a newer staged revision. Retry compares the current canonical digest with that base and refuses a changed record.
