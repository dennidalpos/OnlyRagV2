export type TDDState = 'INIT' | 'REPRO_TEST_WRITTEN' | 'REPRO_TEST_FAILED' | 'CODE_MUTATED' | 'REPRO_TEST_PASSED'

export interface TDDGateResult {
  allowed: boolean
  currentState: TDDState
  nextState?: TDDState
  reason?: string
  suggestedAction?: string
}

/**
 * Enforces strict TDD / Reproduction-First workflow sequence:
 * 1. Write Reproduction Test -> 2. Run Test (FAIL confirmed) -> 3. Mutate Code -> 4. Run Test (PASS confirmed)
 */
export class TDDReproductionFirstGatekeeper {
  private state: TDDState = 'INIT'
  private reproTestPath?: string

  public get currentState(): TDDState {
    return this.state
  }

  public get testPath(): string | undefined {
    return this.reproTestPath
  }

  /**
   * Registers creation of a reproduction test file.
   */
  public registerReproTest(testPath: string): void {
    this.reproTestPath = testPath
    this.state = 'REPRO_TEST_WRITTEN'
  }

  /**
   * Evaluates proposed tool execution against TDD state rules.
   */
  public validateAction(toolName: string, targetPath?: string, isTestExecution = false, testPassed = false): TDDGateResult {
    // 1. Block code mutations before reproduction test is written and confirmed failing
    if (['write_file', 'replace_file_content', 'multi_replace_file_content'].includes(toolName)) {
      if (targetPath && this.reproTestPath && targetPath === this.reproTestPath) {
        // Modifying the test file itself is permitted
        return { allowed: true, currentState: this.state }
      }

      if (this.state === 'INIT') {
        return {
          allowed: false,
          currentState: this.state,
          reason: 'TDD Violation: Code mutation attempted before creating a reproduction test.',
          suggestedAction: 'Create a minimal failing reproduction test file (e.g. test_repro.spec.ts or repro_test.py) using write_file before modifying source code.',
        }
      }

      if (this.state === 'REPRO_TEST_WRITTEN') {
        return {
          allowed: false,
          currentState: this.state,
          reason: 'TDD Violation: Reproduction test has not been executed to confirm failure.',
          suggestedAction: `Run the reproduction test via run_command to confirm that it FAILS before modifying source code.`,
        }
      }

      // Transition to CODE_MUTATED state when modifying source code after confirmed test failure
      if (this.state === 'REPRO_TEST_FAILED' || this.state === 'CODE_MUTATED') {
        this.state = 'CODE_MUTATED'
        return { allowed: true, currentState: this.state, nextState: 'CODE_MUTATED' }
      }
    }

    // 2. Handle test execution results
    if (isTestExecution) {
      if (this.state === 'REPRO_TEST_WRITTEN' && !testPassed) {
        this.state = 'REPRO_TEST_FAILED'
        return { allowed: true, currentState: this.state, nextState: 'REPRO_TEST_FAILED' }
      }

      if (this.state === 'CODE_MUTATED' && testPassed) {
        this.state = 'REPRO_TEST_PASSED'
        return { allowed: true, currentState: this.state, nextState: 'REPRO_TEST_PASSED' }
      }
    }

    // 3. Block finish tool if TDD workflow is incomplete
    if (toolName === 'finish' && this.state !== 'REPRO_TEST_PASSED' && this.reproTestPath) {
      return {
        allowed: false,
        currentState: this.state,
        reason: 'TDD Closure Violation: Reproduction test has not been verified PASSing after code changes.',
        suggestedAction: `Execute your reproduction test (${this.reproTestPath}) via run_command to confirm transition from FAIL -> PASS before finishing.`,
      }
    }

    return { allowed: true, currentState: this.state }
  }

  public reset(): void {
    this.state = 'INIT'
    this.reproTestPath = undefined
  }
}
