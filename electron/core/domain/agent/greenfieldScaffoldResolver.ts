import type { UserInterviewAnswer } from '../../../../shared/types'
import type { WorkspaceScaffoldFacts } from '../../../../shared/domain/agent/planCompilation'

export interface GreenfieldScaffoldResolution {
  acceptedStack: string | null
  scaffold: WorkspaceScaffoldFacts
  proposedVerificationCommands: string[]
}

const matches = (text: string, pattern: RegExp) => pattern.test(text)

/** Resolves only stack choices stated by the user or accepted during the interview. */
export function resolveGreenfieldScaffold(
  isGreenfield: boolean,
  prompt: string,
  decisions: readonly UserInterviewAnswer[] = []
): GreenfieldScaffoldResolution {
  const confirmedDecisions = decisions.filter((item) => item.provenance !== 'unconfirmed_assumption')
  const text = [prompt, ...confirmedDecisions.map((item) => item.selectedOption)].join(' ').toLowerCase()
  if (!isGreenfield) return { acceptedStack: null, scaffold: { isGreenfield: false, requirements: [] }, proposedVerificationCommands: [] }

  const python = matches(text, /\b(python|fastapi|flask|django|pytest)\b/)
  const rust = matches(text, /\b(rust|cargo|actix|axum)\b/)
  const react = matches(text, /\breact(?:\.js)?\b/)
  const vite = matches(text, /\bvite\b/)
  const web = react || vite || matches(text, /\b(web|website|frontend|front-end|browser|spa|sito|pagina web)\b/)
  const typescript = matches(text, /\b(typescript|tsx)\b/)
  const javascript = matches(text, /\b(javascript|node(?:\.js)?|jsx)\b/)

  if (python) {
    const proposed = 'python -m compileall src'
    return {
      acceptedStack: 'python',
      proposedVerificationCommands: [proposed],
      scaffold: {
        isGreenfield: true,
        requirements: [
          { path: 'pyproject.toml', title: 'The project declares its Python package and dependencies', proposedVerificationCommand: proposed },
          { path: 'src/main.py', title: 'The Python application has a minimal entry module' },
        ],
      },
    }
  }

  if (rust) {
    const proposed = 'cargo check'
    return {
      acceptedStack: 'rust',
      proposedVerificationCommands: [proposed],
      scaffold: {
        isGreenfield: true,
        requirements: [
          { path: 'Cargo.toml', title: 'The project declares its Rust package and dependencies', proposedVerificationCommand: proposed },
          { path: 'src/main.rs', title: 'The Rust application has a minimal entry module' },
        ],
      },
    }
  }

  if (web) {
    if (!react && !vite && !typescript && !javascript) {
      return {
        acceptedStack: 'web-static',
        proposedVerificationCommands: [],
        scaffold: { isGreenfield: true, requirements: [{ path: 'index.html', title: 'The static web application has a root page' }] },
      }
    }

    const extension = react ? (typescript ? 'tsx' : 'jsx') : (typescript ? 'ts' : 'js')
    const proposed = 'npm run build'
    const requirements = [
      { path: 'package.json', title: 'The project declares its accepted web stack and terminating build script', proposedVerificationCommand: proposed },
      ...(typescript ? [{ path: 'tsconfig.json', title: 'TypeScript checks source without emitting build artifacts' }] : []),
      { path: 'index.html', title: 'The web application has a root entry page' },
      { path: `src/main.${extension}`, title: 'The entry module mounts or starts the web application' },
    ]
    return {
      acceptedStack: [react ? 'react' : 'web', typescript ? 'typescript' : 'javascript'].join('-'),
      proposedVerificationCommands: [proposed],
      scaffold: { isGreenfield: true, requirements },
    }
  }

  if (typescript || javascript) {
    const proposed = typescript ? 'npm run typecheck' : 'node --check src/index.js'
    return {
      acceptedStack: typescript ? 'node-typescript' : 'node-javascript',
      proposedVerificationCommands: [proposed],
      scaffold: {
        isGreenfield: true,
        requirements: [
          { path: 'package.json', title: 'The project declares its Node.js package and scripts', proposedVerificationCommand: proposed },
          ...(typescript ? [{ path: 'tsconfig.json', title: 'TypeScript checks the Node.js source' }] : []),
          { path: typescript ? 'src/index.ts' : 'src/index.js', title: 'The Node.js application has a minimal entry module' },
        ],
      },
    }
  }

  return { acceptedStack: null, scaffold: { isGreenfield: true, requirements: [] }, proposedVerificationCommands: [] }
}
