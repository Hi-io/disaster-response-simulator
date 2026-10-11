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
