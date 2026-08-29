/**
 * Backward-compatible renderer entry point for the process-neutral contracts.
 *
 * The canonical definitions live in `shared/types`, which may be consumed by
 * both the renderer and Electron without crossing a process-layer boundary.
 */
export * from '../../shared/types'
