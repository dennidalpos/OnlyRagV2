export function createFixtureDirectory(prefix: string): string
export function assertOwnedFixture(directory: string): { directory: string; manifestPath: string; manifest: Record<string, unknown> }
export function retainFixture(directory: string): void
