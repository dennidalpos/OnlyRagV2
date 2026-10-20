# Indagine sulle sonde loopback — 20 ottobre 2026

Il [seguito nativo del tracker](./verification-tracker-resume-2026-10-20.md) aggiunge un runner ripetibile con endpoint/listener/PID conservati anche nei successi: 25 casi passati, 421 connessioni osservate, causa storica ancora aperta. La guardia runtime rimane invariata; le prove seguenti conservano i propri percorsi e limiti storici.

`DEVSERVER-LOOPBACK-PROBE-STABILITY-01` resta aperto. Non è stata identificata la causa del rifiuto intermittente conservato dal lotto precedente; nessuna modifica al runtime o alla guardia è giustificata dalle nuove misure.

Su Windows, Node **24.20.0**, 50.000 connessioni isolate a `127.0.0.2` con listener posseduti su `127.0.0.1` hanno prodotto 50.000 rifiuti corretti, nessuna auto-connessione e nessun collegamento inatteso (8,388 s). Le allocazioni erano in gruppi di 50 listener, con dieci sonde per listener e cento gruppi. I listener e i socket di questa prova sono stati chiusi.

Le sonde forzate hanno confermato che una connessione da `127.0.0.2:porta` a se stessa può risultare `ESTABLISHED` anche senza listener. Il controllo esistente la riconosce confrontando indirizzi e porte locali/remoti. Sono conservati endpoint e righe `netstat -ano -p tcp`, incluso il PID posseduto. Le varianti con bind a `127.0.0.1`, wildcard o indirizzo automatico non hanno riprodotto il falso positivo. Queste prove confermano il caso già gestito, senza attribuirgli il precedente fallimento.

La suite TypeScript completa, con diagnostica non soppressa, passa **2.940 test / 322 file** in 186,75 s, incluse le nove prove dev-server: Vite, auto-connessione forzata, singolo successo di readiness, rifiuto dei bind wildcard IPv4/IPv6, porta errata e protezione dei processi estranei. Un ulteriore verde non chiude l'indagine.

Script, ricevute JSON e log sono in `C:/Users/Utente/AppData/Local/Temp/onlyrag-loopback-0e544c2b6c054c138ca52405c2a31b45`: `probe.mjs`, `probe-wildcard.mjs`, `repeat.mjs`, `forced-probes.json`, `wildcard-probes.json`, `repeated-probes.json`, `vitest-diagnostic.log`. Le fixture fallite precedenti rimangono conservate secondo il task di smaltimento; nessun nuovo tentativo di rimozione.

Riferimento API compatibile: [Node 24.20.0, modulo net](https://github.com/nodejs/node/blob/v24.20.0/doc/api/net.md). Restano necessari endpoint/listener/processo della prossima riproduzione del problema originale; non si indeboliscono controlli loopback o proprietà dei processi per nascondere l'intermittenza.
