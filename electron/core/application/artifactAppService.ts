import type { ArtifactRecord, ArtifactSaveInput } from '../../../shared/types'
import { artifactRepository } from '../infrastructure/filesystem/artifactRepository'

export class ArtifactAppService {
  listArtifacts(workspacePath: string): Promise<ArtifactRecord[]> {
    return artifactRepository.list(workspacePath)
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
