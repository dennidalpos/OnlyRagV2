# Verifica e limiti noti

## Ordine rapido

```powershell
npm run docs:check
npm run test:fast
```

Se fallisce il test rapido, usare il target indicato:

```powershell
npx vitest run <path>
```

Per il Sidecar: `npm run test:sidecar`. Per tipi e confini: `npm run typecheck` e `npm run audit:cycles`.

## Verifiche native

- `npm run test:smoke` controlla l'avvio del bundle Electron e la registrazione IPC.
- `npm run test:live` usa Ollama reale e workspace isolati; richiede il runtime locale e non fa parte del test rapido.
- I test live qualificano uno scenario e un modello specifici: non implicano autonomia generale del coding agent.

## Limiti da non nascondere

- Il fallback testuale dei tool e `/api/generate` restano compatibilità per modelli che non emettono `tool_calls`.
- L'offload CPU può aumentare la latenza per modelli oltre la VRAM disponibile.
- Le prove su Ollama dipendono da versione, modelli installati, hardware e stato del daemon.
- Una verifica non disponibile non equivale a una verifica superata; il sistema conserva esiti distinti.

Per i contratti da verificare consultare [`api-ipc.md`](./api-ipc.md), [`api-rest.md`](./api-rest.md) e [`PROJECT_STATUS.json`](../PROJECT_STATUS.json).
