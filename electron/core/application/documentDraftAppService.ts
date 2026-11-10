import { documentDraftRepository } from '../infrastructure/filesystem/documentDraftRepository'
import type { DocumentDraftSnapshot } from '../../../shared/domain/documentDraft'

export const documentDraftAppService = {
  load: () => documentDraftRepository.load(),
  save: (snapshot: DocumentDraftSnapshot) => documentDraftRepository.save(snapshot),
}
