# Coding history close and interruption recovery

The current `history.json`/`session_history.json` format remains canonical. Before this change, acknowledged saves survived normal close and abrupt Main termination in an isolated Electron restart probe, but a refused save was lost on React unmount/reopen. The user approved a Main-owned recovery journal with Retry/Export for that gap.

## Recovery boundary

- Main retains a versioned, per-session recovery snapshot under `sessions/history-recovery` in app user data. It validates the session identity, workspace owner and digest on every read. The renderer sends each persistable revision immediately, while canonical history writes remain coalesced.
- Main never removes a recovery snapshot until the identical revision is acknowledged in canonical history. A newer snapshot cannot be erased by an older save response. A refused canonical write retains recovery bytes.
- On restart, Main lists retained recovery snapshots separately. The user can explicitly Retry or Export; recovery does not silently replace a readable canonical session. A conflicting canonical revision is refused for manual review. Confirmed session deletion removes only its matching recovery snapshot after the deletion transaction is complete.
- Normal window close waits for pending snapshot acknowledgements. If both Main recovery storage and canonical history are unavailable, the app keeps the view open for Retry or direct export of the snapshots still held in renderer memory. Abrupt termination before Main acknowledges a snapshot remains outside the durability guarantee; power loss requires separate qualification.

Direct memory export uses the validated `sessions:export-snapshot` IPC with the existing session schema and an explicit destination directory. Main writes a separate version-1 JSON envelope containing the normalized session and its SHA-256. A random filename, exclusive creation, file flush and exact readback precede success; this path does not read or write either internal store. Export does not acknowledge canonical history, discard pending revisions or release the close guard. There is no automatic import or retry from the exported file. If a write/readback fails, the UI reports failure; any partial external file is not acknowledged as a recovery copy.

`CODING-HISTORY-DUAL-FAILURE-EXPORT-01` is qualified in an isolated Electron 43.7.4 profile with actual filesystem failures, blocked native close, failed export, exact independent full-session readback and recovery after restoring storage. The harness bundles the production hook and banner into a fixture mounted in the source desktop process; it does not qualify an installed package or a real Windows shutdown. [Executed checks](../verification-2026-10-15.md#esportazione-dalla-memoria-con-doppio-errore-di-archiviazione).

The IPC contract adds stage, list and Retry/Export actions. The recovery file is retained until the identical normalized session has a canonical acknowledgement. An older acknowledgement advances its base digest without removing a newer staged revision. Retry compares the current canonical digest with that base and refuses a changed record.
