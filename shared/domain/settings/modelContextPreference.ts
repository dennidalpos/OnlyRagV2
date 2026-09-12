export const MIN_MODEL_CONTEXT_LENGTH = 2048

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
  const knownModelMaximum = trainedContext && Number.isFinite(trainedContext) && trainedContext > 0
    ? Math.floor(trainedContext)
    : undefined
  // Known model limits win over the generic floor: Ollama must receive a value the model supports.
  const modelMaximum = knownModelMaximum ?? hardwareValue
  const modelMinimum = knownModelMaximum
    ? Math.min(MIN_MODEL_CONTEXT_LENGTH, knownModelMaximum)
    : MIN_MODEL_CONTEXT_LENGTH
  const defaultValue = Math.min(hardwareValue, modelMaximum)
  return Math.max(modelMinimum, Math.min(preferred ?? defaultValue, modelMaximum))
}

/** Values exposed by the UI. The final model maximum is always offered as MAX. */
export function getModelContextChoices(modelMaximum?: number): number[] {
  const knownMaximum = Number.isFinite(modelMaximum) && (modelMaximum as number) > 0
    ? Math.floor(modelMaximum as number)
    : undefined
  const minimum = knownMaximum ? Math.min(MIN_MODEL_CONTEXT_LENGTH, knownMaximum) : MIN_MODEL_CONTEXT_LENGTH
  const maximum = knownMaximum
    ? knownMaximum
    : MIN_MODEL_CONTEXT_LENGTH
  const choices: number[] = []
  for (let value = minimum; value <= maximum; value *= 2) choices.push(value)
  if (choices[choices.length - 1] !== maximum) choices.push(maximum)
  return choices
}
