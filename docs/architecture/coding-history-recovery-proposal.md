# Coding history close and interruption recovery

The current `history.json`/`session_history.json` format remains canonical. Before this change, acknowledged saves survived normal close and abrupt Main termination in an isolated Electron restart probe, but a refused save was lost on React unmount/reopen. The user approved a Main-owned recovery journal with Retry/Export for that gap.

## Recovery boundary

- Main retains a versioned, per-session recovery snapshot under `sessions/history-recovery` in app user data. It validates the session identity, workspace owner and digest on every read. The renderer sends each persistable revision immediately, while canonical history writes remain coalesced.
- Main never removes a recovery snapshot until the identical revision is acknowledged in canonical history. A newer snapshot cannot be erased by an older save response. A refused canonical write retains recovery bytes.
- On restart, Main lists retained recovery snapshots separately. The user can explicitly Retry or Export; recovery does not silently replace a readable canonical session. A conflicting canonical revision is refused for manual review. Confirmed session deletion removes only its matching recovery snapshot after the deletion transaction is complete.
- Normal window close waits for pending snapshot acknowledgements. If both Main recovery storage and canonical history are unavailable, the app keeps the view open for Retry. Export is available for a snapshot already retained in Main. Abrupt termination before Main acknowledges a snapshot remains outside the durability guarantee; power loss requires separate qualification.

Direct export of a snapshot still held only in renderer memory after both writes fail remains open as `CODING-HISTORY-DUAL-FAILURE-EXPORT-01`.

The IPC contract adds stage, list and Retry/Export actions. The recovery file is retained until the identical normalized session has a canonical acknowledgement. An older acknowledgement advances its base digest without removing a newer staged revision. Retry compares the current canonical digest with that base and refuses a changed record.
