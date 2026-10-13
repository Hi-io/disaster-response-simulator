# NEXO — Auditoría del simulador existente y brechas de evaluación

Fecha: 12 de octubre de 2026. Repositorio inspeccionado: `disaster-response-simulator`, commit `6980dda` (`Make simulated social reports varied and preserve authentic source identities`). Es una revisión de código, contratos y pruebas; no una certificación de realismo ni una prueba del futuro NEXO.

Relacionado: [especificación integral de la plataforma](PLATAFORMA.md), especialmente KPIs K01–K30, tests T01–T27 y puertas de salida; [diseño original del laboratorio](SIMULADOR.md).

## 1. Veredicto

**El simulador tiene una base suficiente y muy aprovechable para comenzar a desarrollar e integrar NEXO. Todavía no tiene todo lo necesario para demostrar de forma concluyente todas las capacidades e hipótesis del producto.**

No hace falta rehacer el mundo ni aumentar el detalle gráfico. Los pendientes principales son calidad de evaluación, baselines competentes, medición completa, algunas fronteras de integración y validación externa. El laboratorio no tiene que resolver C1–C7: debe permitir que NEXO los resuelva, imponer consecuencias y medirlos independientemente.

Un servicio compuesto ejecutable en un test con acciones escritas a mano prueba que el mundo permite ese servicio. No prueba que un agente haya descubierto la combinación a partir de información desorganizada.

## 2. Qué se revisó y qué se ejecutó

Lectura: README, API, COVERAGE, CALIBRATION, PERFORMANCE, SCENARIOS, contratos de entrada/acción, catálogo de escenarios, gateway, controladores de referencia, métricas/comparaciones, cooperación, operaciones, mecanismos de personal e integración externa y pruebas relevantes.

Comandos ejecutados en esta revisión:

- `pnpm test`: **108/108 tests correctos**, cero fallidos, cancelados, omitidos o pendientes. Duración reportada por el runner aproximadamente 3,68 s; no es un benchmark operativo.
- `pnpm check`: **62 módulos JavaScript**, **26 entradas**, **23 acciones**, **360 presets**, higiene de repositorio correcta.
- Sonda mínima de `World` + `evaluate` al tiempo cero: reproduce el problema de plazos descrito en A01.

No se ejecutó Gemini, no se midió ventaja de NEXO, no se repitió el benchmark de un millón de publicaciones y no se realizó una nueva auditoría visual del navegador. Las comprobaciones de view-model existentes pasaron; no equivalen a pruebas con usuarios.

El primer intento de ejecutar la suite mediante `npm` encontró que ese comando no estaba disponible. Se usó el gestor declarado por el repositorio, `pnpm`, y la suite terminó correctamente. No se cambiaron implementaciones ni tests durante esta auditoría.

## 3. Capacidades ya presentes

| Área | Evidencia inspeccionada | Qué permite afirmar |
|---|---|---|
| Motor determinista y replay | `engine/determinism.mjs`, `evaluation/runs.mjs`, core/world/archive tests | Mismo build/configuración/entradas puede reproducir el mundo; nuevas respuestas LLM no quedan fijadas por seed |
| Mundo regional y tráfico | `engine/traffic.mjs`, region/world/tasks tests | Distancias, cruces escasos, capacidad, cola, combustible y viajes tienen consecuencias |
| Recursos y compromisos | `engine/ledger.mjs`, `engine/cooperation.mjs` | Propiedad, reservas, condiciones, TTL, préstamos y liberación son comprobables |
| Instalaciones compuestas | `engine/facilities.mjs`, `tests/laboratory.test.mjs` | Agua/saneamiento/energía/personal/inspección pueden habilitar un servicio real del modelo |
| Ejecución física | `engine/operations.mjs`, `engine/tasks.mjs` | Orden, carga, viaje, llegada, recepción, instalación y servicio se distinguen |
| Desastres y comunicación | `engine/communications.mjs`, escenarios y tests | Cambios de acceso, réplicas, fuego/inundación, pérdida de red y órdenes tardías |
| Fuentes consultables | `sources/server.mjs`, `adapters/client.mjs` | HTML scrapeable, APIs, versiones, medios descritos, cuotas y permisos; descarga HTTP real |
| Separación de perspectivas | Gateway de organización, server/viewer tests | Verdad oculta, publicado y recibido no son el mismo estado |
| Tiempo humano | `engine/operations.mjs`, `engine/laboratory.mjs` | Slots/turnos y demora finitos; agente no tiene por defecto autoridad humana |
| Relojes externos | `tests/integration-clock.test.mjs` | Live, modeled y replay registran latencia externa y barreras |
| Evaluación y ejecución headless | `evaluation/metrics.mjs`, `evaluation/batch.mjs` | Métricas físicas, semillas emparejadas, trabajadores limitados, presupuestos y artefactos |
| Finanzas/público sandbox | extensions/tasks tests | Promesa/liquidación/compra/recepción/publicación pueden distinguirse |
| Casos y contenido | `scenarios/catalog.mjs`, social/world tests | 24 fixtures, 360 presets y 102 redacciones contextuales bilingües según README; no 462 desastres independientes |

## 4. Backlog de brechas con prioridad y criterio de cierre

P0: invalida una medición/aislamiento necesario antes de usarla como evidencia. P1: necesario para una evaluación competitiva completa. P2: ampliar solo cuando el claim lo necesite. Estas prioridades no significan que el motor actual sea inútil o que todo deba implementarse dentro del simulador.

### A01 — P0 · Un plazo futuro se cuenta como incumplido

**Confirmado por código y reproducción.** `evaluation/metrics.mjs`, función `subgroups`, incrementa `missedDeadline` si `completedAt === null` sin comprobar si el plazo ya venció.

Sonda ejecutada, sin avanzar el mundo:

    World({grid:3, extentKm:2, durationMs:3600000, policy:'none', postsPerHour:0})
    now = 0
    need.deadline = 10800000
    subgroups.silent.false.water.missedDeadline = 1

Una necesidad con tres horas por delante aparece como tardía al inicio. No usar ese agregado para comparar equidad o cumplimiento mientras siga así.

**Corrección requerida:** distinguir pendiente dentro de plazo, vencida, completada a tiempo, completada tarde y censurada al horizonte. Tests antes/exactamente/después del plazo, final anterior al plazo y entrega parcial. Precisar si el instante del vencimiento es inclusivo. Mantener denominadores elegibles iguales entre brazos.

### A02 — P1 · La latencia disponible no representa todo el tiempo hasta ayudar

`evaluate` calcula varias latencias como `op.times[stage] - op.createdAt`. Es una medida válida de operación, pero no del tiempo desde aparición de la necesidad, primera señal, detección o decisión. `perCommunity` contiene algunas fechas y permite ampliar instrumentación; no está todo el embudo calculado.

**Cierre:** instrumentar tiempos de necesidad física, fuente disponible, descarga, interpretación validada, propuesta, revisión, autorización, orden/acuse, recepción y servicio sostenido. KPI K02 incluye no atendidos y censura. Test pequeño calculado a mano. No llamar «tiempo de respuesta total» a la latencia desde creación de una operación.

### A03 — P1 · Las referencias actuales no son competidores suficientemente fuertes

`adapters/reference.mjs` filtra las necesidades a `n.type === 'water'`, utiliza selección heurística y autoriza de forma programada las propuestas. La variante convencional consulta menos publicaciones y a un intervalo más lento. Esto puede servir como control de desarrollo, pero esas diferencias no están calibradas como comportamiento de profesionales.

**Cierre:** B0–B3 de PLATAFORMA: política operacional revisada, reglas/optimizador competente, Gemini extracción + planificador y agente general real con mismos modelos/herramientas/presupuestos. Ampliar a refugios, composición, replanificación y restricciones conjuntas. Registrar cuándo gana la referencia.

**Equidad del transporte de datos:** los controladores internos llaman `publicFeed` directamente y registran ingesta; el candidato externo hará HTTP/scraping. Pasar referencias por el mismo gateway o cargar los mismos retrasos, cuotas y disponibilidad de forma explícita. No confundir una asimetría del harness con una ventaja del producto.

### A04 — P1 · No existe aquí una prueba de NEXO con Gemini

El repositorio lo declara correctamente: ejecuta el mundo y acepta acciones de una plataforma externa; no realiza inferencia. Los nombres `general`, `investigation` o `federated` de políticas scripted no acreditan agentes GenAI.

**Cierre:** construir el adaptador real de NEXO, registrar solicitudes/respuestas, herramientas y decisiones; completar S01/S02/S19 y fallos adversos mediante el gateway. Comparar live ×1 y modeled calibrado por separado. Una animación que lee acciones programadas no cierra esta brecha.

### A05 — P1 · Falta formalizar el recorrido de autorización humana externa

`sources/server.mjs` genera por defecto credenciales por organización con rol `agent`. La acción humana del visor usa autoridad de observador para efectuar una acción como comandante. Existe la opción `actorKeys` que permite inyectar identidades/roles; por tanto, el modelo de roles sí puede soportar la solución, pero el onboarding estándar no entrega un recorrido de operador NEXO con credenciales limitadas documentado y probado de extremo a extremo.

**Cierre:** provisionar sesiones humanas por organización/rol mediante un broker local de confianza o mecanismo equivalente; mantener al agente separado. La UI NEXO debe poder autorizar sin conocer la clave omnisciente ni recibir la verdad del mundo. Probar revocación, caducidad, autoridad insuficiente y cambio de versión. No resolverlo otorgando rol comandante al agente.

### A06 — P1 · Los medios no prueban percepción multimodal

Las imágenes, videos y audios contienen tipo, descripción y metadatos sintéticos. Esto prueba interpretación de texto que describe un medio. No prueba lectura de una foto, reconocimiento de una situación en video, OCR o transcripción en ruido.

**Cierre:** suite de medios reales autorizados/creados para prueba con anotaciones independientes, ligada a casos mediante un adaptador. Variar caption versus contenido, fecha desconocida, ubicación ambigua, ruido y lenguas. El mundo ligero puede seguir usando referencias/descripciones para batch; publicar resultados multimodales por separado.

### A07 — P0 para evaluación final · Holdout no independiente ni sellado

La separación por variante dentro de familias no elimina acceso a plantillas o recetas. `scenarios/catalog.mjs` contiene ejemplos deliberadamente explícitos; S01 incluye datos útiles de capacidad, retorno y necesidad de permiso. Son buenos tests funcionales, insuficientes para demostrar descubrimiento de relaciones no entregadas de antemano.

**Cierre:** conjunto nuevo con autoría independiente, combinaciones nuevas y fuentes menos preparadas, además de variantes contrafactuales. Ejecutar evaluator en proceso/entorno aislado sin montar repo privado o etiquetas en NEXO. Guardar fingerprints y sellar antes del ajuste final. No usar IDs diagnósticos como pistas accesibles al candidato.

### A08 — P1 · «Interpretado» sigue siendo una declaración del consumidor

`downloaded/accepted/interpreted/discarded` son recibos enviados por plataforma. El cliente descarga realmente por HTTP; marcar interpretado no acredita que la interpretación sea correcta ni que conduzca a una decisión útil.

**Cierre:** evaluación de afirmaciones/necesidades sobre ground truth independiente, métricas por entidad y relevancia, evidencia recuperable y enlace a propuesta/resultado. Mantener separados volumen descargado, texto resumido, interpretación correcta y ayuda efectiva. No premiar aceptar todos los posts.

### A09 — P1 · Métricas de información necesitan semántica más fina

`evaluateInformation` cuenta determinadas falsas confirmaciones/rechazos/merges según etiquetas de posts. Es una base útil, pero una afirmación puede citar una fuente falsa para refutarla; «referencia a post falso» no define por sí sola la falsedad de la afirmación. Diferenciar afirmación, evidencia favorable/contraria y necesidad vigente.

**Cierre:** etiquetas a nivel de afirmación/tarea con relación semántica y anotación independiente; precisión/recall por necesidad y por gravedad. Pruebas de viejo video + necesidad real, desmentido que cita rumor y varias necesidades en un solo documento. No anunciar accuracy global a partir de esos contadores actuales.

### A10 — P1 · Coste real del modelo y presupuesto incompletos

`evaluation/metrics.mjs` conserva tokens/tiempos declarados y devuelve `modelUsage.providerCost: null`. `toolCost` es el coste modelado del mundo, no una factura del proveedor ni tiempo humano real.

**Cierre:** incorporar recibos reales de uso/precio versionado de Gemini, fallos/reintentos/caché y costes de herramientas/infraestructura. Separar coste monetario, tiempo humano y créditos ficticios. K25 necesita costo por episodio y por servicio útil, no solo por llamada.

### A11 — P1 · Falta instrumentación completa de innovación y reparación

Hay estado de propuestas, dependencias, instalaciones y contadores. Falta una batería final que calcule, entre otras cosas, ventaja sobre agente general, valor de investigar, proporción de servicios compuestos realmente utilizados, trabajo válido preservado y daño desplazado a otros casos.

**Cierre:** instrumentar K04/K07/K14–K18, enlazar IDs de hipótesis/consultas/propuesta/compromiso/operación/servicio y exportar cálculos verificables. Un `requiresRepair` no demuestra que el candidato encontró una buena reparación.

### A12 — P1 · La capacidad humana está modelada, la comprensión no

Slots y turnos finitos sí existen. La revisión usa un tiempo configurado y los controladores pueden aprobar programáticamente. Esto no reproduce comprensión, fatiga, dificultad de una propuesta, interrupciones ni errores de una persona ante una UI.

**Cierre:** pruebas con operadores, medición real de revisión/errores y calibración del modelo de colas/latencias según complejidad. Incluir rechazo, aclaración y cambios. La UI de NEXO se evalúa aparte; la UI del observador no sustituye la del coordinador ni la del público.

### A13 — P1 · Realismo operativo y sanitario sin validar externamente

CALIBRATION documenta correctamente supuestos: profesionales genéricos, inspección simplificada, riesgos de salud experimentales y geografía procedural. No reproduce todos los permisos, competencias, cadenas de frío, procedimientos de almacén, movilidad reducida o flujos hospitalarios.

**Cierre:** especialistas revisan los parámetros relevantes para los claims iniciales. Añadir competencia, caducidad, capacidad de recepción, accesibilidad u otra restricción si cambia una decisión que se anunciará. No añadir física irrelevante. Evaluar resultados sin mortalidad y con rangos de sensibilidad; no convertir bajas simuladas en vidas reales salvadas.

### A14 — P1 · Una red dentro de un mundo no valida una red de procesos

La cooperación modela condiciones y permisos, pero el mundo tiene un estado único determinista. No acredita por sí solo el comportamiento de cuatro instancias NEXO reales con bases/colas, reinicios, mensajes duplicados o interrupción después de un commit.

**Cierre:** pruebas de integración de varias instancias/proyecciones aisladas con transporte real, outbox, idempotencia, revocación, lease y recuperación. Mantener al laboratorio como dueño de consecuencias físicas. Probar ciclos de compromisos y aceptación parcial en la lógica de NEXO; el simulador no necesita inventar su algoritmo.

### A15 — P1 · Comparaciones necesitan una capa metodológica más estricta

`pairedComparison` empareja semilla/escenario/variante, comprueba parámetros/build y genera intervalos bootstrap. Es útil. El comparador excluye `mode` al construir el fingerprint comparable, además de policy/logMode; por eso debe haber un gate metodológico explícito que impida mezclar relojes/evidencias incompatibles aunque otros campos coincidan.

El nombre `perCommunity` contiene filas por necesidad con edificio/tipo; se necesita agregación por comunidad/cohorte y tiempo para conclusiones de equidad. Necesidades recurrentes pueden hacer que el número de tickets dependa de las decisiones.

**Cierre:** informe con reloj, transporte de datos, versiones del candidato/modelo/prompt, presupuesto real, condición de finalización y criterio de exclusión. Intervalos agrupados por mundo para réplicas de Gemini, holdout, control de multiplicidad y poblaciones fijas. Pruebas de censura y comparaciones con cero denominador. No tratar cada post como muestra independiente.

### A16 — P1 · Escenarios ejecutables no equivalen a aceptación semántica completa

La suite comprueba que todos los fixtures pueden ejecutar sin romper invariantes, además de pruebas específicas valiosas de servicios, transporte y cooperación. No cubre todas las estrategias externas, parámetros, interacciones ni éxito/fracaso esperado para cada variante.

**Cierre:** oráculo revisable de restricciones/resultados por familia, casos adversos e inviables, tests metamórficos y stress combinado. Variantes actuales adversa/inviable son transformaciones reutilizadas, no 72 tragedias independientes validadas. Añadir cambios estructurales, no solo otro nombre o más publicaciones.

### A17 — P1 según claim · Portal, pagos, conectores y adopción reales

El sandbox ya distingue promesas, liquidación, compras y actualización pública. No prueba un checkout real, conciliación de proveedor, confianza del público, acceso a redes reales ni voluntad de cooperación institucional.

**Cierre:** proveedor de pagos en test mode, webhooks duplicados/fallidos/reembolsos, UX pública y autorizaciones; una fuente real permitida y revisión por organizaciones. Esto pertenece principalmente a NEXO y su validación, no al motor del mundo.

### A18 — P1 · Rendimiento del motor no es rendimiento de NEXO

PERFORMANCE informa mediciones anteriores en otro build. La carga de un millón de publicaciones aísla información en mapa pequeño y excluye inferencia, hashing final/export y UI del throughput principal. La documentación lo declara; conservar esa precisión.

**Cierre:** benchmark de extremo a extremo en build congelado: scraping, interpretación, herramientas, reservas, humanos, respuestas útiles, coste, CPU/RAM/disco y persistencia. Medir ×1000 efectivo por workload, no universal. No hace falta repetir el benchmark grande después de una edición documental.

## 5. Qué debe cambiar dónde

| Destino | Cambios necesarios |
|---|---|
| Simulador/evaluador | A01, timestamps/censura, métricas y fixtures adicionales, calibración, nuevas referencias, harness sellado |
| Plataforma NEXO | Agentes reales, decisiones/autoridad, UX por rol, compromisos entre instancias, conectores, observabilidad y coste |
| Integración entre ambos | Sesiones humanas limitadas, HTTP comparable, recibos, modos de reloj, causalidad y ledger correlacionado |
| Validación externa | Usuarios, procedimientos, cobertura real de fuentes, multimodalidad real, adopción y presupuestos |

No trasladar al simulador la tarea de descubrir respuestas ni permitirle elegir la mejor acción para el candidato. No exigir al motor de simulación construir el portal productivo, el checkout real o la infraestructura GCP de NEXO.

## 6. Orden recomendado de cierre

1. Corregir A01 y validar fórmulas/horizonte con casos manuales; fijar contratos de medición.
2. Aprovisionar operador limitado y conectar una instancia NEXO mediante HTTP, Gemini real y trazas.
3. Completar un ciclo hasta servicio y su versión con fallo, rechazo e incertidumbre.
4. Construir referencias competentes y extender métricas; comparar sin buscar aún porcentajes comerciales.
5. Añadir composición/red/repair, varias instancias y atención humana medida.
6. Sellar holdout, añadir medios reales y revisar supuestos con especialistas.
7. Ejecutar benchmark con incertidumbre, sensibilidad, pérdidas y costes; después ajustar los claims.

## 7. Condición para declarar el laboratorio apto para la evaluación final

- [ ] A01 corregido y suite ampliada para censura/denominadores.
- [ ] Entradas, acciones y resultados comparables entre candidato y referencias.
- [ ] NEXO y operadores sin credenciales omniscientes ni acceso a fixtures ocultos.
- [ ] Relojes, latencias, costes y recursos humanos incluidos.
- [ ] Baselines competentes y generalización estructural evaluable.
- [ ] Separación de mecanismos ya implementados y resultados por demostrar.
- [ ] Calibración relevante revisada y límites explícitos.
- [ ] Métricas primarias/guardrails definidos antes del test y exportables.
- [ ] Escenarios de fracaso, empate, pérdida y ausencia de solución incluidos.

Esta auditoría registra las brechas; no las corrige silenciosamente ni convierte los tests existentes en evidencia de superioridad de Gemini. No hay todavía un resultado NEXO vs referencia que permita concluir una mejora porcentual o una posición en la competición.

## 8. Nueva auditoría causal del comparativo — 13 de octubre de 2026, Tokio

Esta ampliación conserva el diagnóstico original y los resultados negativos de las campañas posteriores. Distingue una mala pregunta experimental de un fallo real del producto. La corrección del experimento no autoriza a borrar los controles donde la planificación convencional gana.

### A19 — P0 para el nuevo claim · Se estaba midiendo una parte distinta de la hipótesis principal

El comparativo `nexo-platform/evaluation/harness.mjs` utiliza un piloto de 5 × 5 nodos sobre 2 km, sin desastre físico activo, tráfico de fondo, publicaciones ambientales ni pérdida de paquetes. S23 entrega la necesidad estructurada a todas las organizaciones desde el inicio. `scripts/physical-load.mjs` también crea las demandas de carga y llama `observeNeed` para cada organización antes de publicar diez mensajes sociales por demanda.

Esto **no significa que B5 recibiera una ventaja secreta que no recibían B6/B7**. Todos reciben esa misma información formal. Además, B5 utiliza el mismo `receivedAllocationPlan` y, en servicios conocidos, el mismo compilador `servicePlan`. La referencia puede ignorar la información social porque el problema ya viene resuelto semánticamente: lugar, tipo, cantidad y necesidad han llegado como registros estructurados.

El resultado mide qué aporta investigar de nuevo una distribución ya tipada. El LLM puede añadir consultas y latencia sin descubrir nada necesario. Una derrota de NEXO en este mundo es válida y útil: **no debe invocarse un modelo para volver a resolver un problema que ya está resuelto por reglas fiables**.

**Qué cambiar:** mantener S23 y la carga de necesidades conocidas como controles de empate/pérdida. Añadir otro estrato donde la necesidad física existe, los primeros reportes públicos son accesibles por HTTP a todos y la observación formal aún no ha llegado. Evaluar si interpretar esos reportes, pedir una aclaración y compilar una respuesta reduce el tiempo hasta servicio físico. El candidato no recibe etiquetas privadas, IDs de necesidades escondidas ni un resultado de evaluación como entrada.

### A20 — P1 · La revisión de una propuesta no representa el trabajo previo de leer fuentes

Los slots, turnos y `reviewMs` del motor ya modelan autorización finita. No modelan por sí solos cuánto tarda un equipo en leer, relacionar, contextualizar y extraer solicitudes de publicaciones. Los controladores internos limitan muestras por política, pero eso no es una calibración del trabajo profesional.

**Qué cambiar:** separar la atención a fuentes de la autorización de acciones. Una referencia convencional competente debe poder deduplicar por lineage público, usar búsquedas, reconocer ubicaciones y extraer automáticamente patrones explícitos, sin coste ficticio de lectura humana para tareas ya automatizables. Los originales que requieren contexto pueden atravesar una cola de lectura con trabajadores y duración declarados. Después se utilizan exactamente los mismos canales de comprobación, inventarios, compilador de asignación y revisión de propietarios que en NEXO.

`readMs`, cantidad de trabajadores, demora formal, dificultad del corpus y duración de inferencia son **supuestos del experimento**, no minutos humanos medidos. Barrerlos y guardar el punto donde desaparece la ventaja. El control `readMs = 0` representa interpretación gratuita/perfecta: puede favorecer a la referencia y debe conservarse. Un resultado que únicamente gana con una demora humana muy alta no sostiene el claim general.

### A21 — P1 · Un límite de rondas puede truncar el producto antes de que lleguen novedades

El comparativo anterior ofrece una cantidad finita de rondas de planificación y luego espera la ejecución hasta el horizonte. Si una respuesta requiere evidencia o capacidad que llega después de la última ronda, esa novedad no obtiene otra oportunidad de planificación. En la carga física, tres rondas con pausas largas dejan flota y necesidades pendientes aunque el motor aún tiene tiempo para atenderlas.

Esto es una limitación declarada del protocolo anterior, **no una autorización para dar al candidato más oportunidades que a la referencia**. También existe un problema del producto si una investigación inconclusa no se reanuda cuando llega la evidencia o vuelve la capacidad.

**Qué cambiar:** comparar controladores recurrentes bajo el mismo horizonte, oportunidades de ingesta, cadencia y presupuesto. Reanudar comprobaciones existentes sin pagar de nuevo por interpretar los mismos textos. Contabilizar las rondas ejecutadas, inactividad por ausencia de novedades, límites de presupuesto y tiempo durante el que recursos útiles quedaron sin trabajo. Conservar los comparativos de tres rondas como diagnósticos de esa configuración.

### A22 — P1 · El descubrimiento de un lugar no termina todas las necesidades de ese lugar

Una publicación puede revelar una necesidad de comida en un edificio donde ya se conocía una necesidad de agua. Encontrar cualquier registro del edificio no confirma automáticamente el nuevo tipo ni su vigencia. Del mismo modo, generar una propuesta para la primera parte de un lote no completa las ubicaciones aún pendientes ni el remanente sin atender.

**Qué comprobar en NEXO:** continuación después de una propuesta parcial; consultas inconclusas; una nueva necesidad de otro tipo en un lugar ya atendido; cambio de fuente; nueva oferta de un socio; oferta retirada; capacidad que vuelve tras una entrega; evidencia borrada o cancelación. Los registros de hipótesis, observación formal, cantidad asignada y servicio recibido deben seguir separados.

La cantidad inferida de un post no pasa a ser demanda física autorizada. El canal responsable devuelve las observaciones disponibles; la asignación utiliza esos registros y los permisos de los dueños. Una hipótesis falsa puede provocar una comprobación improductiva, pero nunca crear recursos, borrar una necesidad formal vigente o acreditar una entrega inexistente.

### A23 — P0 para K02 · El resultado debe medirse desde la necesidad hasta ayuda útil

La nueva cohorte retira explícitamente la demanda piloto original antes de avanzar el tiempo y deja su cantidad en cero. Esa fila es un control administrativo, **no una comunidad atendida en cero minutos**. Excluir demandas de cantidad cero de los percentiles y denominadores de atención. La cohorte física positiva, las comunidades silenciosas y los casos sin servicio permanecen en el resultado.

Informar al menos aparición física → primera atención útil y aparición física → atención suficiente, junto con censura al horizonte, fracción atendida y déficit integrado por unidad nativa. Separar disponibilidad del post, descarga, interpretación, aclaración, borrador, aprobación, orden, recepción y servicio. Ni la propuesta ni la llegada del camión cierran K02 por sí solas.

Las versiones nuevas del candidato, del motor, del evaluador, del corpus y del modelo deben estar congeladas durante cada contraste. En esta cohorte la configuración adicional no está dentro del `validateConfig` básico del motor: guardar y comparar también su `manifest.config` y `corpusHash`. El mismo mapa y la misma seed básica no bastan si cambian cantidad de ruido, estilo de textos o demora formal.

## 9. Cohorte informacional añadida y límites

`disaster-response-simulator/generators/response-benchmark.mjs` añade `installResponseBenchmark(world, options)` como herramienta del evaluador, antes de avanzar el mundo. Sus parámetros por defecto son 12 necesidades, 48 originales de ruido, dos republicaciones por solicitud, primeros reportes a los 15 s, separación de 2 s y canal formal 30 minutos después. Son valores diagnósticos declarados, no estimaciones de un desastre concreto.

Las demandas de agua, comida y mantas utilizan cantidades pequeñas, recursos y vehículos finitos del motor normal. Los lugares se eligen de forma procedural por seed. Los mensajes combinan solicitudes explícitas y solicitudes contextuales: recipientes de agua pendientes después de un suministro parcial, personas sin una porción de comida y personas sin una manta. Los distractores incluyen solidaridad, material histórico etiquetado, rumores no verificados y comentarios operativos sin cantidad confirmada. Los reposts conservan referencias públicas; contextualizar no exige inspeccionar los metadatos ocultos.

Los mensajes contextuales no incluyen geotag. Sí incluyen un identificador público de lugar legible en el texto, resoluble contra el mapa recibido por HTTP. Esto prueba interpretación/contexto y enlace a un lugar conocido; todavía no prueba geolocalización difícil en topónimos ambiguos reales. Audios, fotos y clips de esta cohorte llevan descripciones, no bytes reales: la batería multimodal se mantiene aparte.

La aclaración de un edificio ya existente en `engine/tasks.mjs` puede devolver las necesidades observadas en ese lugar. Por eso el candidato puede descubrir una necesidad sin conocer su ID privado. La misma herramienta, demora, conectividad y probabilidad de respuesta están disponibles para la referencia. En el perfil inicial se usa respuesta observable determinista; en perfiles adversos la aclaración puede quedar inconclusa o perderse y no se cuenta como éxito.

Las cinco pruebas nuevas comprueban publicaciones anteriores al canal formal sin revelación de necesidades privadas, descubrimiento por ubicación, determinismo y continuación exacta, comunidades silenciosas con fallback formal y rechazo de configuraciones imposibles. Su paso no demuestra superioridad de NEXO: esa conclusión exige ejecutar los controladores reales y medir sus consecuencias físicas.

La ampliación de medición añade `firstServiceAt` en el callback físico `serveNeed`, solo cuando una cantidad positiva cubre demanda restante. `firstUsefulServiceMs` y `sufficientServiceMs` tienen denominadores y censuras distintos; `needToServiceMs` conserva su significado anterior de atención suficiente. Tres pruebas adicionales comprueban una entrega parcial seguida de la final, cantidad cero/oversupply sin crédito de atención y conservación del primer timestamp tras un checkpoint. La suite conjunta del simulador pasa **128/128 tests** y el check recorre 70 módulos en esta revisión. Estos conteos son de verificación funcional, no de episodios comparativos ni de operadores humanos.

**Pendientes independientes de la campaña local:** calibrar el trabajo humano y la demora formal con operadores; autoría externa de un holdout; precisión sobre fuentes reales; validación del acceso autorizado a redes; repetición con Gemini; y pruebas de adopción institucional. No convertir una ventaja modelada de Gemma en una predicción garantizada de vidas salvadas o primer puesto.

## 10. Disponibilidad recurrente y conservación de capacidades

**A24 — P0 para operación continua.** El primer piloto atendió exactamente ocho necesidades con ocho vehículos porque el motor omitía reportar disponibilidad después de descargar. La reparación emite telemetría terminal por el canal existente, incluyendo demoras y desconexión. Su timestamp y versión impiden regresiones por retries fuera de orden. Las pruebas verifican dos viajes físicos del mismo vehículo, pérdida de conectividad, versión antigua y replay. Una flota físicamente libre pero observada ocupada no se corrige regalando al candidato la verdad del evaluador.

**A25 — P0 para composición.** La verificación de recursos debe conservar cualificaciones observadas. El snapshot de campo ahora transmite `qualifications` del recurso realmente observado. El test recorre consulta, reporte recibido y aislamiento entre propietarios. No se conceden cualificaciones a recursos incapaces ni se rebaja seguridad por urgencia.

**A26 — P0 para comparación temporal.** El nuevo protocolo entrega acuses de verificación pendientes y conserva la cola finita de campo. Esperar todas las consultas antes de actuar penalizaba artificialmente a un controlador con más candidatos. Todos los brazos pueden trabajar con una observación ya recibida mientras otras se comprueban. Se prueban la ausencia de revelación instantánea y la separación temporal de dos comprobaciones en cola.

Los resultados anteriores conservan su build y limitación. La campaña con B5 8/12 y B6 abortado no acredita una ventaja. [MEJORA_RESPUESTA.md](MEJORA_RESPUESTA.md) registra diagnóstico y campañas posteriores; la verificación final da el conteo actualizado de pruebas.

## 11. Demanda que reaparece, inspección y versiones probadas

**A27 — P0 para consecuencias dinámicas.** Una necesidad cubierta que aumentaba conservaba timestamps de atención previos. El motor abre una nueva etapa solo cuando vuelve a existir déficit después de cobertura/retiro, conserva historia y reinicia tiempos de servicio. Las retiradas quedan distinguidas de entregas. Nueve pruebas cubren aumento, retiro/reapertura, servicio parcial/suficiente, exceso y replay. No se atribuye esta corrección a una ventaja de percepción del LLM.

**A28 — P0 para evaluación de seguridad.** Aclaración o radio no constituyen una inspección competente. El recibo usado para activar tiene método físico, personal cualificado, propietario, viaje/operación, objetivo/versiones, tiempos y vigencia. Se añade delegación con autorización independiente del responsable y dueño del equipo; las cualificaciones deben sobrevivir toda consulta y oferta, no solo la primera observación. Un resultado antiguo, permiso retirado o ruta bloqueada no produce éxito.

**A29 — P0 para integridad del cierre.** El verificador anterior controlaba solo cambios del candidato. Ahora debe comprobar además evaluador y motor, en procesos frescos para evitar caché de módulos. Un cambio en cualquier capa invalida el cierre. Las suites anteriores se conservan con su alcance; la verificación posterior acredita únicamente sus bytes/versiones y casos ejecutados.

La ganancia temporal queda pendiente hasta terminar los ensayos congelados de esta versión. Mantener sensibilidad de lectura convencional cero/rápida, confirmaciones finitas, silencio y conexión; no declarar generalización, calibración ni ventaja universal por reparar estos mecanismos.

## 12. Acuses pendientes y orden finito de atención

**A34 — P0 para integridad de la comparación.** El producto emitía continuaciones nuevas por cada sondeo y recibos de transporte que sólo cambiaban la fecha de polling. Como la comunicación tiene coste temporal, una cola accidental podía fabricar demora dependiente de la CPU. Corregir el producto, sin rebajar el coste causal de comunicaciones reales. Repetir mundos y semillas con una nueva huella; conservar campañas afectadas como invalidadas y gasto desconocido como reserva. Una regresión HTTP debe producir los mismos tiempos físicos y cantidades con polling rápido/lento, una orden y un viaje, sin duplicar `peer_send` ante estado idéntico. Los timestamps de evaluación competente permanecen materiales; no deduplicar vigencia ni hechos distintos.

**A30 — P0 para idempotencia entre tandas.** `actorView` sólo exponía inspecciones terminales. Por ello una deduplicación que funcionaba con un mock no encontraba las comprobaciones pendientes en una fuente real. Ahora el dueño recibe metadata de sus propias solicitudes en cola/en progreso; no recibe resultado, vehículo asignado, operación ni hechos aún no comunicados. Las solicitudes ajenas permanecen ocultas. El recorrido real de dos tandas hacia el mismo lugar crea exactamente una inspección.

**A31 — P0 para orden de la cola.** Las claves de desempate `inspection-10` y `inspection-8` provocaban un orden lexicográfico diferente al de llegada. El preparo de inspecciones usa una secuencia monotónica con padding, también en reintentos. No se modifica el orden global de sucesos exógenos ni se prioriza por hechos ocultos. Regresiones cruzan los IDs 9/10 y comprueban doce solicitudes con uno/dos trabajadores.

**A32 — P1 para percepción de comunicaciones.** La plataforma puede consultar `communication` y `bulletins` a través del canal de actor y la demora normal. Recibe contactos conocidos, conectividad propia y órdenes dirigidas a ella; no recibe la conectividad privada del resto de los sectores ni boletines futuros. El recibo de consulta conserva timestamps de fuente separados de la fecha local de persistencia.

**A33 — P0 para coste/tiempo del proveedor.** Una llamada fallida conserva espera real; una respuesta truncada conserva coste conocido y se liquida una sola vez. La deserialización rechazada no vuelve a enviar un recibo de modelo. La disponibilidad de percepción en el ensayo cobra el máximo entre latencia declarada y espera medida. Estos arreglos no convierten microtandas de ruido en procesamiento gratuito.

Todos los perfiles comparativos posteriores usan el motor corregido para candidato y referencias. Los pilotos negativos anteriores permanecen vinculados en [MEJORA_RESPUESTA.md](MEJORA_RESPUESTA.md). La campaña de carga y sus controles separan la oportunidad de información temprana de las demoras físicas; no prueban calibración externa ni productividad humana real.

## 13. Reservas largas, recibos físicos y propiedad del stock

**A35 — P0 para comparación temporal.** La ventana implícita de 15 minutos puede vencer durante una recogida legítima más larga. El producto debe planificar con una ventana explícita autorizada y política recibida; no eliminar la caducidad del simulador. Un plazo inválido se rechaza antes de reservar. Las referencias reciben el mismo contrato y siguen usando los mismos recursos finitos.

**A36 — P0 para conocimiento del actor.** Algunos fallos, cancelaciones y esperas de seguridad cambiaban el estado físico sin reportarlo al actor. Publicar cambios materiales por el canal normal; respetar pérdida y conectividad. Versionar hechos materiales, no cada consulta. Con mismo timestamp, un mensaje viejo no sustituye el fallo/finalización más nuevos. Regresiones deben incluir observación offline y posterior reconexión.

**A37 — P0 para servicio compuesto y conservación.** Después de una entrega ajena, el stock propio de una instalación podía tener un ID con sufijo que el servicio ignoraba. Resolver por nodo, tipo y dueño real; registrar stock consumido. El stock ajeno no es utilizable por el simple hecho de compartir nodo. Probar el caso de entrega ajena consumida, abastecimiento propio posterior, transferencia y ledger intacto.

Los outcomes afectados conservan coste y diagnóstico en [pickup-stock-invalidation.json del repositorio privado de NEXO](https://github.com/Hi-io/nexo-platform/blob/main/reports/pickup-stock-invalidation.json). La diferencia aparente de 2,07% de un control no demuestra ventaja: incluye un pickup convencional censurado por caducidad. El producto también debe evitar reproponer dependencias completadas y razonar otra vez sobre progreso ya recibido. Reparar esas causas exige nueva huella, verificación y campaña, no reinterpretar el resultado anterior como éxito.
