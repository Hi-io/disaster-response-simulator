# Capacidad humana finita dentro del simulador

Este módulo modela recepción, lectura, integración de una decisión y preparación de una comunicación como eventos causales del motor. Una tarea espera un puesto disponible, ocupa ese puesto durante un tiempo declarado y produce un recibo. No se agrega una penalización retrospectiva a un KPI ni se reduce el rendimiento de un brazo por su nombre.

La atención humana, la inferencia semántica, la autorización del propietario, la comunicación y la ayuda física son etapas distintas. Una lectura completada no descubre automáticamente necesidades ocultas. Una decisión completada no autoriza ni ejecuta una orden. Una preparación de comunicación completada no entrega el mensaje. El motor no razona por el controlador.

## Perfiles y supuestos

`config.humanCapacity` es un objeto validado, incluido en el manifiesto y en la huella del motor. `contracts/human-capacity.mjs` define los perfiles:

| Perfil | Lectura | Integración/decisión | Preparación de relay | Trabajo exógeno por hora, por organización | Errores predeterminados |
|---|---:|---:|---:|---|---:|
| `zero` | 0 ms | 0 ms | 0 ms | Ninguno | 0 |
| `moderate` | 30.000 ms | 60.000 ms | 90.000 ms | Ninguno | 0 |
| `burst` | 30.000 ms | 60.000 ms | 90.000 ms | 360 lecturas, 120 decisiones y 60 preparaciones de relay | 0 |

Cada organización dispone inicialmente de `operatorCount` lectores, `operatorCount` decisores y un relayer. Son grupos independientes de atención: no se supone que representan necesariamente personas distintas. La cola total admite por defecto 10.000 tareas pendientes por organización. Se pueden declarar explícitamente `readers`, `deciders`, `relayers`, `queueLimit`, `readMs`, `decisionMs`, `relayMs`, las tasas de carga de fondo y `readErrorBp`, `decisionErrorBp`, `relayErrorBp`.

Estos valores son supuestos experimentales. No están calibrados con trabajadores de emergencia, no demuestran cuánto tarda una persona real y no deben anunciarse como medición empírica. Una sensibilidad de 1% se declara como `decisionErrorBp:100`, en puntos básicos, para todos los roles humanos de todos los brazos. Los perfiles conservan inicialmente error cero; una cola con mucho trabajo ya puede producir demoras sin inventar errores.

Con el perfil `zero`, sin overrides positivos, la revisión de propuestas conserva la programación anterior de `reviewSlots` y no se inicializa carga humana de fondo. La configuración y huella nuevas sí cambian: esta compatibilidad no significa igualdad de hashes con un binario histórico. Las tareas solicitadas explícitamente con duración cero siguen pasando por eventos y permisos normales.

## Contrato recibido del actor

La API HTTP ordinaria `/api/actor/action` acepta `type:'human_work'` (`O25`). Sólo actores válidos de una organización pueden enviar trabajo. Los roles `agent`, `field`, `dispatcher` y `commander` pueden leer e integrar evidencia recibida. Un observador no posee autoridad de actor.

```json
{
  "type": "human_work",
  "params": {
    "stage": "read",
    "reference": { "kind": "post", "id": "public-source-id", "version": 1 }
  },
  "idempotencyKey": "read-source-version-once"
}
```

`stage` es `read`, `decide` o `relay`. `reference.kind` admite `post`, `need`, `proposal`, `query`, `operation` y `work`. `dependsOn` contiene como máximo 32 IDs únicos de tareas existentes del mismo propietario. Una referencia a `work` todavía pendiente debe incluir esa tarea como dependencia. Para encadenar tareas se omite su versión cuando aún no ha terminado; una versión exacta suministrada debe coincidir.

No se acepta un cuerpo libre, actor, rol, lista de incidentes privados ni una clave aleatoria elegida por el consumidor. El motor resuelve la referencia:

- Un post aporta exclusivamente su contenido público accesible, con la versión y la fecha de publicación.
- Una necesidad u operación aporta el snapshot ya recibido por esa organización, no el estado privado actual del mundo.
- Una propuesta es exclusivamente propia; una query debe ser propia y estar `ready`.
- Una tarea previa aporta exclusivamente su resultado confirmado. Una tarea fallida o inconclusa no da un resultado utilizable al siguiente paso.

La evidencia se copia al recibir la tarea. Una necesidad que crece mientras alguien lee no se actualiza mágicamente en esa lectura. El recibo terminado expone:

```json
{
  "id": "human-opaque-id",
  "org": "org0",
  "stage": "read",
  "state": "completed",
  "version": 3,
  "createdAt": 0,
  "startedAt": 0,
  "completedAt": 30000,
  "workMs": 30000,
  "queueMs": 0,
  "result": {
    "source": { "kind": "post", "id": "public-source-id", "version": 1 },
    "snapshot": { "text": "Contenido público original" },
    "sourceObservedAt": 0
  }
}
```

Los estados posibles son `queued`, `working`, `awaiting_delivery`, `completed`, `inconclusive` y `failed`. Antes de `completed` no se expone el contenido privado de la tarea en `result`. Un `readyAt:null` representa trabajo que aún espera una plaza; no es una promesa de finalización.

`/api/actor/state` incluye `humanCapacity`, `humanWork` y `humanInbox` de la organización autenticada. `query {target:'human_work'}` proporciona la misma información propia mediante cuota, latencia y comunicación de query normales. Consultar otro propietario devuelve 403. Las consultas y polls no consumen un puesto de atención ni vuelven a sortear errores.

## Lectura → decisión → comunicación

Una secuencia ordinaria puede enviar `read(post)`, luego `decide(work:readID, dependsOn:[readID])` y finalmente `relay(work:decideID, dependsOn:[decideID], recipient:'org0')`. Un relay al mismo propietario es rechazado: consumir un salto de red artificial para una lectura local sesgaría la comparación.

El relay ocupa una plaza propia de preparación y después usa `w.send` con conectividad del emisor al transmitir y del receptor al recibir, canal, capacidad de red, tamaño, pérdida, reintento y TTL. `channel` admite `internet`, `radio` o `landline`; `ttlMs` es opcional y no puede superar 24 horas. Un receptor desconectado, un emisor sin conexión o un TTL agotado no generan un recibo ficticio. El fin de la preparación libera el puesto humano, pero la entrega sigue pendiente hasta el mensaje real.

La bandeja `humanInbox` añade `from`, `to`, `receivedAt` y una copia de `source`, `snapshot` y `sourceObservedAt`. Un post sólo puede llegar a un destinatario con permiso para ese contenido. La visibilidad se comprueba nuevamente antes de enviar y al recibir.

Un `commander` o `dispatcher` puede autorizar explícitamente compartir una necesidad recibida, una operación propia o una intención propia:

- Una necesidad actualiza el cache de necesidades del receptor sólo al llegar el mensaje, sin sobrescribir una versión más nueva.
- Una operación se reduce a `id`, `org`, `type`, `need`, `building`, `destination`, `resourceType`, `quantity`, `received`, `state`, versiones y fechas físicas recibidas. Se excluyen IDs de inventario, vehículo, reserva y datos de autorización. Su `shareScope` es `owner_operation`.
- Una intención comparte sólo el estado y versión de la propuesta propia y avisos `dispatch`/`evacuate` con destino, necesidad y cantidad. Se excluyen notas, título privado, inventario, precio, autorización y el resto del plan. Su `shareScope` es `owner_intent`. Una intención puede ser pendiente: no se presenta como una reserva ni una entrega.

El receptor conserva el historial en `humanInbox` y la última versión recibida en `known.peerOperations['owner:sourceID']` o `known.peerIntents['owner:sourceID']`. Una versión anterior entregada tarde no reemplaza una versión más nueva. Compartir información no convierte un recurso ajeno en propio ni da permiso para ejecutar el plan del socio.

## Revisiones humanas de propietarios

Cuando el perfil está activo, `review` usa el mismo grupo finito `decide` que la integración manual. Su trabajo dura `config.reviewMs`; éste es el trabajo de revisión ya existente y no se suma gratuitamente otro `decisionMs` para la misma aprobación. Una decisión manual anterior ocupa capacidad y puede retrasar esa revisión. Las revisiones de NEXO y de los controladores de referencia usan el mismo contrato y dotación.

La revisión conserva propietario, versión de propuesta y huella del plan. Una propuesta cambiada mientras espera no recibe aprobación obsoleta. Un fallo de atención produce un estado explícito inconcluso/clarificación, no autorización automática. Dos solicitudes simultáneas de revisión de una misma propuesta no crean capacidad adicional.

El contrato histórico aún permite órdenes directas de `commander`/`dispatcher`, como acciones explícitas autorizadas de un operador. Por eso los nuevos ensayos comparativos deben usar `propose → review → acción física` en **todos** los brazos. No es válido mandar directamente la orden en un brazo y contabilizar revisión finita en otro. El controlador, no el motor, interpreta datos y decide qué acción propone.

## Colas, errores y reproducibilidad

Los puestos procesan tareas listas en orden de llegada. Una dependencia pendiente mantiene la tarea en cola; una dependencia inconclusa deja el siguiente paso también inconcluso. No se reinicia la cola al hacer un poll ni se desbloquea una plaza de trabajo por un cambio de reloj del evaluador.

La carga de fondo se genera por minuto, organización y etapa, con conteos declarados y un sorteo fraccional por `seed`. El trabajo de relay de fondo ocupa el **grupo relay**, y al terminar no fabrica un mensaje. Son tareas ajenas al incidente, declaradas expresamente para representar carga concurrente. Si alcanzan el límite de cola, el contador `backgroundDropped` registra el rechazo.

La aleatoriedad de atención usa `seed`, propietario, etapa, fuente pública o alcance material de revisión, versión, canal cuando corresponde y ordinal **de esa misma clave**. No usa nombre del brazo, reloj de CPU, `Date.now`, cantidad global de mensajes ni orden de polls. El relay usa además una clave estable propia en el sorteo de pérdida de comunicación. Las comunicaciones históricas conservan su regla previa; no se afirma que dos políticas con distintas órdenes reciban idénticos shocks de comunicación en todo el motor.

Los parámetros de error modelan una atención no confirmada: se devuelve `inconclusive`. No generan afirmaciones falsas ni tergiversan verdad oculta para hacer fallar un brazo. Una orden duplicada o mal asignada debe proceder de decisiones reales del controlador sobre evidencia recibida. Los mismos límites físicos de stock, reservas, peso, asientos, cualificación, calendarios, conductor, rutas y autorización siguen aplicándose.

El checkpoint incluye tareas, puestos, ordinals, snapshots copiados y eventos pendientes. El replay usa los mismos inputs de actor y la misma huella del motor. La regresión verifica igualdad exacta del estado, no sólo igualdad de métricas.

## Medición y censura

`evaluate(world).humanCapacity` expone el perfil, métricas agregadas por etapa y `perOrg` con las mismas métricas y su versión/material clock. Por cada etapa:

- `received`, `completed`, `inconclusive`, `failed`, `queued`, `working` y `awaitingDelivery`.
- `elapsedWorkPersonMs`: integral real de puestos ocupados hasta el corte, sin incluir la espera de red después del trabajo de relay.
- `elapsedQueuePersonMs`: tiempo acumulado de espera de tareas hasta su inicio, fracaso o corte.
- `startedQueueMs.{p50,p95,samples}` y `finishedTurnaroundMs.{p50,p95,samples}`. Los percentiles terminados se publican junto a pendientes.
- `pendingCensored` y `pendingCensoredAt`, más `maximumBacklog` por propietario y agregado.

Son unidades persona-ms de atención y espera, no salarios, productividad, trabajo físico de campo ni vidas salvadas. Una tarea inconclusa no cuenta como interpretación confirmada. Las métricas de ayuda mantienen por separado la primera contribución física, suficiencia, déficit integral, excedentes, censura y conservación.

## Comparación honesta

Seleccionar `humanCapacity.profile:'moderate'` en el visor no convierte la política histórica `conventional` en un operador humano completo. Ese adaptador sigue siendo una referencia algorítmica: aplica sus reglas de muestreo y planificación, y no envía por sí mismo cada etapa `human_work` de lectura, decisión y relay. El perfil sí limita las revisiones de propietario que solicita y admite carga de fondo declarada. Los controladores manuales nuevos envían explícitamente las tareas nativas y esperan sus recibos; el runner de capacidad humana muestra esa experiencia causal. Una demostración 3D de estas colas debe enviar acciones HTTP reales y avanzar el reloj del motor; no crear contadores visuales ficticios.

Los controladores deben conservar recursos, física, fuentes públicas, autoridad, colas de revisión humana y perfiles idénticos. Se distinguen un control manual que usa lectura/integración/relay humanos, una referencia convencional competente que ya automatiza reglas y planificación, un control por extracción simple y la interpretación mediante modelo. El modelo usa su propia latencia recibida/medida; no debe recibir una penalización de lectura humana artificial por cada consulta automática.

Se mantienen error cero, carga cero, lector rápido y coordinación competente como controles. La sensibilidad moderada/burst y a error 1% se declara antes de resultados. Un resultado nulo o adverso permanece en el informe. La reducción de fricción administrativa no equivale por sí sola a mejora incremental de GenAI.

La regresión de duplicación demuestra un mecanismo posible: dos equipos que todavía tienen un snapshot de demanda de 600 L emiten, tras sus revisiones reales, cuatro viajes propios de 300 L antes de recibir las intenciones del socio. El motor entrega 1.200 L reales, contabiliza 600 L útiles y 600 L excedentes, conserva stock y replay. No fuerza ese patrón en los estudios ni demuestra que un controlador competente siempre duplicaría ayuda.

## Evidencia de regresión

`tests/human-capacity.test.mjs` cubre programación legacy zero, cola finita y censura, dependencias, copia antigua de evidencia, reviews compartidas y su fence, privacidad/roles/versiones/cuota, emisor o receptor desconectado, relay con TTL, fondo relay sin mensaje ficticio, HTTP real autenticado, avisos sanitizados e independencia de polls/idempotencia, además de duplicación física con conservación y replay exacto. El informe de integración y la comparación nueva deben sellar la huella actual después de estas modificaciones; los estudios del motor anterior siguen siendo históricos.
