/** The summary a session gets when it never produced a valid tool call again. */
export function rejectionAbortSummary(toolName: string, rejectionStreak: number): string {
  return (
    `Sessione interrotta: ${rejectionStreak} chiamate consecutive a "${toolName}" sono state rifiutate dalla validazione dei parametri ` +
    `e nessuna e' mai stata eseguita. Il contratto del tool e' stato inviato al modello a ogni tentativo. ` +
    `Nessuna modifica e' stata persa: i file scritti prima di questa serie restano sul disco.`
  )
}
