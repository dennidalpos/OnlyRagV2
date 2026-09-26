// Setup for the `dom` Vitest project: every renderer test drives React through act(), so React must
// know it runs in an act environment, or it warns on each update that the environment is unsupported.
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
