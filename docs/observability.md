# Osservabilità e diagnosi

Questo documento è la fonte canonica per log, segnali diagnostici, limiti e lacune di osservabilità.
I dati locali non devono contenere prompt, contenuti documentali, token, credenziali o messaggi di
eccezione non sanitizzati.

## Eventi e gestione errori

- Il logger Electron mantiene gli ultimi 1000 eventi in memoria e ruota `app.log` a 2 MiB,
  conservando due generazioni (`app.1.log`, `app.2.log`).
- Il global error handler REST mantiene HTTP 500, restituisce solo `detail` generico e `error_id`,
  e registra un JSON con `event`, `error_id`, metodo, path e tipo di eccezione. Il messaggio e lo
  stack dell'eccezione non vengono esposti.
- Gli errori importanti sono rilevabili dal campo `event=unhandled_exception`, dall'HTTP 500 e dal
  relativo `error_id`; il supporto deve chiedere questo identificatore, non il contenuto locale.
- Il log analyzer considera una finestra di 30 righe e segnala un tool ripetuto almeno 3 volte;
  riconosce inoltre OOM/VRAM, timeout, risposte vuote, circuit breaker e permessi filesystem.

## Percorsi critici e soglie

| Percorso | Timeout/limite | Segnale |
| --- | ---: | --- |
| Health Ollama dal diagnostico Electron | 4500 ms | errore `Ollama` con stato offline |
| Health sidecar dal supervisor | 3000 ms | errore `Sidecar` e retry |
| Cache rilevamento GPU | 30 s | snapshot riutilizzato senza nuovo processo |
| Richiesta sidecar SLM | 120 s | errore `SidecarSlmBridge` |
| Comando terminale | 5 s minimo, 900 s massimo | timeout e codice non-zero |
| Sessione agente | 45 min | evento `[SESSION TIMEOUT]` |

## Metriche e lacune note

Sono già disponibili metriche di dominio (documenti/chunk indicizzati, conteggio modelli, file e
linee cambiate). Non è ancora disponibile un contatore centralizzato per richieste HTTP, latenza,
errori per endpoint o correlazione distribuita tra renderer, Electron e sidecar. Il follow-up deve
aggiungere queste metriche con cardinalità limitata a endpoint, status e tipo di errore, senza URL
completi, query, percorsi locali o identificativi utente.

