# NEXO — Criterios para desarrollar la plataforma

Documento de trabajo · 11 de octubre de 2026. Arquitectura provisional; capacidades por implementar y validar.

Relacionados: [simulador](SIMULADOR.md) · [demo](DEMO.md).

## 1. El producto en una frase

Una plataforma para ONGs, gobiernos y equipos de emergencia que utiliza Gemini para investigar información dispersa, descubrir respuestas entre organizaciones y preparar decisiones con evidencia y responsables.

La ciudadanía accede a un portal público de necesidades y avances. El equipo técnico de la organización despliega la instancia; los operadores la utilizan. No se espera que un donante despliegue servicios ni que el trabajo se organice mediante un chatbot.

Separar tres entregables: plataforma operativa, laboratorio de simulación y web de presentación. Un mapa animado de la presentación no ejecuta decisiones; una simulación no acredita resultados de campo.

## 2. Qué debe hacer Gemini y qué debe hacer el resto del sistema

| Responsabilidad | Mecanismo propuesto |
|---|---|
| Interpretar reportes y fuentes heterogéneas | Gemini con extracción estructurada y referencias verificables |
| Relacionar descripciones distintas y proponer capacidades | Gemini formula hipótesis que requieren comprobación |
| Elegir qué investigar después | Gemini propone consultas según su capacidad de cambiar la decisión, coste y demora |
| Comprobar cantidades, restricciones y compatibilidad formalizada | Herramientas, validadores, catálogos y optimizadores |
| Mantener reservas, permisos y estados consistentes | Servicios transaccionales y reglas explícitas |
| Autorizar compromisos y acciones | Responsables humanos identificados |
| Detectar qué propuestas quedan afectadas por un cambio | Dependencias registradas y revisión asistida por Gemini |
| Compartir actualizaciones | Eventos y contratos interoperables, con controles de acceso |

El núcleo a demostrar no es «Gemini resume mucho». Es que selecciona una investigación útil, descubre una opción fundamentada y revisa sus condiciones al cambiar el mundo. No afirmar que las técnicas tradicionales son incapaces de resolver el problema; medir qué aporta cada componente.

## 3. Tres capacidades que elevan la propuesta

### Investigar donde una respuesta puede desbloquear más ayuda

Hay varias incógnitas, pero confirmar la disponibilidad de un equipo podría habilitar una instalación que abastece a varios refugios. Gemini identifica esa dependencia y propone la comprobación prioritaria. Registrar también casos donde preguntar cuesta más tiempo del que ahorra.

### Descubrir capacidades descritas para otra finalidad

Una ONG registra un equipo como respaldo de telecomunicaciones; otra describe una planta detenida por falta de energía. Gemini relaciona necesidades y especificaciones, sin asumir compatibilidad, permiso o disponibilidad. Las herramientas y los responsables comprueban esas condiciones.

### Revisar lo afectado, conservando lo que sigue siendo válido

Un propietario retira su generador. El sistema identifica las propuestas dependientes, conserva los compromisos que aún sirven y busca sustitutos. Debe explicar por qué cambió la recomendación, sin propagar cancelaciones innecesarias por toda la red.

## 4. Modelo de evidencia y conocimiento

Guardar afirmaciones separadas de documentos. Cada afirmación necesita origen, fragmento o referencia recuperable, fecha del hecho y de recepción, ubicación y resolución geográfica, autor o canal cuando corresponda, vigencia, permisos y relaciones con otras afirmaciones.

Estados útiles: observado, inferido, pendiente de contraste, contradicho, confirmado por una fuente identificada, caducado y retirado. No convertirlos en una etiqueta universal de verdad.

- Mantener el origen compartido de republicaciones para no multiplicar artificialmente confianza.
- Mostrar contradicciones relevantes, no solo el resumen más convincente.
- Tratar ausencia de información como incertidumbre, no como ausencia de necesidad.
- Actualizar vigencia según el fenómeno: un bloqueo temporal y un puente destruido no envejecen igual.
- Conservar evidencia de la decisión tal como existía cuando se autorizó; una corrección posterior no reescribe la historia.
- Exponer fuentes y comprobaciones, no razonamiento interno privado del modelo.

La incertidumbre debe permitir opciones parciales, verificaciones y acciones autorizadas con condiciones explícitas. No paralizar todos los flujos hasta alcanzar certeza absoluta.

## 5. Interfaz de decisión: pocas cosas, pero suficientes

La vista principal de una propuesta debe responder rápidamente:

1. Qué podemos hacer y a quién beneficia.
2. Por qué parece viable ahora.
3. Qué falta comprobar o qué condición podría invalidarla.
4. Quién debe autorizarla y qué compromiso supone.

Las fuentes completas, 200 publicaciones o detalles técnicos se abren bajo demanda. La evidencia que contradice la propuesta no debe quedar oculta detrás de una puntuación tranquilizadora.

Medir tiempo de revisión, comprensión y errores de los operadores. «Human in the loop» no basta si la persona acepta una recomendación que no puede evaluar. Usar revisiones proporcionales al impacto, alertas dirigidas a las operaciones afectadas y resúmenes de qué cambió desde la última decisión.

Ofrecer navegación con teclado, estados claros, bajo consumo de datos y una vista útil con conectividad degradada. Las decisiones no deben depender de interpretar una animación.

## 6. Estado operativo y coordinación entre instancias

Distinguir hipótesis, propuesta, autorización, reserva, salida, llegada, recepción y atención. «Otra ONG tiene un generador» no equivale a «está reservado» ni a «la planta ya suministra agua».

Una instancia debe ofrecer valor por sí sola con sus fuentes y operaciones. La segunda añade información y capacidades que antes no estaban disponibles; medir ese incremento por separado.

Son dos modos del mismo producto: **una organización amplía su capacidad de entender y actuar; una red puede construir respuestas que ninguna organización podía ejecutar sola**. No hace falta esperar a que exista una red para utilizar NEXO. Tampoco basta con conectar dos instancias para asegurar una mejora: hacen falta capacidades complementarias, permisos y compromisos viables. La ganancia puede ser nula en algunos casos; no prometer un multiplicador fijo.

Contratos de intercambio mínimos: identificadores estables, versión, origen, tiempo del hecho, vigencia, estado, alcance de acceso y referencias de evidencia. Cada organización decide qué comparte. No exigir una base mundial con todos los datos para obtener valor inicial.

La arquitectura centralizada o federada seguirá abierta hasta evaluar necesidades reales. MCP puede exponer herramientas autorizadas; no resuelve por sí mismo distribución de eventos, consenso, identidad ni consistencia.

Situaciones que deben resolverse explícitamente:

- Dos solicitudes simultáneas sobre el mismo recurso: reserva consistente y respuesta de conflicto.
- Reintentos o mensajes duplicados: idempotencia y estados reconciliables.
- Eventos retrasados: versiones y vigencia, evitando que un reporte antiguo sobrescriba una corrección.
- Organización desconectada: compromisos vigentes, pendientes visibles y política de caducidad.
- Recurso retirado: notificar dependencias concretas y requerir nueva autorización cuando corresponda.
- Diferencia de catálogos: unidades, capacidades y restricciones normalizadas sin borrar el significado original.

## 7. Integrar sistemas existentes sin atribuirles capacidades inexistentes

LogIE, IFRC GO y otros sistemas ya cubren partes de información y coordinación humanitaria. La hipótesis de NEXO debe ir más allá de una pantalla unificada: investigar relaciones entre fuentes y capacidades y convertirlas en propuestas comprobables.

| Integración prevista | Entrada posible | Salida posible, cuando esté autorizada |
|---|---|---|
| Contexto logístico | Restricciones, infraestructura, reportes y vigencia | Avisos de incidencias con evidencia |
| Inventarios y gestión operativa | Capacidades, ubicaciones, reservas y disponibilidad | Solicitudes o compromisos aceptados |
| Fuentes de terreno y canales autorizados | Necesidades, documentos, audio y confirmaciones | Solicitudes de verificación o actualizaciones |
| Otras instancias | Información y capacidades que deciden compartir | Consultas y eventos permitidos |

Antes de implementar cada conector: verificar API o exportación disponible, términos, licencia, identidad, permisos, esquema, límites y frecuencia. Empezar por lectura cuando sea suficiente; no asumir acceso de escritura. Confirmar acciones en el sistema de origen y evitar duplicados.

No presentar un conector previsto como implementado ni una fuente consultada como socio. Referencias: [LogIE](https://logie-manual.logcluster.org/en/getting-started), [revisión de reportes de LogIE](https://logie-manual.logcluster.org/en/review-incoming-reports), [IFRC GO](https://www.ifrc.org/happening-now/emergencies/ifrc-go).

## 8. Portal público, confianza y apoyo

Publicar necesidades, avances, uso agregado de fondos y evidencia apropiada de entrega. Distinguir promesa, envío, recepción y servicio. Gemini puede preparar explicaciones legibles; la organización controla su publicación.

Evitar exponer ubicaciones sensibles, datos personales o identidades de afectados por defecto. La evidencia puede mostrar suministros y recepción sin convertir a las personas afectadas en material promocional.

El apoyo económico se canaliza a través de las organizaciones y sus mecanismos autorizados. No implica que una donación compre una unidad específica ni garantiza trazabilidad individual si solo existe contabilidad agregada. El concepto actual no recibe dinero.

## 9. Arquitectura provisional en Google Cloud

| Componente | Papel previsto | Decisión pendiente |
|---|---|---|
| Gemini | Interpretación e investigación con herramientas | Modelo, vía de acceso, costes, evaluación y límites |
| Firebase Authentication | Identidad de los usuarios | Roles, identidad de organizaciones y autorización en servidor |
| Firebase Hosting | Interfaz y portal público | Distribución final de aplicaciones y dominios |
| Cloud Run | Agentes, APIs y conectores | Concurrencia, escalado, colas y límites por organización |
| Pub/Sub | Distribución de eventos entre servicios | Contratos, reintentos, orden relevante y deduplicación |
| Cloud SQL / PostgreSQL | Estado y compromisos persistentes | Aislamiento, transacciones y esquema |
| Cloud Storage | Evidencias y documentos | Retención, permisos y referencias |
| Observabilidad | Reconstrucción de ejecuciones, costes y fallos | Trazas, alertas y datos que deben redactarse |

Son elecciones propuestas, no una arquitectura desplegada. No invocar al modelo por cada persona, fotograma o evento del simulador. Agrupar señales, deduplicar, priorizar cambios relevantes y establecer presupuestos y presión de cola.

El despliegue «en un clic» debe validarse desde un proyecto limpio con permisos y facturación configurados, no solo desde el entorno del desarrollador. Documentar configuración y destrucción de recursos de prueba, sin prometer coste o duración antes de medirlos.

## 10. Límites de las herramientas y fallos esperados

Las fuentes son datos; no pueden conceder permisos ni ordenar acciones. Las herramientas deben aplicar autorización, validación de parámetros, límites e idempotencia fuera del modelo. No incluir secretos ni datos de otra organización en un contexto porque un documento lo solicita.

Definir comportamiento ante caída del modelo, respuestas inválidas, herramientas lentas, permisos denegados y cuotas agotadas. Mantener hechos, compromisos y trabajo pendiente accesibles; el fallo de Gemini no debe borrar el estado operativo.

## 11. Qué probar antes de ampliar el alcance

- Un recorrido completo desde una señal hasta una acción autorizada y su resultado, conservando evidencia.
- Una propuesta rechazada y una hipótesis incorrecta corregida sin ocultar el error.
- Una necesidad sin información suficiente y una comunidad que no publica.
- Una reserva en conflicto y una retirada que actualiza todas las propuestas dependientes.
- Dos organizaciones con permisos distintos sin fuga de información.
- Comparaciones que separan el valor de extracción, investigación, red y automatización convencional.
- Latencia, coste y esfuerzo humano bajo carga; no solo número de señales procesadas.
- Revisión por operadores o especialistas para comprobar que el flujo encaja con responsabilidades reales.

La primera prueba de valor no es «tenemos muchos agentes». Es una decisión útil que mejora gracias a información investigada entre actores, con una explicación breve y una ejecución correcta.

## 12. Núcleo de la respuesta colectiva: capacidades por implementar

Estos requisitos concretan la ambición del producto; no describen funcionalidades ya construidas. Los identificadores se corresponden con los escenarios de la sección 13 de [SIMULADOR.md](SIMULADOR.md#13-escenarios-para-la-respuesta-colectiva).

### C1 — Componer una capacidad que no estaba disponible

Descubrir combinaciones de recursos, personal, instalaciones y operaciones que habiliten un servicio nuevo. El resultado debe expresar el servicio posible, sus dependencias, cantidades, plazos, condiciones pendientes y responsables. Una coincidencia entre «necesita agua» y «tiene agua» no demuestra por sí sola esta capacidad.

Ejemplo de desarrollo: ninguna organización puede habilitar por sí sola un refugio adicional. Una dispone de un edificio cuya idoneidad debe confirmar personal competente; otra aporta saneamiento e insumos; otra, personal y transporte. NEXO descubre la combinación y prepara una propuesta condicionada. El refugio solo cuenta como operativo cuando se cumplen las condiciones y se activa el servicio. Gemini no certifica la seguridad del edificio.

La búsqueda debe contemplar alternativas, sustituciones y opciones parciales. Las herramientas comprueban las restricciones cuantificables; los responsables confirman la disponibilidad operativa y autorizan. Compartir un inventario no equivale a ofrecer todos sus recursos.

### C2 — Convertir una propuesta conjunta en compromisos compatibles

Permitir ofertas condicionadas: «aportamos transporte si los insumos están confirmados», «este equipo está disponible entre estas horas» o «podemos prestar el recurso si conservamos esta reserva mínima». Cada organización conserva sus prioridades, autoridad y límites de divulgación.

- Registrar oferta, condición, responsable, versión, reserva temporal, vencimiento, confirmación y rechazo.
- Identificar dependencias circulares y evitar esperas indefinidas o bloqueos mutuos.
- Reservar de forma consistente; una consulta de disponibilidad no reserva un recurso.
- Ante aceptación parcial, desconexión o vencimiento, distinguir lo confirmado de lo pendiente y liberar lo que corresponda.
- Requerir autorización para cambios materiales; no trasladar automáticamente una aprobación a otra propuesta.

El mecanismo de coordinación transaccional queda por diseñar. MCP expone operaciones; no garantiza estos acuerdos. La red intercambia lo necesario para coordinar, sin exigir acceso irrestricto a los datos de cada actor.

### C3 — Investigar la incógnita que más puede cambiar la respuesta

Priorizar consultas y verificaciones por el valor esperado para una decisión, teniendo en cuenta coste, demora, incertidumbre, acceso y atención humana. Investigar activamente puede significar consultar una herramienta autorizada o preparar una solicitud de confirmación al responsable, según el procedimiento acordado.

La verificación no es un oráculo instantáneo. Puede llegar tarde, ser inconcluyente o mostrar que una opción era inviable. La plataforma debe poder abandonar una hipótesis, preparar otra o recomendar una acción parcial autorizable. Conservar preguntas, evidencia y conclusiones observables; no presentar una supuesta cadena interna de pensamiento como prueba.

### C4 — Coordinar necesidades que compiten entre sí

Evaluar el efecto conjunto de las propuestas: cien opciones factibles por separado pueden competir por el mismo vehículo, personal o insumo. La coordinación debe detectar conflictos, buscar combinaciones y respetar compromisos existentes, reservas mínimas y criterios de prioridad definidos por los responsables.

Una reasignación que beneficia a una comunidad puede perjudicar a otra. Hacer visibles esos efectos y obtener los permisos necesarios; no permitir que Gemini invente la política de distribución. No medir éxito por el número de propuestas generadas.

### C5 — Reparar una respuesta cuando cambia la evidencia

Mantener relaciones entre afirmación, comprobación, propuesta, compromiso y operación. Si se retira un recurso o se corrige una fuente, identificar destinatarios y decisiones afectados, propagar la revisión y buscar sustitutos sin cancelar acuerdos todavía válidos.

Una corrección informativa no revierte una acción física: un vehículo que ya salió necesita instrucciones autorizadas y puede no recibirlas inmediatamente. Registrar qué se supo, cuándo, quién revisó la decisión y qué efectos no pudieron evitarse.

### C6 — Aumentar capacidad sin saturar al operador

Agrupar decisiones relacionadas, mostrar cambios desde la última revisión y pedir solo las confirmaciones pertinentes a cada responsable. Mantener visibles desacuerdos, condiciones críticas y acciones pendientes. La aprobación agrupada solo es válida cuando el operador tiene autoridad sobre todas las acciones y puede comprender sus consecuencias.

Medir tiempo de revisión, cola de decisiones, errores, rechazos y fatiga aproximada bajo carga. Más propuestas por minuto no equivalen a mayor capacidad de respuesta si la autorización se convierte en el cuello de botella. Comparar agrupación y revisión individual sin dar aprobaciones gratuitas al sistema.

### C7 — Funcionar con autonomía local e información parcial

Probar primero el valor de una instancia con fuentes externas y datos propios; después el valor adicional de la cooperación. La organización puede limitar consultas, no compartir determinados datos o rechazar compromisos. Disponibilidad física, disponibilidad declarada y disponibilidad autorizada son estados distintos.

Mantener operaciones locales útiles durante cortes. Reconciliar información al reconectar sin duplicar recursos, compromisos ni entregas. Una instancia no debe asumir que la ausencia de respuesta de otra equivale a consentimiento. Medir también situaciones en las que la coordinación cuesta más de lo que aporta.

### H1 — Horizonte de investigación: patrones de respuesta reutilizables

Explorar una memoria de patrones verificados entre emergencias, separada del núcleo inicial. Cada patrón conserva contexto, precondiciones, dependencias, comprobaciones, fallos, resultado observado, límites de aplicación y procedencia autorizada. Una solución pasada genera una hipótesis para investigar, nunca una garantía local.

La transferencia debe volver a comprobar disponibilidad, compatibilidad y contexto. No reutilizar como hechos actuales datos de otro desastre ni asumir aprendizaje por entrenamiento del modelo. Comparar con recuperación simple de incidentes y medir transferencia negativa: un precedente aparentemente parecido puede empeorar una decisión.

## 13. Qué significaría haber construido esta ambición

- **Valor individual:** una instancia encuentra y prepara respuestas útiles con su información autorizada, sin depender de que otras adopten NEXO.
- **Valor colectivo:** con los mismos recursos agregados, actores conectados consiguen activar una respuesta que la referencia competente no logra, o la consiguen antes o con menos errores. Documentar la causa de la diferencia.
- **Aporte de Gemini:** interpretar e investigar descubre condiciones o alternativas relevantes que la variante de extracción y planificación no encuentra con los mismos límites. Una ventaja debe medirse; no se presume por usar agentes.
- **Ejecución consistente:** compromisos compatibles y acciones autorizadas producen servicio real dentro del laboratorio, incluso ante cambios y rechazos.
- **Capacidad humana:** el aumento de trabajo procesado no desplaza toda la carga a una cola de aprobaciones imposible de atender.

Estos criterios definen una hipótesis comprobable, no una promesa de ganar la competición. Simular permisos y cooperación permite probar mecanismos; no demuestra que organizaciones reales acepten compartir datos o adoptar la plataforma. Esa validación requiere conversaciones, ejercicios y pruebas con operadores.

## 14. Revisión exigente de la rúbrica — 11 de octubre de 2026

La [rúbrica oficial](https://aibuildercup.com/themes.html) distribuye 40% a técnica y GenAI, 25% a problema e impacto, 25% a innovación y 10% a experiencia. Los siguientes son criterios internos para defender una puntuación alta, no requisitos adicionales de la organización ni garantía de 100/100. Complementan C1–C7; no son siete módulos nuevos.

### R1 — Una intervención inicial y un resultado operativo definidos

Elegir una primera operación concreta, por ejemplo coordinación de abastecimiento y refugios durante una inundación regional, con un responsable de operaciones como usuario principal. Documentar quién configura las fuentes, quién revisa, quién autoriza, quién confirma el servicio y qué sistemas siguen siendo la fuente de autoridad. La amplitud futura no sustituye este punto de entrada.

Definir antes de optimizar la métrica principal por servicio: necesidades críticas atendidas dentro de la ventana acordada y demanda pendiente durante la espera. Añadir límites de seguridad, reservas, equidad y coste. No mezclar litros, camas y atención médica en una puntuación arbitraria. Gemini puede investigar opciones, pero no inventar la política que decide quién tiene prioridad. Registrar quién aprueba esa política y cuándo cambia.

### R2 — Aporte incremental de Gemini y de NEXO

Defender una contribución concreta: descubrir dependencias no expresadas como solicitudes/ofertas estructuradas, elegir la siguiente comprobación útil, componer una respuesta verificable y mantenerla válida ante cambios. Clasificar publicaciones o resumirlas no basta como diferenciación.

Además de las referencias existentes, comparar con un agente general competente que use la misma familia de Gemini, herramientas, datos autorizados y presupuestos. Esto separa el valor del diseño de NEXO del valor de tener acceso a un modelo potente. Registrar límites y consumo real; no exigir un mecanismo sofisticado cuando una regla resuelve igual de bien el caso.

Una traza debe enlazar señal, hipótesis, consulta, evidencia recibida, cambio de propuesta, autorización y consecuencia. Es evidencia observable; no una cadena interna de pensamiento. La escala debe incluir latencia de cola, llamadas fallidas, coste por resultado útil y tiempo humano, no solo cantidad de agentes.

### R3 — Cooperación que cambia lo que se puede hacer

Para C1/C2/C7, identificar una familia de servicios que requiera contribuciones complementarias y compromisos compatibles. Comparar la misma dotación agregada y la misma información accesible frente a coordinación convencional competente y una alternativa con datos compartidos. Las otras organizaciones también pueden comunicarse en la referencia.

Medir qué servicio adicional se activa, para quién, cuándo y qué otra operación deja de atenderse o se retrasa. La red no crea recursos físicos. Una ventaja frente a equipos artificialmente aislados no demuestra innovación en GenAI.

Incluir participación asimétrica: una o dos instancias NEXO y un socio externo que mantiene su software. Un conector o un operador puede registrar su compromiso, con autorización, identidad y demora explícitas. No depender de que todas las organizaciones migren antes de generar valor.

### R4 — Acceso a señales y cobertura como parte del producto

Mantener un registro de fuentes: acceso disponible o pendiente, API/exportación/canal, frecuencia, coste, cobertura geográfica y lingüística, condiciones de uso y responsable del conector. Distinguir ingesta automatizada, reporte humano y verificación de terreno. No prometer cobertura universal de redes sociales.

La plataforma debe mostrar qué zonas o canales están poco observados, cómo cambia una recomendación si se pierde una fuente y qué verificación autorizada podría cubrir ese vacío. Un rumor descartado no borra la necesidad de la comunidad. Las etiquetas de contradicción o material antiguo requieren evidencia; el modelo no puede certificar automáticamente qué es verdad.

### R5 — Ventaja estable, no solo operación exitosa

Establecer presupuestos de consulta, coste y atención; una condición para dejar de investigar; y reglas de degradación cuando faltan Gemini, conectividad o herramientas. No hay un umbral universal: acordarlo para el caso operativo y reportar sensibilidad.

La verificación de seguridad incluye contenido malicioso en fuentes, confirmaciones suplantadas y consultas entre organizaciones. La autorización fuera del modelo debe impedir escrituras o divulgaciones indebidas. Si el sistema pierde capacidad, preservar compromisos válidos y hacer explícito qué sigue pendiente.

### R6 — Experiencia del operador y adopción verificables

Probar con personas el recorrido detectar → comparar → aprobar/rechazar → recibir cambio → confirmar resultado. Medir comprensión, decisiones incorrectas y tiempo total, con carga y avisos contradictorios. La web de presentación no acredita esa experiencia. Las animaciones deben ser opcionales; estados y prioridades deben entenderse sin color, movimiento ni lectura de todas las fuentes.

Antes de atribuir impacto fuera del laboratorio, obtener revisión de procedimientos y restricciones por personas con experiencia en respuesta. Puede empezar como un ejercicio de mesa; no requiere prometer un despliegue gubernamental. Registrar supuestos confirmados, objeciones y decisiones de producto que cambian. La voluntad de compartir información y la viabilidad del acceso a fuentes no pueden validarse solo con agentes simulados.

### R7 — Diferenciación honesta

Preparar una comparación por capacidades, no por nombres de productos: ingesta multimodal, contexto, investigación activa, composición de servicios, compromisos entre actores y reparación. [Ushahidi Distant Voices](https://www.ushahidi.com/distantvoices/) ya describe captura y análisis multimodal para comunidades; [LogIE](https://logie-manual.logcluster.org/en/review-incoming-reports) documenta revisión de reportes y actualización de información logística. Son precedentes parciales, no prueba de que implementen todo NEXO ni de que carezcan de capacidades no documentadas.

No es necesario inventar un modelo fundacional, sumar más agentes o implementar H1 para que la propuesta sea ambiciosa. La defensa más fuerte sería un mecanismo generalizable de C1–C7 que mejore resultados en problemas no preparados para él.

## 15. Contrato con el laboratorio de simulación

El [diseño funcional del simulador](SIMULADOR.md) desarrolla el alcance completo en las secciones 16–39. I01–I26 enumeran entradas; O01–O23, salidas y acciones; S01–S24, casos observables. H1/S24 siguen siendo una ampliación opcional. Cambiar una capacidad de NEXO requiere revisar sus datos, permisos, consecuencias y pruebas en esa matriz.

La plataforma consume fuentes limitadas —incluida una red social ficticia que debe descubrir y scrapear— y emite acciones autorizadas. Nunca accede al estado privado del mundo. Instrumentar descarga, aceptación, interpretación, revisión y resultado para que el observatorio distinga lo publicado de lo realmente consumido.

El visor 3D y las etiquetas de verdad pertenecen al observador. Las descripciones textuales de videos y notas de voz son sustitutos ligeros para evaluar interpretación; no acreditan percepción multimodal real. Los tiempos de Gemini, humanos y herramientas deben contabilizarse según el modo experimental explícito. Una reproducción a ×1000 no demuestra inferencia en vivo a esa velocidad.
