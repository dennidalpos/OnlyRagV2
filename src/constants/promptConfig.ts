// Re-export the prompt Domain layer for renderer consumers, keeping the single source of truth in
// electron/core/domain/agent/ (same cross-layer convention as the retired promptPresets barrel).
export * from '../../electron/core/domain/agent/promptPresets'
export * from '../../electron/core/domain/agent/promptHierarchyRegistry'
export * from '../../electron/core/domain/agent/promptCompiler'
export * from '../../electron/core/domain/agent/promptTemplateValidator'
