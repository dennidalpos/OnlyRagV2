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

- `useCodingAgent` compone gli hook in [`hooks/codingAgent/`](../src/hooks/codingAgent/): `useAgentActionLog` (timeline), `useCodingAgentExecution` (run, eventi IPC legati all'identità della run, coda, conferme), `useCodingAgentSession` (cambio, creazione ed eliminazione delle conversazioni, persistenza), `useCodingAgentAttachments` (documenti RAG allegati) e `useCodingAgentTerminal`. L'effetto IPC legge lo stato corrente tramite ref, quindi un prompt avviato dalla coda usa modalità, conversazione, editor e allegati aggiornati. `CodingAgentLeftPanel` e `CodingEditorContent` ricevono solo i campi dichiarati nei loro tipi `…Model`.
- `useChatEngine`: conversazioni, retrieval, routing di dominio, budget e streaming.
- `useIngestion` e `useTranslation`: flussi Sidecar e progress eventi. `useDocumentTranslation` (Markdown) e `useInplaceTranslation` (PDF/DOCX con layout) condividono documento, lingue, lock tra moduli e risoluzione di modello/contesto/thinking; senza modello di traduzione o predefinito la traduzione Markdown mostra un errore invece di usare un modello di ripiego.
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
- `settings.json` sotto `userData` è la fonte canonica delle impostazioni. Il Renderer importa le vecchie chiavi `localStorage` solo se il file manca; se entrambi esistono prevale il file, poi le chiavi legacy vengono rimosse. La diagnostica parte dopo il caricamento; la scelta automatica di un modello si applica solo se `defaultModel` è ancora vuoto. Se `settings:get` fallisce (per esempio `settings.json` illeggibile o con versione non supportata) `AppLayout` mostra un avviso con «Riprova»: finché il caricamento non riesce non salva, non migra le chiavi legacy, non apre il wizard e non avvia la diagnostica automatica, quindi il file resta intatto. Main legge le impostazioni per uso interno con fallback ai valori predefiniti.
- La RAM di sistema è mostrata con valori distinti per memoria disponibile, in uso e totale sia nella barra laterale sia nella diagnostica; il report copiabile mantiene le stesse etichette.
