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
- Il bundle iniziale non pre-carica Monaco o il tokenizer. L'editor Markdown di Ingestion viene caricato solo quando si apre un documento; Monaco e tokenizer delle altre viste arrivano quando si apre la rispettiva interfaccia.
- Nel Coding Agent la larghezza del pannello sinistro si adatta allo spazio disponibile e lascia visibile l'editor anche a 1024×700.
- `errorNormalizer.ts` converte errori tecnici in messaggi e remediation UI.
- Le chiamate al Main passano da `window.electronAPI`; non si accede direttamente a Node o al filesystem.
- `settings.json` sotto `userData` è la fonte canonica delle impostazioni. Il Renderer importa le vecchie chiavi `localStorage` solo se il file manca; se entrambi esistono deve prevalere il file, poi le chiavi legacy vengono rimosse. Resta aperta la race `SETTINGS-DIAGNOSTICS-RACE-01`, che può sovrascrivere il modello scelto nel file durante l'avvio.
- La RAM di sistema è mostrata con valori distinti per memoria disponibile, in uso e totale sia nella barra laterale sia nella diagnostica; il report copiabile mantiene le stesse etichette.
