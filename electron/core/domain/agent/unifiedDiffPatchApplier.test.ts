import { describe, it, expect } from 'vitest'
import { UnifiedDiffPatchApplier } from './unifiedDiffPatchApplier'

describe('UnifiedDiffPatchApplier', () => {
  it('should parse unified diff hunks correctly', () => {
    const diff = `@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
 console.log(x);`

    const hunks = UnifiedDiffPatchApplier.parseUnifiedDiff(diff)
    expect(hunks.length).toBe(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].newStart).toBe(1)
  })

  it('should apply patch onto content', () => {
    const content = 'const x = 1;\nconsole.log(x);'
    const diff = `@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;
 console.log(x);`

    const result = UnifiedDiffPatchApplier.applyPatch(content, diff)
    expect(result.success).toBe(true)
    expect(result.updatedContent).toContain('const x = 2;')
  })
})
