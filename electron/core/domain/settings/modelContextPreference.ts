import { MIN_MODEL_CONTEXT_LENGTH } from './appSettingsDomain'

export function resolveModelContextLength(
  model: string,
  preferences: Record<string, number> | undefined,
  hardwareDefault: number,
  trainedContext?: number
): number {
  const hardwareValue = Number.isFinite(hardwareDefault)
    ? Math.max(MIN_MODEL_CONTEXT_LENGTH, Math.floor(hardwareDefault))
    : MIN_MODEL_CONTEXT_LENGTH
  const preferred = preferences?.[model]
  // Without model metadata, an explicitly saved choice is still safe to replay; an unset or
  // unknown model stays at the conservative minimum until Ollama reports its maximum.
  const modelMaximum = trainedContext && Number.isFinite(trainedContext)
    ? Math.max(MIN_MODEL_CONTEXT_LENGTH, Math.floor(trainedContext))
    : Math.max(MIN_MODEL_CONTEXT_LENGTH, preferred ?? MIN_MODEL_CONTEXT_LENGTH)
  const defaultValue = Math.min(hardwareValue, modelMaximum)
  return Math.max(MIN_MODEL_CONTEXT_LENGTH, Math.min(preferred ?? defaultValue, modelMaximum))
}

/** Values exposed by the UI. The final model maximum is always offered as MAX. */
export function getModelContextChoices(modelMaximum?: number): number[] {
  const maximum = Number.isFinite(modelMaximum)
    ? Math.max(MIN_MODEL_CONTEXT_LENGTH, Math.floor(modelMaximum as number))
    : MIN_MODEL_CONTEXT_LENGTH
  const choices: number[] = []
  for (let value = MIN_MODEL_CONTEXT_LENGTH; value <= maximum; value *= 2) choices.push(value)
  if (choices[choices.length - 1] !== maximum) choices.push(maximum)
  return choices
}
