# Renderer React

Il Renderer in `src/` usa React 19, Vite, Tailwind CSS e Monaco. Lo stato è gestito localmente dagli hook React; non usa Zustand.

## Viste

[`AppLayout.tsx`](../src/components/layout/AppLayout.tsx) carica con `React.lazy`:

- [`ChatView.tsx`](../src/components/chat/ChatView.tsx): chat RAG e citazioni;
- [`IngestionView.tsx`](../src/components/ingestion/IngestionView.tsx): import, OCR, Markdown e anteprima;
- [`TranslationView.tsx`](../src/components/translation/TranslationView.tsx): traduzione e diff Monaco;
- [`CodingAgentView.tsx`](../src/components/coding/CodingAgentView.tsx): agent, editor, terminale, piano e timeline;
- [`SettingsView.tsx`](../src/components/settings/SettingsView.tsx): impostazioni, modelli e configurazione;
- diagnostica, About e wizard hardware.

## Hook e servizi

- `useCodingAgent`, `useAgentApprovals`, `useAgentPromptQueue`: esecuzione, conferme e coda del coding agent.
- `useChatEngine`: conversazioni, retrieval, routing di dominio, budget e streaming.
- `useIngestion` e `useTranslation`: flussi Sidecar e progress eventi.
- `useSessionHistory` e `useWorkspaceProjects`: persistenza Main con migrazione one-shot da localStorage.
- `hardwareRecommendationEngine`, `modelIntentClassifier`, `domainRouter`: compatibilità modelli, capacità e routing.
- `chatContextBudget` e `chatContextCompactor`: budget e riduzione della cronologia.

## Componenti tecnici

- `AgentTimeline` usa `@tanstack/react-virtual` per ridurre il costo del rendering dei log.
- `monacoTheme.ts` centralizza tema e opzioni Monaco.
- `errorNormalizer.ts` converte errori tecnici in messaggi e remediation UI.
- Le chiamate al Main passano da `window.electronAPI`; non si accede direttamente a Node o al filesystem.
