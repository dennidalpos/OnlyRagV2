import { chatHistoryRepository } from '../infrastructure/filesystem/chatHistoryRepository'
import type { ChatHistoryRecovery } from '../../../shared/domain/chatHistory'

export const chatHistoryRecoveryAppService = {
  load: () => chatHistoryRepository.load(),
  save: (snapshot: ChatHistoryRecovery) => chatHistoryRepository.save(snapshot),
}
