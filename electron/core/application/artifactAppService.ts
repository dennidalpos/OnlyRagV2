import type { ArtifactRecord, ArtifactSaveInput } from '../../../shared/types'
import { artifactRepository } from '../infrastructure/filesystem/artifactRepository'
import { electronDesktopShell } from '../infrastructure/electron/electronDesktopShell'

export class ArtifactAppService {
  listArtifacts(workspacePath: string): Promise<ArtifactRecord[]> {
    return artifactRepository.list(workspacePath)
  }

  inspectArtifacts(workspacePath: string) {
    return artifactRepository.inspect(workspacePath)
  }

  rebindArtifacts(workspacePath: string, previousWorkspacePath: string, revision: string) {
    return artifactRepository.rebind(workspacePath, previousWorkspacePath, revision)
  }

  async exportRejectedArtifact(workspacePath: string, artifactId: string): Promise<boolean> {
    const destination = await electronDesktopShell.showSaveDialog({
      title: 'Export original artifact record',
      defaultFileName: `${artifactId}.rejected.json`,
      filters: [{ name: 'Artifact record', extensions: ['json'] }],
    })
    if (!destination) return false
    await artifactRepository.exportRejected(workspacePath, artifactId, destination)
    return true
  }

  getArtifact(workspacePath: string, artifactId: string): Promise<ArtifactRecord | null> {
    return artifactRepository.get(workspacePath, artifactId)
  }

  saveArtifact(workspacePath: string, input: ArtifactSaveInput): Promise<ArtifactRecord> {
    return artifactRepository.save(workspacePath, input)
  }

  deleteArtifact(workspacePath: string, artifactId: string): Promise<boolean> {
    return artifactRepository.delete(workspacePath, artifactId)
  }
}

export const artifactAppService = new ArtifactAppService()
