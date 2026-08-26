import { MIN_MODEL_CONTEXT_LENGTH } from './appSettingsDomain'

export function resolveModelContextLength(
  model: string,
  preferences: Record<string, number> | undefined,
  hardwareContext: number,
  trainedContext?: number
): number {
  const ceiling = trainedContext && trainedContext >= MIN_MODEL_CONTEXT_LENGTH
    ? Math.min(hardwareContext, trainedContext)
    : hardwareContext
  const preferred = preferences?.[model]
  return Math.max(MIN_MODEL_CONTEXT_LENGTH, Math.min(preferred ?? ceiling, ceiling))
}
