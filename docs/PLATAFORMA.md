# NEXO — Especificación integral del producto, experiencia y evaluación

Especificación de trabajo v2 · 12 de octubre de 2026. Define objetivos y condiciones de aceptación; no acredita funcionalidades ni resultados. Implementación primero en local; migración posterior a Google Cloud.

**Implementación local:** consultar [estado por requisito](ESTADO_IMPLEMENTACION.md), [resultados medidos](VALIDACION.md), [operación local](LOCAL.md) y [puertas de validación externa](VALIDACION_EXTERNA.md). El proveedor probado ahora es Gemma 4 mediante OpenRouter; el nombre Gemini de esta especificación sigue siendo el objetivo posterior. No se desplegó GCP.

Relacionados: [simulador](SIMULADOR.md) · [auditoría del simulador existente](AUDITORIA_SIMULADOR.md) · [arquitectura futura en GCP](ARQUITECTURA_GCP.md) · [demo](DEMO.md).

La especificación se mantiene sincronizada en `nexo-vision`, `nexo-platform` y `disaster-response-simulator`. El estado de implementación, los recibos y la operación local tienen su fuente canónica en `nexo-platform`; las copias de esos índices en los otros repositorios enlazan a esa fuente. Las secciones 1–15 conservan los principios C1–C7, H1 y R1–R7. Las secciones 16 en adelante los convierten en flujos, contratos, pantallas, pruebas y métricas. La arquitectura cloud se documenta aparte.

**Objetivo competitivo:** construir una candidatura extraordinariamente defendible en técnica, impacto, innovación y experiencia. Ningún documento, porcentaje de mejora ni simulación garantiza un puesto o 100/100. No ampliar el producto solo para sumar funcionalidades: cerrar con evidencia los puntos débiles que podrían invalidar su contribución.

**Cómo leerlo:** producto y responsabilidades (§1–15); alcance, roles y contratos (§16–20); inteligencia y UI (§21–26); red, integraciones y ejecución local (§27–29); calidad, KPIs y experimentos (§30–34); brechas, evidencias y entrega (§35–40). Los umbrales numéricos de §31 son objetivos internos propuestos, no mediciones ni requisitos oficiales.

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

## 9. Implementación local primero; arquitectura cloud separada

Desarrollar y probar frontend, backend, almacenamiento, colas e integraciones en local, como se detalla en §29. Usar adaptadores para sustituir servicios sin cambiar las reglas del producto. La arquitectura y el despliegue posteriores en Google Cloud están en [ARQUITECTURA_GCP.md](ARQUITECTURA_GCP.md).

Gemini no tiene aquí un equivalente local idéntico. El modo totalmente offline usa respuestas registradas o un proveedor de prueba identificado y no demuestra desempeño de Gemini. La validación real usa Gemini desde el backend local, con su latencia, consumo y fallos registrados. No invocar al modelo por persona, fotograma o mensaje duplicado: agrupar, priorizar y aplicar presupuestos.

El despliegue automatizado futuro se validará desde un proyecto limpio. El desarrollo local no sustituye el requisito cloud de la entrega al concurso.

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

El simulador no ejecuta Gemini. La plataforma llama a su proveedor: Gemma/OpenRouter en la fase local y Gemini cuando se habilite y vuelva a medir. Región, población y observaciones se describen en el diseño funcional y se contrastan con [el estado actual](ESTADO_IMPLEMENTACION.md). Consultar también la auditoría antes de interpretar una sección de diseño como estado de implementación.

## 16. Alcance del producto y condiciones que faltan para defenderlo

### 16.1 Resultado que se busca

NEXO convierte señales dispersas en respuestas ejecutables, autorizadas y revisables para desastres. Una instancia sirve a una organización; varias pueden componer servicios con capacidades complementarias. La ciudadanía comprende y apoya la respuesta a través de una proyección pública. La plataforma trabaja continuamente sin requerir un prompt para cada consulta o actualización.

La investigación debe enviar contexto útil, no el JSON completo de todas las operaciones. Conservar descripciones, incertidumbre, versiones, correcciones, linaje de fuentes y restricciones materiales. Presentar una vista relevante con recuentos de omisiones y herramientas para recuperar detalles autorizados. Cargar contratos de acciones especiales bajo demanda; copiar propuestas calculadas desde el servidor para no transcribirlas. Dar espacio suficiente a razonamiento y salida, sin ejecutar respuestas cortadas. El coste se controla mediante relevancia, límites acumulados y tarifas de proveedor, no suprimiendo información decisiva. [Política implementada y pruebas](CONTEXTO_MODELO.md).

Primera familia operativa de referencia: abastecimiento de agua y suministros básicos, habilitación de refugios y transporte asociado durante una emergencia regional. Terremoto, inundación e incendio introducen distintas restricciones sobre esa familia. El transporte de evacuación se coordina bajo decisiones de responsables competentes. No convertir la primera versión en un sistema de diagnóstico clínico, certificación estructural o mando autónomo de rescate.

El horizonte temporal depende del escenario; no existe un cuarto día a partir del cual deje de prestarse ayuda. El sistema coordina lo que puede coordinar: una recomendación no elimina un permiso legal, reconstruye una carretera ni crea suministros.

### 16.2 Inventario de frentes obligatorios

1. Fuentes externas automáticas, sociales y operativas, con cobertura visible.
2. Interpretación multimodal y multilingüe, geográfica y temporal, con evidencia.
3. Necesidades explícitas, inferidas y zonas insuficientemente observadas.
4. Investigación activa y selección de comprobaciones útiles.
5. Composición de alternativas y servicios nuevos, incluidas soluciones parciales.
6. Priorización conjunta bajo recursos, tiempo, permisos y atención limitados.
7. Compromisos consistentes y condicionados entre actores independientes.
8. Autorización humana proporcionada al impacto, con dueño y versión.
9. Ejecución a través de herramientas existentes y seguimiento hasta servicio efectivo.
10. Reparación de planes al cambiar evidencia, recursos o accesos.
11. Experiencia móvil de campo, conectividad degradada y reconciliación.
12. Portal público, comunicación revisada, contribuciones y trazabilidad agregada.
13. Administración, identidad, privacidad, integraciones y salud del sistema.
14. Evaluación reproducible, costes, generalización y validación con personas.
15. Instalación local repetible y migración cloud verificada.

H1, memoria entre desastres, es una ampliación opcional. La edición 3D del mundo pertenece al laboratorio. No hace falta reconstruir sistemas especializados de logística, pagos o GIS para integrar sus capacidades.

### 16.3 Objeciones que no desaparecen al completar funcionalidades

| Objeción pendiente | Evidencia necesaria para resolverla | Dónde se exige |
|---|---|---|
| Es una agregación de reportes con una capa de texto | Ventaja incremental de investigación/composición frente a extracción + planificador y agente general competente | §21, §32 |
| El software acelera propuestas pero no ayuda efectiva | Resultados físicos y demanda pendiente, incluyendo demoras humanas y logísticas | §31, §34 |
| La red gana porque tiene más recursos | Mismos actores, recursos y canales permitidos en todos los brazos; coordinación convencional habilitada | §27, §32 |
| El mundo está escrito para que NEXO gane | Evaluación sellada, autoría independiente, contrafactuales y sensibilidad | §32, auditoría |
| La solución solo reconoce frases de sus ejemplos | Nuevas composiciones, idiomas, nombres, distribuciones y medios no vistos | §32–34 |
| Mucha automatización acaba saturando a personas | Tiempo humano, errores, cola y pruebas reales de comprensión | §23–26, §31 |
| Los datos reales no estarán disponibles | Conector real de lectura, permisos documentados y cobertura medida | §28, §36 |
| La IA se equivoca con autoridad aparente | Evidencia, abstención/alternativas, revisiones materiales y controles fuera del modelo | §20–22, §30 |
| La ganancia perjudica a comunidades invisibles | Métricas por grupos y zonas; límites de no inferioridad | §31–32 |
| La operación cuesta demasiado o es lenta | Coste por resultado, presupuesto, carga y latencias reales | §29–32 |
| El público recibe una historia convincente pero incorrecta | Publicaciones derivadas de estados comprobados, comprensión y correcciones | §26 |
| Una simulación convincente acredita adopción | Ejercicios con operadores, procedimientos y disposición real a compartir | §36 |

## 17. Usuarios, autoridad y recorridos

### 17.1 Matriz de roles

| Rol | Entrada habitual | Puede hacer | Límites |
|---|---|---|---|
| Administrador de organización | Alta/configuración | Usuarios, fuentes, políticas, ámbitos, claves y acuerdos | No obtiene autoridad operativa por ser administrador técnico |
| Coordinador de emergencia | Centro de respuesta | Priorizar dentro de políticas; revisar y autorizar planes; delegar | Solo su ámbito, turno y presupuesto; no compromete recursos ajenos |
| Analista/verificador | Casos e investigaciones | Relacionar, contrastar, corregir y pedir verificaciones | No certifica hechos fuera de su competencia ni autoriza por defecto |
| Responsable de recursos | Inventario y compromisos | Ofrecer, reservar, retirar y autorizar préstamos de lo propio | Conserva reservas mínimas y verifica el sistema de origen |
| Despachador | Operaciones | Preparar órdenes, confirmar despacho y gestionar cambios autorizados | Reasignaciones materiales necesitan autoridad vigente |
| Equipo de campo | Tareas móviles | Recibir instrucciones, reportar, adjuntar evidencia y confirmar resultados | No puede marcar recibida una entrega ajena ni ver datos innecesarios |
| Responsable de instalación | Centro/refugio/planta | Confirmar recepción, capacidad, funcionamiento y necesidades | Diferenciar permiso, inspección y disponibilidad operativa |
| Responsable de comunicación | Publicación | Revisar, redactar, publicar y corregir información autorizada | La publicación no puede adelantarse a los hitos operativos |
| Responsable financiero | Fondos y compras | Conciliar aportaciones, compras, reembolsos y comprobantes | Dinero liquidado distinto de promesas; no es autoridad logística automática |
| Socio externo sin NEXO | Enlace limitado/conector | Confirmar su oferta, permiso o resultado | Acceso acotado y temporal; conserva su herramienta |
| Ciudadanía/donante | Portal público | Entender, contribuir, seguir progreso y comunicar incidencias | Sin acceso a información operativa sensible |
| Persona afectada | Canales existentes o formulario breve | Reportar necesidad y consultar información publicada | No requiere instalar NEXO ni usar una red social nueva |
| Evaluador | Laboratorio separado | Configurar mundos, leer verdad y calcular métricas | Nunca presta esa autoridad al agente evaluado |

Una persona puede acumular roles; cada acción conserva el rol y autoridad efectivos. Registrar suplentes, caducidad de delegaciones y relevos. Al terminar un turno, traspasar pendientes y contexto; no abandonar operaciones ni mantener aprobaciones tácitas.

### 17.2 Recorridos completos exigidos

- Organización nueva: alta → responsables → ámbito de emergencia → fuentes → inventario/sistemas → políticas → comprobación de conexión → primera necesidad.
- Operador: detectar → comprender evidencia → comparar → aclarar/modificar/rechazar/autorizar → seguir ejecución → recibir cambio → confirmar resultado → revisar impacto.
- Propietario de recurso: oferta condicionada → reserva temporal → confirmación → uso/préstamo → devolución/liberación/retirada.
- Campo: recibir tarea → confirmar lectura → preparar/salir → reportar cambio → llegar → confirmar entrega parcial o completa → sincronizar.
- Público: comprender emergencia y responsable → ver necesidad → aportar mediante canal oficial → ver progreso agregado → entender qué queda pendiente.
- Comunidad: enviar señal en canal disponible → recibir acuse cuando exista → distinguir reporte recibido de ayuda confirmada → actualizar información.
- Socio externo: recibir solicitud comprensible → aceptar con condiciones o rechazar → confirmar ejecución sin migrar toda su organización.
- Operación degradada: detectar pérdida de fuente/modelo/red → conservar estado → mostrar limitaciones → continuar lo autorizado → reconciliar al volver.

## 18. Inventario completo de entradas y tratamiento

I01–I26 conservan los identificadores del simulador. Una entrada no crea por sí sola una verdad ni una obligación.

| ID | Datos | Tratamiento obligatorio de NEXO |
|---|---|---|
| I01 | Publicaciones sociales originales | Extraer afirmaciones, necesidad explícita/indirecta, oferta, ubicación posible, tiempo e incertidumbre |
| I02 | Republicaciones, comentarios, ediciones, borrados | Mantener linaje/versiones; copias no son testigos independientes; reconciliar correcciones |
| I03 | Imagen, video y adjuntos | Procesar el medio accesible; referenciar región/fotograma/segmento; separar caption del contenido |
| I04 | Mensajes de equipo, llamadas y notas de voz | Identidad/canal/permisos; transcripción verificable; ruido, ambigüedad y fragmentos incompletos |
| I05 | Noticias y radio | Fuente original, fecha, área cubierta, afirmaciones citadas y correcciones |
| I06 | Boletines oficiales | Restricciones, evacuaciones, permisos y vigencia; autoridad no equivale a actualización perfecta |
| I07 | Inspecciones y evaluaciones de campo | Competencia del emisor, método, fecha, alcance y condiciones que invalidan la inspección |
| I08 | Necesidades declaradas | Tipo, cantidad/unidad, personas estimadas, ubicación, ventana útil, consumo y duplicados |
| I09 | Inventario | Existencia física/libre/reservada, lotes, vencimiento, mínimo retenido, ubicación y sistema de registro |
| I10 | Instalaciones | Capacidad, accesibilidad, agua, energía, saneamiento, personal, horarios, almacenamiento y dependencias |
| I11 | Vehículos y planes | Carga/peso/volumen/asientos, conductor, combustible, turnos, retorno, trayectos y compromisos previos |
| I12 | Accesos y red vial conocida | Restricciones por vehículo, cierres, reaperturas, procedencia y antigüedad; no mapa omnisciente |
| I13 | Telemetría y ETA | Posición observada, momento, precisión, pérdida de señal y estimación; llegada distinta de recepción |
| I14 | Comunicaciones | Último contacto, canales, acuses, mensajes pendientes y conectividad conocida |
| I15 | Personal | Competencias, autorizaciones, turnos, descanso, disponibilidad y localización compartida |
| I16 | Ofertas de socios | Capacidad visible, condición, duración, autoridad, reserva mínima y coste de coordinación |
| I17 | Compromisos | Identidad, versión, cantidades, plazos, estados, rechazos, expiraciones y retiradas |
| I18 | Documentos y catálogos | PDFs/tablas/especificaciones, alias, unidades, versiones, fragmentos y condiciones de uso |
| I19 | Procedimientos y prioridades | Dueño de política, ámbito, versión, presupuesto, autorizaciones y criterios de asignación |
| I20 | Respuestas a verificaciones | Confirmación, negativa, inconclusión o silencio; coste y retraso; nunca un oráculo instantáneo |
| I21 | Recepciones y servicio | Entrega parcial, cantidad, receptor, instalación, distribución, discrepancias y evidencia |
| I22 | Fondos y compras | Prometido/liquidado/comprometido/gastado/reembolsado; proveedor, pedido y plazo |
| I23 | Estado de herramientas | Error, permiso, quota, esquema, caché, última sincronización y cobertura perdida |
| I24 | Riesgo y entorno | Pronóstico, incendio, inundación, daños y alertas con incertidumbre y tiempo de publicación |
| I25 | Decisión humana | Autoridad, versión examinada, modificación, rechazo, razón y latencia real |
| I26 | Precedentes H1 | Contexto, evidencia, condiciones y resultado pasado; revalidación local obligatoria |

### 18.1 Sobre común y reglas de almacenamiento

Registrar: ID estable, organización/ámbito, fuente y versión, URI o referencia recuperable, hash de contenido, idioma, formato, fragmento, momento declarado del hecho, publicación, disponibilidad, descarga y procesamiento. Añadir resolución/ambigüedad geográfica, vigencia, permisos, retención y origen de cada transformación.

No inventar un momento del hecho si se desconoce. Mantener unidades originales y normalizadas con método de conversión. Distinguir desconocido, no aplicable, cero y sin permiso. Los nombres ambiguos producen candidatos, no coordenadas precisas ficticias.

La adquisición es automática donde existe un conector permitido. Los reportes manuales complementan esa cobertura; no son un requisito oculto para que alguien copie cada publicación al sistema. La UI debe mostrar el origen automático/manual y el alcance real del conector.

Una corrección o borrado modifica disponibilidad y uso futuro según políticas; la evidencia histórica se conserva solo en el alcance permitido, con marca de revocación/borrado cuando corresponda. No prometer retención perpetua de todo contenido público.

## 19. Inventario de salidas, acciones y efectos

| ID | Salida/acción | Condición y prueba principal |
|---|---|---|
| O01 | Registrar afirmación/caso | Evidencia vinculada; no altera el mundo físico |
| O02 | Relacionar o separar reportes | Fusiones reversibles, linaje, contradicciones; comprobar falsos merges |
| O03 | Marcar material dudoso/antiguo/contradicho | Razón y evidencia; no suprimir automáticamente toda necesidad asociada |
| O04 | Consultar herramienta | Permiso, presupuesto, plazo y resultado versionado; timeout explícito |
| O05 | Solicitar comprobación | Responsable, canal, coste, demora y posible respuesta inconcluyente |
| O06 | Proponer alternativas | Dependencias, alcance, incertidumbre, coste de oportunidad y condiciones |
| O07 | Revisar/autorizar/modificar/rechazar | Identidad humana, versión, ámbito, caducidad y evidencia examinada |
| O08 | Consultar capacidades de socios | Solo información compartida; ausencia de respuesta no es aceptación |
| O09 | Ofertar/reservar/confirmar/liberar | Propietario, concurrencia, TTL, condiciones y auditoría |
| O10 | Transferir/prestar | Aprobaciones bilaterales, transporte físico y eventual devolución |
| O11 | Preparar/despachar ayuda | Revalidar autorización, recursos y condiciones; orden recibida antes de ejecutar |
| O12 | Proponer/enviar cambio de recorrido | Posición conocida, autoridad, entrega de orden y coste de lo ya recorrido |
| O13 | Coordinar reparación/inspección | Equipo competente, acceso, material, permiso y tiempo real |
| O14 | Activar instalación/servicio | Inspección vigente, dependencias físicas, personal y autorización |
| O15 | Coordinar evacuación/distribución | Responsable, capacidad, destino utilizable, accesibilidad y recepción |
| O16 | Solicitar compra/reposición | Presupuesto liquidado, proveedor, plazo, pedido y recibo; no stock instantáneo |
| O17 | Compartir actualización | Campo/organización autorizados, versión, vigencia y revocación |
| O18 | Corregir/retirar conclusión | Preservar historial y notificar decisiones dependientes |
| O19 | Reparar/cancelar operación | Conservar compromisos válidos, costes hundidos y carga real |
| O20 | Preparar/publicar transparencia | Proyección pública aprobada, agregación y evidencia de los hitos |
| O21 | Señalar cobertura insuficiente | Proponer verificación/canal alternativo; no inventar una necesidad confirmada |
| O22 | Abstenerse/degradarse/actuar parcialmente | Explicar qué falta, siguiente revisión y coste de esperar |
| O23 | Registrar resultado/precedente | Resultado observado y límites de aplicación; H1 opcional |

Toda orden con efectos externos necesita identificador, versión, actor autorizado, correlación de caso/plan, precondiciones, plazo, idempotencia y acuse. El texto generado no ejecuta una acción por sí mismo. Un timeout de escritura obliga a consultar su estado antes de repetirla con otro ID.

## 20. Modelo de dominio, estados e invariantes

### 20.1 Entidades mínimas

| Entidad | Datos y relaciones necesarias |
|---|---|
| Organización, usuario, rol, delegación | Ámbito, autoridad, turnos, preferencias y política de intercambio |
| Emergencia y zona | Tiempo, geometría conocida, responsables, objetivos y política vigente |
| Fuente y observación | Conector, versión, contenido, permisos, tiempos y referencia de evidencia |
| Afirmación | Qué se afirma, sobre qué, evidencia favorable/contraria y estado epistemológico |
| Necesidad | Servicio/tipo, cantidades, ventana, población estimada, ubicación, incertidumbre y cobertura |
| Capacidad y recurso | Propietario, especificación, cantidades, reservas, ubicación, restricciones y sistema principal |
| Investigación | Pregunta, hipótesis, consultas, presupuesto, evidencia recibida y condición de parada |
| Propuesta | Versiones, alternativas, dependencias, efecto previsto, condiciones y responsables |
| Autorización | Actor, alcance, versión exacta, caducidad, razón y snapshot de evidencia |
| Compromiso | Oferta/lease, cantidades, condiciones, propietario, versión y vencimiento |
| Operación y tarea | Plan autorizado, recursos físicos, instrucciones, acuses y etapas |
| Recepción y servicio | Receptor, cantidad, calidad/estado, uso efectivo, pendientes y discrepancias |
| Movimiento financiero | Importe/unidad, proveedor, liquidación, vínculo agregado y conciliación |
| Publicación | Vista aprobada, procedencia, estado operativo, fecha y correcciones |
| Ejecución/evaluación | Run, versión, modelo, herramientas, coste, reloj, conjunto de pruebas y resultados |

No hace falta una base de grafos para empezar. Las relaciones y versiones pueden vivir en tablas relacionales; lo obligatorio es poder recorrer dependencias y reconstruir una decisión.

### 20.2 Máquinas de estado separadas

    Evidencia: recibida → interpretada → pendiente/contrastada/contradicha → caducada/retirada
    Investigación: en cola → activa → esperando herramienta/persona → concluida/abandonada/fallida
    Propuesta: borrador → comprobaciones → lista para revisar → autorizada/rechazada/revisión requerida
    Compromiso: ofrecido → reservado → confirmado → cumplido/liberado/retirado/expirado
    Ejecución: orden preparada → enviada → recibida → carga → viaje → llegada → recepción → servicio
    Pago: iniciado → pendiente → liquidado/fallido → conciliado/reembolsado

Las ramas parciales, bloqueadas y canceladas son explícitas. No asignar un solo estado a todo un plan si sus partes están en situaciones diferentes. Un despacho directo autorizado sigue siendo posible según política; debe registrar autoridad, aunque no provenga de una recomendación de Gemini.

### 20.3 Invariantes de aceptación

- Ningún compromiso consume dos veces la misma disponibilidad. No stock, dinero, camas o personal negativos.
- Reserva de stock, disponibilidad de vehículo y turno de personal se comprueban conjuntamente.
- La autorización vincula una versión; un cambio material invalida o reabre lo necesario.
- Idempotencia de comandos y consumidores; un mensaje repetido no duplica compra, pago, viaje ni reserva.
- La llegada no acredita recepción y la recepción no acredita automáticamente servicio sostenido.
- La información compartida no concede autoridad sobre los recursos del remitente.
- El estado público nunca avanza por delante del estado operativo acreditado.
- Las correcciones no reescriben la evidencia que tuvo el responsable al decidir.
- El agente no obtiene credenciales humanas, observador del simulador ni archivos privados de evaluación.
- Un evento retrasado no sustituye una versión más reciente; se conserva como evidencia histórica.
- La pérdida de conectividad no crea consentimiento ni confirma una orden pendiente.
- Si un servicio requiere mantenimiento, personal, energía o reposición, su beneficio termina o cambia cuando dejan de estar disponibles.

## 21. Diseño funcional de la inteligencia

### 21.1 Ciclo controlado por eventos

    Fuentes → normalización → afirmaciones/casos → investigaciones priorizadas
                       ↓                         ↓
                 cobertura y vigencia       herramientas permitidas
                                                  ↓
                 restricciones y alternativas ← evidencia nueva
                               ↓
                 propuesta → revisión → compromisos → ejecución
                               ↑                          ↓
                      cambios y reparación ← resultado/observaciones

La orquestación puede contener varios agentes o un trabajador con funciones especializadas. Su número no es una métrica de innovación. Separar interfaces y presupuestos antes que crear microservicios por cada rol narrativo.

### 21.2 Responsabilidades lógicas

1. Ingestor: cursores, versiones, formatos, deduplicación técnica y conectores.
2. Intérprete: afirmaciones sustentadas, entidades, idioma, unidades, ubicación y contradicciones.
3. Investigador: hipótesis, siguiente consulta útil, evidencia faltante y parada.
4. Compositor: combina capacidades, genera alternativas y solicitudes condicionadas.
5. Validador determinista: cantidades, rutas conocidas, presupuesto, capacidad, permisos y cronograma.
6. Coordinador transaccional: reservas, aprobaciones, versiones y acuerdos; sin autoridad inventada por un LLM.
7. Monitor de dependencias: detecta qué cambió y solicita una revisión acotada.
8. Redactor público: explica solo los datos aptos para publicación y propone borradores.

### 21.3 Contrato de una investigación

Entrada: pregunta operativa, caso, evidencia autorizada, herramientas disponibles, contexto temporal, presupuesto y política. Salida estructurada: hipótesis consideradas, comprobaciones observables, referencias, restricciones, alternativas, incertidumbres, siguiente acción permitida y razón breve.

Cada llamada registra modelo/versiones/configuración, IDs de fuentes y herramientas, hash de entradas, respuesta guardada en el ámbito permitido, validación del esquema, latencia, tokens, coste y fallos. La memoria de trabajo por caso no sustituye los registros persistentes.

Detener o ceder cuando: hay propuesta suficientemente comprobada según política; la siguiente consulta no justifica demora/coste; se agota presupuesto; falta autoridad; no hay opción viable; una persona necesita decidir; o cambia el caso. Permitir acción parcial autorizada sin esperar a resolver toda la investigación.

Los presupuestos son por investigación, organización y emergencia: llamadas, tokens, herramientas, verificaciones humanas, tiempo y concurrencia. Probar bucles repetidos, reintentos e investigaciones que se reactivan sin cambios materiales. Una cola priorizada impide que el ruido consuma toda la capacidad.

### 21.4 Qué hace una propuesta suficientemente buena

Debe responder: beneficio concreto; recursos y responsables; inicio/fin esperado con incertidumbre; precondiciones comprobadas; pendientes; riesgos y efectos sobre otras operaciones; evidencia; permisos; vigencia; alternativa parcial y condición de cancelación. Las estimaciones no se muestran como garantías.

Comparar al menos una alternativa factible cuando exista y explicar por qué otra opción relevante se descarta. Si solo hay una, decirlo; no fabricar variedad. Las herramientas numéricas resuelven restricciones formalizadas; Gemini aporta interpretación y selección de investigación sobre información heterogénea.

### 21.5 Generalización e innovación exigidas

No resolver S01 leyendo su nombre o palabras clave de fixtures. En evaluación, ocultar IDs diagnósticos y recetas del escenario; permitir solo observaciones públicas y propias. Reconocer recursos descritos para otra finalidad, investigar incompatibilidades, construir un servicio completo y repararlo en combinaciones nuevas. Incluir casos donde una regla sencilla es suficiente y resulta más barata.

H1 solo se añade después de C1–C7: recuperar patrones con precondiciones, contrastarlos y medir transferencia negativa frente a recuperación simple. No llamarlo entrenamiento automático ni inteligencia acumulada verificada si solo se almacenan resúmenes.

## 22. Cómo hacer visible a Gemini sin simular pensamientos

### 22.1 Estado visible y honesto

Mostrar actividad real respaldada por eventos del backend. Ejemplos de etiquetas nativas para la futura UI en inglés:

- Queued — waiting for an available worker.
- Reading new reports — 18 new source versions.
- Checking a dependency — awaiting the vehicle owner's response.
- Comparing feasible options — capacity and delivery windows checked.
- Ready for your review — one condition still needs authorization.
- Updating this proposal — a partner withdrew a resource.
- Unable to continue — inventory source unavailable.

Una espera de una persona no se representa como inferencia activa. Un resultado servido desde caché/replay se identifica en el laboratorio. No dibujar porcentajes de progreso si no conocemos un denominador real.

### 22.2 Lenguaje visual

En la fila del caso: estrella o acento azul/violeta, pulso suave mientras existe trabajo activo, verbo concreto, tiempo transcurrido y siguiente dependencia. El coral señala una necesidad o cambio que requiere atención; no se usa como sentencia de falsedad. Texto e icono sostienen el significado sin depender del color.

Al abrir detalle: una tarjeta fija con tres zonas breves: evidencia relevante → comprobación en curso → consecuencia para la propuesta. El contenido cambia sin desmontar el panel, mover el foco, alterar tipografía ni hacer saltar botones. Mostrar una actividad actual y dos hitos recientes; historial completo desplegable.

    GEMINI · Checking transport availability        8 s
    Source: Team report, 10:32                      [Open]
    Check: Can the return trip carry 300 L?
    Status: Waiting for the resource owner.
    ----------------------------------------------------
    Previous: Current shelter occupancy confirmed.
    [Activity and evidence]                 [Pause inquiry]

Las colas animadas de fuentes son una vista opcional de exploración, con ventana finita, pausa y contador del resto. La pantalla operativa principal muestra solo cambios relevantes. Movimiento reducido ofrece exactamente la misma información estática; lector de pantalla recibe un resumen acotado, no cientos de anuncios por segundo.

### 22.3 Explicaciones que sí aportan confianza

Exponer preguntas planteadas, herramientas llamadas, hechos contrastados, límites, alternativas descartadas y motivo breve de una recomendación, con referencias. Se pueden generar resúmenes de justificación anclados en esas trazas. No fabricar monólogos, atribuir al modelo pensamientos privados ni reproducir cadenas internas como evidencia de corrección.

Prueba de aceptación: cada estado visual corresponde a un evento real y los resultados no aparecen antes que la herramienta. Una persona puede identificar si el sistema está procesando, esperando autorización, bloqueado o terminado sin abrir detalles. El destello Gemini no indica que una propuesta esté autorizada ni sea verdadera.

## 23. Sistema de experiencia: jerarquía, navegación y carga cognitiva

### 23.1 Arquitectura de información

Tres superficies: workspace operativo, experiencia móvil de campo y portal público. Administración y auditoría se abren desde el workspace según permisos. La landing explica el producto; no se reutiliza su scroll narrativo para aprobar operaciones. El laboratorio tiene identidad y sesión distintas.

Navegación operativa: Response, Cases, Proposals, Operations, Resources, Network. Public updates, Sources, Reports y Settings son utilidades secundarias según rol. Selector persistente de organización y emergencia. Búsqueda transversal con ámbito visible; guardar filtros y enlaces a una versión concreta.

### 23.2 Presupuesto visual por pantalla

- Una pregunta principal y una acción primaria por panel. Acciones destructivas/materiales separadas y claras.
- Cabecera corta con título, estado, responsable y última actualización. Nada de cuatro subtítulos diciendo lo mismo.
- De tres a cinco elementos prioritarios inicialmente visibles; el resto está en una lista paginada/virtualizada con filtros. Es una decisión inicial de diseño que se verifica con usuarios, no un límite al número de casos.
- Un solo panel contextual expandido por defecto. Fuentes completas, logs y condiciones secundarias bajo demanda; una contradicción crítica permanece visible.
- No convertir cada dato en una tarjeta. Usar tablas para comparar cantidades, cronologías para etapas y mapa para relaciones espaciales.
- No reordenar el elemento que alguien está leyendo cuando llega información. Contador de nuevos cambios y actualización explícita; avisar de una invalidación importante sin cambiar la acción bajo el cursor.
- Distinguir urgente, importante, sin información y técnicamente fallido. La severidad no se deriva de viralidad.
- Mostrar el delta respecto de la versión revisada: qué cambió, qué conserva validez y qué debe volver a aprobarse.
- Las notificaciones tienen destinatario, caso, razón y posibilidad de reconocimiento, agrupación y escalado. No usar avisos duplicados por cada repost.

### 23.3 Accesibilidad y funcionamiento degradado

Teclado completo, foco visible/restaurado, etiquetas accesibles, tamaños legibles y contraste medido. Estados comprensibles sin color. Zoom al 200%, pantallas 1440×900 y 1920×1080, portátil bajo, móvil de 390 px y modo reducido de movimiento. Tablas ofrecen columnas prioritarias y detalle, no texto diminuto para caber.

Mapa con alternativa de lista. El pulso no es una alerta sonora obligatoria. Audio con transcripción y error visible; video con referencia temporal y descripción. Fecha/hora/unidades localizadas preservando el valor original. UI de entrega en inglés natural; pruebas incluyen contenido de fuentes multilingües y ubicación temporal ambigua.

En conexión degradada: última sincronización, datos posiblemente caducados, acciones guardadas y acciones realmente recibidas. Las reservas offline no se confirman globalmente hasta reconciliar. Mantener borradores y evitar pérdida silenciosa al cerrar o recargar.

## 24. Especificación página por página del workspace

### UX01 — Configuración y preparación de la organización

Objetivo: una organización puede empezar con sus propias fuentes, sin tener cuatro socios ya conectados.

Flujo progresivo: identidad y responsables → zonas/tipo de respuesta → fuente externa → herramienta operativa → permisos y política → comprobación de funcionamiento. Mostrar por paso conexión exitosa, datos de ejemplo realmente recibidos, frecuencia, coste conocido y límites. Credenciales solo en backend; nunca mostrarlas en trazas.

Ofrecer importación de inventario si no hay integración, con validación de unidades y responsable. Distinguir datos iniciales manuales de sincronización permanente. Una fuente inaccesible produce un fallo accionable, no un inventario vacío aparentemente válido. Probar reanudación de configuración incompleta y revocación.

### UX02 — Centro de respuesta

Pregunta: «¿Qué necesita una decisión mía ahora y cómo está avanzando la respuesta?»

    Flood response / North region                 Updated 20 s ago
    Needs attention          Active operations          Coverage gaps
    ----------------------------------------------------------------
    Shelter water supply     Response ready for review       [Review]
    East community           No recent contact              [Inspect]
    Delivery 104             Access changed                 [Review]
    ----------------------------------------------------------------
    Map or list                         Current operational summary
    [Needs] [Resources] [Operations]     Received / in transit / pending

Filtrar por ámbito/turno/competencia. Ordenar según política aprobada y cambios relevantes; mostrar motivo. No convertir el centro en un dashboard de métricas vanidosas: señales procesadas no ocupa más jerarquía que ayuda pendiente. La cobertura distingue zonas sin datos, necesidades conocidas y operaciones.

Estados: sin emergencia, sin fuentes, ingesta pendiente, todos los casos atendidos, fuente caída, datos antiguos, sobrecarga y pérdida de conexión. Un cero solo aparece si es un cero conocido.

Aceptación: usuario nuevo identifica una necesidad, su responsable y siguiente acción; entiende una zona desconocida; no pierde contexto al recibir cien eventos.

### UX03 — Caso y dossier de evidencia

Pregunta: «¿Qué se necesita, qué sabemos y qué falta?»

Cabecera: lugar con precisión, servicio, cantidad/unidad/rango, población estimada, ventana útil, responsable y estado. Cuerpo: hechos relevantes, incertidumbre crítica, actividad de Gemini y propuesta relacionada. Pestañas secundarias: Evidence, History, Related operations.

    Los Sauces shelter / Water
    Current need: quantity awaiting local confirmation
    Last field report: 10:15
    -------------------------------------------------
    Known: the shelter remains occupied.
    Uncertain: water currently available on site.
    Gemini: checking partial supply and a return trip.
    [Review proposal]        [Request verification]
    Evidence (12 originals, 87 reposts)  ▾

Fuentes agrupadas por origen y afirmación, con vista original; temporalidad y contradicciones explícitas. Fusión/separación con previsualización de operaciones afectadas y opción de deshacer la clasificación. No alterar entregas físicas al separar casos; reconciliar atribución sin duplicar demanda.

Aceptación: usuario localiza la evidencia favorable y contraria, distingue inferencia de confirmación y corrige un lugar ambiguo sin leer todos los mensajes. Reabrir un enlace muestra la versión elegida, avisando de una más reciente.

### UX04 — Investigación y comparación de propuestas

Pregunta: «¿Qué podemos hacer ahora y qué consecuencia tiene elegirlo?»

Una recomendación principal y acceso a alternativas. Resumen de cuatro puntos: beneficio, plazo, condiciones pendientes y compromiso requerido. Al comparar: filas comunes de servicio, tiempo, recursos, efecto sobre otras operaciones y fiabilidad de datos; no párrafos largos en columnas idénticas.

    Proposed response / Temporary shelter
    Building       Inspection pending
    Water          Conditional offer from Team B
    Staff          Confirmed shift
    Transport      Available after existing delivery
    -------------------------------------------------
    Unlocks: additional usable shelter capacity.
    Still needed: inspection and resource-owner approval.
    [Prepare approvals]            [Compare alternatives]

La tarjeta de actividad de §22 acompaña el trabajo, pero cede protagonismo a la decisión cuando termina. Evidencia expandida conserva el contexto de la alternativa. Propuesta no viable mantiene explicación y posible siguiente acción; no botón engañoso de aprobar todo.

Aceptación: operador puede explicar por qué una opción es viable y otra no; reconoce coste de oportunidad, modifica condiciones y solicita una comprobación específica. Una alternativa nueva no hereda aprobación de otra.

### UX05 — Revisión y autorización

Pregunta: «¿Qué estoy comprometiendo exactamente?»

Mostrar recursos/tiempo/presupuesto, operación afectada, precondiciones, pendientes, autoridad, expiración y cambio desde última revisión. Aprobación por conjunto solo cuando todas sus consecuencias son legibles y pertenecen al ámbito del aprobador; permitir revisar excepciones individuales.

Botones: Authorize, Modify, Request clarification, Decline. Confirmación adicional proporcional al impacto; evitar diálogos redundantes para cualquier clic. Distinguir autorización condicionada de permiso de ejecución inmediato. Retirada posterior conserva trazabilidad y consecuencias.

Aceptación: bajo cambios simultáneos, el backend rechaza versiones caducadas y la UI explica el delta. Medir comprensión, tiempo, errores y aprobaciones automáticas por hábito. Nunca medir éxito solo por menos clics.

### UX06 — Operación en curso

Pregunta: «¿Dónde está la ayuda y qué impide que llegue a ser útil?»

Cronología: authorized → reserved → prepared → instruction received → loading → in transit → arrived → received → service. Mostrar etapas aplicables, parciales y fallidas. Mapa operativo con posición reportada/edad; no interpolar una posición real si solo existe GPS antiguo.

    Delivery 104                        Owner: Dispatch team
    ✓ Authorized  ✓ Loaded  ● In transit  ○ Received  ○ Service
    Change: main access reported closed.
    Alternative prepared; driver has not received it.
    [Review change]      [Contact responsible team]

Entrega parcial, mercancía dañada, receptor ausente, destino no operativo y cancelación tienen flujos explícitos. Cambios no materiales pueden notificarse; cambios de alcance/destino/cantidad requieren revisión según política. Registrar pérdida, devolución y costes hundidos.

Aceptación: comparar lo autorizado, lo comunicado y lo ejecutado. Una orden pendiente no mueve un vehículo en la vista ni cuenta como ayuda recibida.

### UX07 — Recursos, capacidades e instalaciones

Pregunta: «¿Qué podemos comprometer realmente y con qué restricciones?»

Tabla filtrable por tipo, ubicación, propietario, disponible/reservado, vigencia y sistema de registro. Al abrir: especificaciones, turnos, mínimos, permisos, compromisos, historial y dependencias. Una instalación es un servicio con requisitos, no solo un icono geográfico.

Editar stock local con evidencia o conciliar discrepancia; cuando manda una herramienta externa, preparar cambio y esperar aceptación. Vistas de necesidades en camino para evitar duplicaciones sin ocultar déficit futuro. Probar lotes caducados, préstamo vencido, vehículo sin conductor y cantidad en unidades ambiguas.

### UX08 — Red y compromisos compartidos

Pregunta: «¿Qué respuesta adicional podemos construir juntos y qué ha confirmado cada uno?»

Mostrar organizaciones independientes y contribución concreta; visualización pequeña de dependencias, acompañada de tabla accesible. Separar oferta, reserva y compromiso confirmado. Cada nodo tiene responsable, última respuesta y restricciones de divulgación. La red no es un chat de agentes.

    Joint response / Open a temporary shelter
    Team A: building          Awaiting inspection
    Team B: sanitation        Reserved until 14:30
    Team C: staff             Confirmed
    Team D: transport         Owner reviewing
    -------------------------------------------------
    Next blocker: inspection result, assigned to …
    [View conditions]      [Review your contribution]

Mostrar qué partes pueden avanzar independientemente y cuáles deben esperar. Socios externos tienen su canal de confirmación. Expirar/rechazar un compromiso actualiza únicamente dependencias pertinentes. Detectar ciclos de condiciones y proponer orden de confirmación sin simular atomicidad mundial.

### UX09 — Publicaciones y finanzas

Vista de trabajo para comunicaciones: borrador → revisión → publicación → corrección, con previsualización exacta del portal y explicación del origen de cada cifra. Ocultar automáticamente detalles no publicables antes de generar el texto. Configurar agregación geográfica y supresión de grupos pequeños cuando revelen identidades.

Finanzas: prometido, recibido/liquidado, comprometido, gastado y reembolsado; conciliación de webhooks y documentos. No mezclar dinero con unidades físicas. La organización define el canal de pago; el laboratorio usa créditos y pagos sandbox. Probar pago fallido/duplicado, reembolso y compra parcial.

### UX10 — Fuentes, salud y auditoría

Fuentes: catálogo de conectores, cobertura, permisos, última sincronización, retraso, errores y acción de reparación. Indicar qué casos dependen de una fuente caída. Auditoría: búsqueda por caso/recurso/decisión, reconstrucción temporal y exportación acotada con permisos. Métricas técnicas son para responsables correspondientes, no permanentes en cada pantalla del operador.

Administrador: accesos, revocaciones, presupuesto de inferencia, retención, políticas, reservas mínimas, intercambio y versiones. Evaluación y verdad del simulador nunca aparecen en este menú de producción.

## 25. Experiencia de campo y comunidad

### UX11 — Campo móvil

Una tarea actual, instrucciones breves, lugar/precisión, contacto, carga y última actualización. Botones grandes para confirmar lectura, salida, llegada, problema y recepción. Cámara/nota de voz opcionales para reducir escritura. Una confirmación de recepción muestra cantidad y receptor, no solo un gran botón «Done».

    Current task / Deliver supplies
    Destination: Los Sauces
    Load: 300 L          Last instruction: 10:42
    [Directions]         [Report a problem]
    [Departed]           [Confirm receipt]
    Offline · 2 updates waiting to sync

Cola local durable con IDs; sincronización idempotente y conflictos visibles. Un reporte urgente puede sugerir canal alternativo disponible. El equipo conserva sus procedimientos cuando NEXO no está disponible; no se borran tareas o pruebas de entrega.

Aceptación: flujo completo con pérdida de internet antes/después de una confirmación, reinicio del móvil, orden nueva mientras está offline y posterior reconciliación. No mostrar «recibido por coordinación» hasta acuse real.

### UX12 — Persona/comunidad afectada

Entrada opcional breve: lugar aproximado, tipo de necesidad, información disponible y medio de contacto si desea proporcionarlo. Admitir audio/imagen sin requerir un relato escrito. Mostrar «reporte recibido» distinto de «respuesta confirmada». Evitar repetir preguntas que la fuente ya contiene; pedir aclaración específica y necesaria.

La ingesta social y otros canales continúan siendo relevantes para quien no usa este formulario. Si un canal no se supervisa continuamente, indicarlo. La plataforma no puede prometer atención de emergencia instantánea ni reemplazar canales locales sin acuerdo operativo.

## 26. Experiencia pública y confianza comprobable

### UX13 — Portal de una respuesta

Primera vista: emergencia, organización responsable, prioridad actual y forma oficial de apoyar. Después, una cronología visual simple. Usar iconos más texto; coral para apoyo pendiente, azul/violeta para actividad, recepción con confirmación explícita. Pulso suave solo en estados activos, sin fingir movimiento logístico.

    Flood response / Organization …
    Support needed: supplies and temporary shelter
    [Contribute through the organization]
    -------------------------------------------------
    In transit       Supplies for three shelters
    Received         Two centres confirmed delivery
    Next             Expand usable shelter capacity
    [Progress and use of funds]

Cada hito tiene fecha y estado de confirmación; fotos de suministros se identifican con su operación y momento. Los datos públicos son una proyección revisada y minimizada, nunca un acceso directo a la base operativa. Publicar correcciones y pendientes con tanta claridad como avances.

No sugerir al público comprar/enviar medicamentos o artículos por su cuenta. El apoyo económico se agrupa para necesidades cambiantes. Si el proveedor admite aportaciones restringidas, mostrar condiciones reales y no prometer reasignación que no esté autorizada.

### UX14 — Contribución y seguimiento

Redirigir a un proveedor autorizado o integrar su checkout; NEXO no almacena tarjetas. Estados: iniciado, pendiente, liquidado, fallido y reembolsado, con conciliación. El recibo de la aportación es financiero; el seguimiento de la respuesta es agregado. No convertir una donación en una garantía de compra/entrega individual.

Aceptación con personas: identificar quién recibe fondos, distinguir envío/recepción/servicio, explicar qué financia la aportación y reconocer lo que sigue pendiente. Medir confianza informada, comprensión y errores. Un aumento de clics o autoconfianza no demuestra honestidad ni incremento de donaciones reales.

## 27. Red entre organizaciones: protocolo y fallos

Primera implementación local: cuatro instancias/ámbitos aislados y un socio no NEXO, con permisos configurables. Una instancia debe completar su ciclo con fuentes propias; conectar la red añade oportunidades, sin ser una condición de arranque.

Contrato compartido: ID global, versión de esquema/entidad, emisor, organización, destinatario/ámbito, correlación, tiempo observado/publicado, vigencia, tipo, referencias autorizadas y estado. Identidad verificada por transporte/servidor; el contenido no puede declararse dueño de otra organización.

Protocolo de compromiso propuesto:

1. Consultar capacidad permitida sin reservarla.
2. Recibir oferta con cantidades, restricciones, responsable y vencimiento.
3. Solicitar reserva temporal al propietario; conflicto devuelve alternativas.
4. Reunir condiciones y aprobaciones por cada propietario.
5. Confirmar partes compatibles y determinar cuáles pueden ejecutarse.
6. Despachar mediante sistemas responsables; recibir acuses y resultados.
7. Compensar/liberar reservas no utilizadas ante rechazo o vencimiento; registrar lo irreversible.

El sistema no promete una transacción distribuida instantánea. Usar coordinación por pasos con compensaciones, leases y ledger del propietario. Resolver dependencias circulares con condiciones preparables, plazos y revisión; no saltarse autorización para evitar un bloqueo.

Pruebas: mensajes duplicados/reordenados, dos solicitudes simultáneas, pérdida durante confirmación, aceptación parcial, caída de un coordinador, revocación de acceso, propietario offline, TTL, reaparición de una versión antigua, préstamo no devuelto, renovación denegada y socio sin API. Recuperación debe reconstruir el estado desde registros durables.

La ventaja colectiva se compara contra los mismos actores que sí pueden coordinarse convencionalmente. Separar beneficio de compartir datos, beneficio de Gemini y beneficio del protocolo de compromisos.

## 28. Conectores y acceso al mundo real

### 28.1 Registro obligatorio por conector

Fuente/producto, responsable, lectura/escritura real, permiso/términos/licencia, esquema/versiones, IDs, cursores, frecuencia, límites, coste, cobertura geográfica/idioma, última prueba, credenciales, retención y fuente de autoridad. Estado: propuesto, sandbox, probado con datos reales o operativo; nunca mostrar «integrado» por tener un logo.

API/exportación/feeds autorizados son vías iniciales. Scraping cuando esté permitido y disponible; no cobertura universal de X ni canales privados abiertos. Comprobar borrados, acceso revocado, rate limit, cambio de esquema, duplicados y gaps de paginación. Un error no se interpreta como cero necesidades.

### 28.2 Integraciones prioritarias

- Laboratorio: HTML y API pública, inbox/estado propios, consultas asíncronas, acciones, recibos de ingesta e inferencia.
- Una fuente humanitaria o pública real de lectura, por ejemplo IFRC GO o HDX HAPI, tras verificar alcance. Contexto público no equivale a inventario privado en tiempo real.
- Un sistema operativo de inventario/logística, inicialmente adaptador local documentado; una integración real debe probar el circuito de confirmación.
- Documentos, reportes y medios reales autorizados para medir interpretación, con anotación independiente.
- Canales de campo y socios: notificación, recepción y respuesta, con demoras y fallback.
- Proveedor de pagos sandbox y proyección pública, sin dinero real necesario para la evaluación inicial.

No afirmar que LogIE tiene una API de escritura o reservas sin verificarlo. Integrarlo donde aporte contexto/logística; la propuesta es cooperación con sistemas existentes.

### 28.3 Sincronización y propiedad

Un recurso tiene un sistema principal. NEXO refleja estado, prepara acciones y espera confirmación de ese sistema. Resolver conflictos con versión y conciliación; nunca mantener dos disponibilidades contradictorias tratadas como actuales. Cada conector necesita pruebas de contrato y un conjunto de ejemplos de fallo reproducibles.

## 29. Arquitectura local de desarrollo e integración

### 29.1 Componentes propuestos

| Responsabilidad | Implementación local inicial | Contrato para migración |
|---|---|---|
| UI operativa, campo y portal | Aplicación web responsive/PWA, servidor local | HTTP; rutas y proyecciones por rol |
| API y dominio | Servicio contenedorizado con módulos de dominio | OpenAPI/JSON Schema, identidad y versión |
| Investigaciones | Workers separados del request HTTP | Jobs durables, presupuesto, resultado estructurado |
| Estado operativo | PostgreSQL local | Migraciones, transacciones, aislamiento por organización |
| Cola/eventos | Outbox PostgreSQL + worker con lease inicialmente | At-least-once, acuse, reintento, deduplicación y dead-letter |
| Evidencia | Volumen local mediante interfaz de objetos | Clave/hash/metadatos/permisos; adaptador cloud posterior |
| Identidad | Proveedor OIDC local o sesiones locales de desarrollo | Verificación server-side; roles separados de identidad |
| Trazas y métricas | Logs estructurados + OpenTelemetry/export local | Correlación, redacción, coste y exportación |
| Modelo | Proveedor configurable: fixtures/replay o Gemini real | Tools, validación de salida, tiempos y coste |
| Integraciones | Adaptadores HTTP/MCP delimitados | Mismos permisos y reglas en local/cloud |
| Simulador | Servicio aparte y evaluator aislado | Gateway de organización, nunca estado privado |

Son elecciones de implementación propuestas; no requieren instalar todo ahora. Un monolito modular con workers separados basta para comenzar. No añadir Redis, un vector store o una base de grafos sin una necesidad demostrada. Un servicio local equivalente no implica identidad de semántica con el servicio cloud; ejecutar pruebas de conformidad al migrar.

### 29.2 Tres modos del proveedor de modelo

1. Offline fixtures: respuestas predefinidas para desarrollo de UI/contratos, marcadas como simuladas.
2. Replay: entradas/salidas y tiempos de una ejecución previamente registrada; reproduce, no vuelve a inferir.
3. Gemini real desde backend local: requiere conexión y credenciales del proveedor, coste y latencia reales. Es el modo que puede demostrar la contribución de Gemini.

Ejecutar contenedores en local no convierte Gemini en un modelo instalado en el equipo. Los tests offline no se acreditan como resultados GenAI. Cualquier otro modelo local sirve para pruebas de adaptadores y se identifica por separado.

### 29.3 Fronteras del laboratorio

El servidor NEXO solo recibe credenciales de su organización. Sesiones humanas utilizan autoridad de comandante/operador limitada, distinta de la del agente. No pasar la clave omnisciente del observador a NEXO para habilitar un botón de aprobación. El simulador actual admite inyección de actorKeys, pero su configuración por defecto genera agentes; falta formalizar el aprovisionamiento humano limitado para este recorrido.

El evaluador controla semillas, reloj, verdad y métricas; NEXO no monta sus volúmenes, checkpoints, escenarios ocultos ni archivos de etiquetas. La UI 3D del observador no es una interfaz que deba leer el agente. Documentar un comando/Compose que inicia dependencias, migra DB, carga organización de prueba y conecta por URL configurable al laboratorio, sin credenciales en Git.

### 29.4 Persistencia y recuperación

Guardar decisiones y outbox en una transacción, publicar después, consumir idempotentemente. Jobs con lease, timeout, cancelación y reanudación. Estado de investigación persistente; procesos reiniciados no repiten compromisos. Evidencias con hash y referencias estables. Separar proyección pública de tablas privadas; comprobar permisos también en consultas y herramientas, no solo en navegación.

Pruebas de reinicio entre autorización/reserva/despacho, respuesta de herramienta perdida, almacenamiento lleno, fallo de DB y recuperación desde backup. Definir RPO/RTO de prueba antes de medir; inicialmente exigir cero pérdida de transacciones confirmadas y recuperación local reproducible en un objetivo de cinco minutos bajo el hardware declarado.

## 30. Requisitos no funcionales y controles de calidad

### 30.1 Integridad y autorización

AuthN/AuthZ en servidor y herramientas; aislamiento por organización; roles humanos/agente separados; revocación comprobada. Entradas externas no modifican instrucciones, permisos o destinos de exfiltración. Sanitizar HTML/adjuntos, limitar tamaños, evitar ejecución de contenido, validar esquemas y limitar URLs de herramientas según alcance. Probar prompt injection, identidad suplantada, referencias ajenas, IDs adivinados y contenido que solicita credenciales.

Una acción rechazada por falta de autoridad es un control exitoso, no necesariamente un incidente operativo. Medir por separado intentos inválidos y acciones indebidas realmente ejecutadas. Cero violaciones observadas en una batería concreta no equivale a una garantía absoluta de seguridad.

### 30.2 Rendimiento y fiabilidad

Carga nominal propuesta: cuatro organizaciones, 100 necesidades concurrentes heterogéneas, 10.000 publicaciones por hora, dos operadores por organización y mezcla declarada de tareas. No implica 100 soluciones completas por minuto. Escalar luego organizaciones, necesidades, publicaciones y tamaño del mapa de forma independiente.

Objetivos iniciales en hardware declarado: p95 de interacción local no bloqueante menor de 200 ms; confirmación durable de comando menor de 2 s sin contar dependencia externa; actualización de estado procesado visible en menos de 2 s; ingesta de fuente disponible a registro durable p95 menor de 5 s en esa carga. Medir por separado el polling configurado de cada fuente: si es de 60 s, no anunciar ingesta total de 5 s.

La investigación no tiene una promesa universal de milisegundos. Reportar cola, inferencia, herramientas y espera humana individualmente. Establecer presupuesto inicial por investigación de 60 s de trabajo automático y hasta ocho llamadas de modelo; ajustar en piloto antes de sellar evaluación. Una espera humana puede durar más y se informa como tal. Parar/repriorizar al agotarse presupuesto; la política puede autorizar otro presupuesto explícito.

Load shedding conserva señales en cola durable o declara pérdidas; no presume procesamiento exitoso. Backpressure, prioridades, límites por organización y canal de revisión manual para urgencias. Si cae Gemini, casos, evidencia, compromisos y órdenes vigentes siguen accesibles.

### 30.3 Privacidad, publicación y mantenimiento

Compartir mínimo necesario; preservar licencias y permisos de medios; no publicar personas, ubicaciones sensibles o documentos completos por defecto. Auditar accesos y cambios de permisos. Definir retención, borrado y redacción por fuente; proteger backups y trazas igual que datos operativos. Procedimientos de actualización, rollback y exportación de datos de la organización.

### 30.4 Condiciones duras para cerrar una versión

Ninguna prueba puede mostrar una reserva doble consumada, acción física sin autoridad, fuga de verdad del evaluador, filtración entre organizaciones, publicación adelantada al resultado o pérdida silenciosa de una transacción confirmada. Si ocurre, corregir y repetir las pruebas afectadas antes de anunciar ventaja. Un promedio rápido no compensa estas fallas.

## 31. Diccionario de KPIs y objetivos de mejora

### 31.1 Reglas de medida

Los siguientes umbrales son metas iniciales de ingeniería e impacto propuestas por este documento. No son resultados, estándares humanitarios ni umbrales que garanticen ganar. Se revisan con operadores y piloto, y se congelan ANTES del conjunto final. Si se cambian después, la evaluación anterior no se recicla como prueba confirmatoria.

Todos los KPIs tienen: ID, definición/unidad, población/denominador, reloj, horizonte, exclusiones justificadas, baseline, segmentación, responsable de instrumentación y artefacto reproducible. Reportar cantidades absolutas además del porcentaje. Reducción = (referencia − NEXO) / referencia para costes/demoras; si referencia es cero, usar diferencia absoluta y no inventar porcentaje. Aumento de cobertura se expresa en puntos porcentuales, no como si fuera reducción relativa.

El evaluador calcula necesidad y servicio desde verdad oculta; NEXO calcula sus estados conocidos. Mantener ambas capas. No dejar que el candidato cambie el denominador borrando necesidades, fusionándolas, reduciendo cantidades o dejando de reportar. Necesidades recurrentes generadas por consumo requieren métricas de déficit sobre cohortes fijas y análisis de denominadores endógenos; un recuento de tickets puede cambiar por la propia política.

### 31.2 KPIs de impacto y coordinación

| ID | Definición y unidad | Objetivo inicial / qué debe demostrar |
|---|---|---|
| K01 | Integral de demanda no atendida por servicio: suma sobre comunidades de integral max(0, demanda efectiva − servicio útil), en L·h, plazas·h u otra unidad propia; alternativamente déficit persona·hora con umbral explícito | Primario en la familia elegida: reducción puntual ≥20% frente a baseline competente; IC95 de mejora con límite inferior ≥10%. Mantener resultados separados por tipo de servicio |
| K02 | Tiempo desde aparición física de necesidad hasta primer servicio útil y hasta nivel suficiente sostenido durante ventana definida | Reducción ≥25% de mediana en casos comparables, sin empeorar p95 ni cobertura; incluir no atendidos/censurados, no medir solo entregas exitosas |
| K03 | Necesidades/cohortes elegibles atendidas dentro de su ventana útil / todas las elegibles con ventana observable | Mejora ≥10 puntos porcentuales frente a referencia en conjunto definido; no contar propuesta, llegada o ventana futura como atención |
| K04 | Servicio colectivo efectivo: plazas·h, L producidos/utilizados u otro resultado que necesita aportes de varios propietarios | Ventaja frente a compartir datos + coordinación competente con mismos recursos; objetivo ≥10 puntos de cobertura o ≥20% menos déficit en escenarios de complementariedad predefinidos |
| K05 | Exceso recibido no utilizable en horizonte y faltantes por tipo; informar también desperdicio, retorno y redistribución | Menos exceso sin empeorar déficit/tiempo; objetivo ≥25% menos exceso cuando baseline tiene exceso material. Stock de reserva aprobado no se etiqueta desperdicio |
| K06 | Duplicación perjudicial: recursos comprometidos/entregados a demanda ya cubierta, descontando reservas previstas | Cero dobles consumos transaccionales; reducir duplicaciones logísticas sin cancelar ayuda por incertidumbre infundada |
| K07 | Desde cambio accesible hasta propuesta reparada válida y hasta recuperación del servicio; trabajo válido conservado | ≥30% menos demora de reparación frente a replanificación de referencia; sin cancelar más trabajo útil ni ocultar costes hundidos |
| K08 | Déficit, cobertura y demoras por grupos silenciosos/remotos y zonas con menos conectividad | Regla de no inferioridad predeclarada; meta inicial no perder >5 puntos de cobertura por grupo con precisión suficiente. Si el IC no descarta ese daño, resultado inconcluso |
| K09 | Km, combustible, horas de vehículo/personal y gasto por unidad útil recibida o servicio sostenido | Informar trade-offs; mayor rapidez no se vende como eficiencia de recursos si consume mucho más. Definir límite operacional con responsables |
| K10 | Continuidad: duración de servicio útil, interrupciones y demanda que reaparece | Un refugio abierto un instante no cuenta como servicio sostenido. Mantener capacidad durante la ventana comprometida o registrar fallo |

K01 y K03 serán las medidas principales de la primera familia; K02 explica el mecanismo temporal. Fijar orden de hipótesis y corrección por múltiples comparaciones si se hacen inferencias confirmatorias sobre varias medidas. No crear un índice mezclando litros, camas y dinero para elegir el resultado favorable.

### 31.3 KPIs de Gemini, información y generalización

| ID | Definición y unidad | Objetivo / prueba |
|---|---|---|
| K11 | Recall de necesidades accionables accesibles antes de una ventana y latencia hasta detección útil | Aumento frente a reglas/extracción sin explosión de falsas alertas; medir necesidades y no solo posts. Meta piloto recall ≥90% en corpus anotado con cobertura conocida |
| K12 | Afirmaciones importantes sustentadas por fuente vigente; precisión de enlace evidencia–afirmación | Meta ≥95% en conjunto revisado independientemente; publicar denominador, casos ambiguos y tipos de error. No puntuación autodeclarada por Gemini |
| K13 | Falsas confirmaciones, falsos descartes de necesidades reales y fusiones incorrectas, por gravedad | Guardrails específicos; un video fuera de contexto no justifica descartar una necesidad vigente. Medir ambas clases, no maximizar «fake news detectadas» |
| K14 | Rendimiento de investigación: consultas que cambian la viabilidad/elección de una respuesta ejecutada, coste y demora por cambio útil | Menos consultas inútiles que consultas indiscriminadas; demostrar casos donde investigar evita un error y casos donde se detiene a tiempo |
| K15 | Aporte de NEXO: diferencia en K01/K03 frente a extracción + planificador y agente general con mismo Gemini, herramientas y presupuesto | Meta ≥10% de mejora relativa en K01 frente al agente general, con IC95 favorable, en tareas complejas selladas. Si no existe, revisar diferenciación o declarar el empate |
| K16 | Propuestas ejecutables: pasan validadores, consiguen permisos y producen servicio / propuestas revisadas | Informar embudo completo; propuesta formalmente válida distinta de autorizable y útil. Rechazos humanos tienen causas, no se cuentan todos como error del modelo |
| K17 | Cobertura real de ingesta: disponibles, descargadas, aceptadas, interpretadas, vinculadas y accionables, por versión | Recibos completos y trazas; «interpreted» requiere evaluación externa de una tarea, no basta el acknowledgement |
| K18 | Transferencia: diferencia de resultados entre desarrollo y mapas/composiciones/idiomas/distribuciones no vistos | Mantener ventaja primaria en holdout estructural; reportar caída, fallos y límites. Si solo funciona con frases de los presets, no se cumple |
| K19 | Percepción multimodal: extracción y localización de evidencia en audio/imágenes/video reales autorizados | Suite real separada; medidas por modalidad, ruido, idioma y ambigüedad. Las descripciones del simulador no cuentan como prueba de visión/transcripción |

Un estado «confirmado por fuente» no es una probabilidad universal. Si se muestran scores, definir qué estiman y calibrarlos con etiquetas independientes; de lo contrario usar estados, evidencias y razones, sin falsa precisión.

### 31.4 KPIs humanos, públicos y de sistema

| ID | Definición | Meta inicial / evidencia |
|---|---|---|
| K20 | Minutos humanos por necesidad correctamente resuelta, incluyendo lectura, verificaciones, aprobación y corrección | Reducción ≥25% frente a flujo de referencia con errores no inferiores; no esconder trabajo en otro rol |
| K21 | Éxito de tareas y comprensión de condiciones/autoridad/incertidumbre | ≥90% de tareas críticas completadas correctamente; ≥90% identifica condición pendiente y alcance de autorización en ejercicio definido |
| K22 | Cola humana: espera p50/p95, máximo backlog y decisiones vencidas | A carga nominal no crecer indefinidamente; recuperación tras burst dentro del presupuesto declarado. Medir revisores finitos |
| K23 | Comprensión pública: quién recibe dinero, qué se confirmó y qué sigue pendiente | ≥90% identifica correctamente esos tres puntos en pruebas; confianza informada, sin promesa de aumento real de donaciones |
| K24 | Latencias de fuente, cola, modelo, herramienta, revisión, orden/acuse y ejecución | Presupuestos §30; percentiles y fallos. No sumar tiempos concurrentes como si fueran seriales ni omitir esperas |
| K25 | Coste real por episodio, investigación y resultado útil; coste incremental por unidad de mejora | Integrar tarifa/versiones, tokens, herramientas, infraestructura y tiempo humano por separado; presupuesto fijado antes de evaluación, datos de fallos incluidos |
| K26 | Integridad y recuperación | Cero violaciones de §30.4 en suites; prueba de reinicio, deduplicación, permisos y pérdida de conectividad |
| K27 | Escala con calidad | Curvas a 1/4/12 organizaciones y 10/100/1.000 necesidades cuando hardware permita; registrar punto donde latencia/calidad degrada, sin prometer soporte si no se prueba |
| K28 | Accesibilidad/estabilidad UI | Recorridos críticos completos por teclado/móvil/movimiento reducido; cero saltos de contexto y pérdida de borradores en pruebas |
| K29 | Adopción y acceso | Integraciones reales accesibles, restricciones revisadas, ejercicios con operadores y objeciones resueltas; no reducirlo a una encuesta de «te gusta» |
| K30 | H1 opcional: transferencia de precedentes | Mejora frente a recuperación simple y tasa de transferencia negativa; nunca exigencia adicional para cerrar C1–C7 |

K25 no tiene un precio universal fijado por intuición: en piloto registrar coste de referencia y presupuesto aceptable B por organización/hora y por servicio, con responsable y fecha. La evaluación no se inicia con B vacío. Objetivo: mantener K01/K03 dentro de B y mostrar curva coste–resultado; una mejora que exceda B se presenta con su trade-off.

Para K20/K21, fijar taxonomía de error antes del ejercicio: crítico (autoridad inválida, destino/cantidad que hace inviable la operación, condición esencial ignorada) y no crítico (demora o corrección menor). Gate inicial: cero errores críticos observados en la suite, sin interpretarlo como riesgo cero poblacional; margen propuesto para errores no críticos de +2 puntos porcentuales con IC unilateral que lo descarte. Revisar el margen con operadores en piloto y aumentar muestra si la precisión no basta. No declarar no inferioridad por ausencia de significación en una muestra pequeña.

Los objetivos de comprensión ≥90% son proporciones observadas acompañadas de intervalos y tareas/participantes; una ronda formativa de cinco personas no permite concluir por sí sola esa tasa poblacional. La prueba de carga nominal requiere además un manifest que concrete mix de formatos, tamaños, duración, frecuencia de cambios, fallos, quota del proveedor y capacidad de operadores. Sin ese manifest no se pueden comparar dos cifras de throughput.

### 31.5 Censura, equidad y lectura correcta

Si un episodio acaba antes de resolver una necesidad, conservarla como pendiente/censurada. Un plazo futuro todavía no es incumplido. Reportar tiempos restringidos al horizonte o métodos de supervivencia apropiados junto a cobertura; no omitir fallos del cálculo de rapidez. Evaluar métricas de tiempo desde aparición y desde primera señal accesible por separado: NEXO no puede percibir una señal que aún no existe, pero puede investigar cobertura ausente.

Medir saldo entre beneficiados y desplazados; impedir que una mejora agregada oculte retrasos en otro refugio. Subgrupos pequeños muestran incertidumbre y recuentos, no porcentajes concluyentes. No convertir automáticamente minutos ahorrados en vidas salvadas. Bajas simuladas son exploratorias bajo supuestos y análisis de sensibilidad; el claim principal es servicio y déficit reducido.

## 32. Diseño de experimentos para atribuir la mejora

### 32.1 Referencias y ablaciones obligatorias

| Brazo | Qué contiene | Qué pregunta responde |
|---|---|---|
| B0 | Operadores competentes con procedimientos/herramientas existentes, comunicación permitida | ¿Mejora frente al trabajo que realmente podría hacerse? |
| B1 | Ingesta, reglas y planificador convencional, sin LLM | ¿El valor viene solo de automatizar y ordenar datos? |
| B2 | Gemini extrae/normaliza + mismo planificador y ejecución | ¿Investigar y componer aporta más que extracción? |
| B3 | Agente general competente con mismo Gemini, herramientas, contexto autorizado y presupuestos | ¿El diseño de NEXO añade valor a un agente capaz? |
| B4 | NEXO completo por organización, coordinación convencional disponible | ¿Una instancia aporta valor por sí sola? |
| B5 | Mismas organizaciones NEXO compartiendo datos, sin coordinación avanzada | ¿Basta con una base compartida? |
| B6 | NEXO completo en red, compromisos y reparación | ¿C1–C7 producen ventaja colectiva adicional? |

No exigir B0 humano para miles de ejecuciones: obtener ejercicios reales para calibrar una referencia automatizada y declarar esa aproximación. Los controladores actuales del simulador no satisfacen por sí solos B0–B3. La etiqueta `general` de una política scripted tampoco significa agente Gemini general.

Ablaciones dirigidas: sin investigación activa; sin deduplicación semántica; sin política de cobertura silenciosa; sin composición; sin reparación incremental; sin agrupación de revisiones; sin red. Cambiar un componente cada vez cuando se busque atribución. Dar a referencias reglas y optimizadores bien afinados, no versiones deliberadamente débiles.

### 32.2 Equidad experimental

Igual dotación inicial, mapa, demanda exógena, desastres, personal, conectividad, canales permitidos y acceso potencial a fuentes. Igualar presupuestos de inferencia/herramientas para B2/B3/B6 y registrar consumo real. Las referencias pueden compartir información y coordinarse; no se les prohíbe usar el teléfono para que NEXO gane.

Relojes y transporte comparables: HTTP/polling/quotas de fuentes para todos o latencia equivalente declarada. El controlador interno actual lee `publicFeed` directamente; para una prueba de scraping extremo a extremo debe pasar por el mismo gateway o imputar limitaciones equivalentes verificadas.

Los operadores de cada brazo ven solo sus observaciones. El evaluador tiene la verdad para medir, no para aconsejar. Preservar rechazos, cancelaciones, accidentes operativos, timeouts y presupuestos agotados. Episodios excluidos requieren razón predefinida; mostrar cuántos y por qué.

### 32.3 Separación de conjuntos

- Desarrollo: fixtures públicos S01–S24, pruebas unitarias y exploración.
- Piloto: estimar varianza, coste, parámetros operativos y tamaño muestral; ajustar producto y preregistro.
- Validación: comprobar generalización antes de congelar candidato.
- Evaluación final sellada: mapas, combinaciones, recursos, horarios, fuentes y redacciones no vistos, preparados fuera del alcance del candidato.

No basta reservar variantes de texto dentro de la misma plantilla. Ocultar solución implícita, nombres diagnósticos, IDs del escenario y metadatos de verdad. Probar contraejemplos: retorno vacío sin permiso, edificio disponible no seguro, generador incompatible, noticia reciente sobre evento viejo, misma frase con unidad distinta.

Plan inicial de dimensionamiento: piloto de cinco a diez semillas por familia; final de al menos treinta mundos emparejados por familia principal, ajustando antes del sellado según potencia/precisión y coste. No es un número mágico de significación. Repetir llamadas/episodios estocásticos con varias réplicas en una muestra predefinida y usar análisis jerárquico por mundo; miles de tweets del mismo mundo no son miles de muestras independientes.

### 32.4 Relojes y determinismo

Live: mundo a ×1 con latencia real de Gemini, herramientas y humanos. Modeled: latencia declarada/distribución calibrada y barrera explícita; sirve para escala y sensibilidad. Replay: acciones/respuestas ya registradas; sirve para reproducción y depuración. No mezclar resultados de estos modos en una estimación de velocidad real.

Semilla + configuración completa + build del motor/contenido + entradas registradas permiten replay. Misma semilla no obliga a que dos políticas produzcan el mismo futuro: entregas y reportes endógenos cambian por sus decisiones. Un nuevo llamado a Gemini puede variar aun con temperatura baja. Registrar versión/configuración del modelo y respuestas, no prometer inferencia determinista por seed.

### 32.5 Análisis y reporte

Congelar primaria, márgenes de no inferioridad, horizonte, unidades, presupuestos, exclusiones y método antes del test. Comparaciones emparejadas por mundo con intervalos apropiados; bootstrap agrupado por mundo cuando hay réplicas. Mostrar distribuciones, p50/p95, pérdidas y ganancias, no solo promedio. Usar corrección o jerarquía de hipótesis para múltiples pruebas y separar exploratorio de confirmatorio.

Analizar sensibilidad a demanda, disponibilidad, demora humana, fallos de fuente, proporción de rumores, topología, tiempos de preparación, conectividad y consumo. Repetir resultados principales con el modelo de mortalidad desactivado. Si cambia el ganador al variar supuestos plausibles, describir la dependencia y reducir el claim.

No modificar el simulador al ver que el candidato pierde salvo corregir un defecto documentado, versionar y repetir TODOS los brazos afectados. El evaluador final no debe pertenecer al contexto accesible de quien ajusta prompts durante esa evaluación.

## 33. Plan de pruebas y criterios de aceptación

### 33.1 Capas de prueba

| Capa | Qué debe cubrir | Artefacto |
|---|---|---|
| Dominio/unidad | Estados, cantidades, vencimientos, permisos, versiones, prioridades, unidades y dependencias | Tests deterministas y fixtures mínimos revisables a mano |
| Propiedades | Conservación, idempotencia, orden temporal, no doble asignación y aislamiento | Generación aleatoria de secuencias con semillas reproducibles |
| Contratos | Todos los I01–I26/O01–O23, errores, schemas y adaptadores | Contratos versionados, ejemplos positivos/negativos y compatibilidad |
| Integración | Fuente real HTTP → evidencia → herramienta → autorización → ejecución | Logs correlacionados y estado persistido |
| Gemini | Extracción, investigación, alternativas, abstención y revisión en datos ocultos | Corpus anotado, resultados repetidos, modelos/prompts/presupuestos fijados |
| Extremo a extremo | UI de cada rol + backend + simulador + consecuencia física | Evidencia de pasos, confirmaciones y métricas independientes |
| Resiliencia | Caídas, red intermitente, cuotas, reinicio, duplicados y rollback | Fault injection y reconstrucción del estado |
| Carga | Volumen simultáneo, cola, CPU/RAM/disco, tokens, coste y personas | Perfiles y curvas de degradación; hardware y límites |
| UX/accesibilidad | Tareas correctas, comprensión, rechazo, campo offline, público | Protocolo, registros consentidos, errores y cambios de diseño |
| Realismo/adopción | Restricciones revisadas con especialistas y acceso a fuentes | Registro de supuestos, objeciones, autorizaciones y cambios |

### 33.2 Pruebas P0: antes de confiar en una operación

| ID | Prueba | Condición de aceptación |
|---|---|---|
| T01 | De publicación a servicio | Señal descargada por HTTP, evidencia, propuesta, autorización identificada, orden recibida, entrega y servicio observables |
| T02 | Aislamiento | Otro tenant y el agente no pueden ver datos privados, claves humanas, verdad del simulador ni archivos de evaluación |
| T03 | Fuente maliciosa | Documento intenta cambiar instrucciones/divulgar secretos/autorizar; herramientas lo impiden y la necesidad legítima sigue evaluable |
| T04 | Cantidades/concurrencia | Solicitudes simultáneas de stock, camas, conductor y dinero mantienen invariantes; reintentos no duplican efectos |
| T05 | Autorización caducada | Cambio de destino/cantidad/condición genera revisión; aprobación anterior no se reutiliza silenciosamente |
| T06 | Retraso/desconexión | Vehículo sigue la orden realmente recibida; lo pendiente se sincroniza sin teletransporte ni doble confirmación |
| T07 | Evidencia contradictoria | Video antiguo y petición real coexistentes; se corrige el video sin descartar automáticamente la necesidad |
| T08 | Corrección y reparación | Retirada/cambio afecta dependencias correctas; preserva trabajo válido y costes físicos |
| T09 | Llegada y servicio | Llegada sin descarga/instalación/personal no cuenta como servicio; parcialidad se conserva |
| T10 | Reinicio | Caer tras autorizar, reservar o enviar no pierde estado ni repite comandos confirmados |
| T11 | Publicación | No se publica recepción por tener un envío; borrador excluye datos privados; corrección trazable |
| T12 | Medición | Test manual de fórmulas, plazos futuros, casos censurados, cero denominador, unidades y comparación de igual configuración |

### 33.3 Pruebas P1: para sostener la contribución competitiva

| ID | Prueba | Resultado exigido |
|---|---|---|
| T13 | C1 composición nueva | Servicio que requiere capacidades complementarias descubierto sin receta en entrada y efectivamente prestado |
| T14 | C2 compromisos | Ofertas condicionadas, aceptación parcial, ciclos/TTL, rechazo, retirada y recuperación sin autoridad central inventada |
| T15 | C3 investigación | Identifica una comprobación decisiva entre distractores; también detiene una investigación costosa o inviable |
| T16 | C4 competencia global | 100 necesidades heterogéneas compiten; se respetan mínimos y efectos sobre otras comunidades |
| T17 | C5 reparación | Misma perturbación comparada con replanificación completa; medir demora, trabajo preservado y servicio |
| T18 | C6 atención humana | Misma carga y operadores; agrupación reduce esfuerzo sin aumentar aprobaciones erróneas |
| T19 | C7 autonomía/red | Una instancia útil, varias con mejora adicional, socio externo y conexión intermitente; casos sin ganancia incluidos |
| T20 | Generalización | Holdout estructural, idiomas, mapas y capacidades desconocidas mantiene ventaja o expone límites |
| T21 | Multimodalidad real | Audio/fotos/video/documentos permitidos con etiquetas independientes; no sustituir medios por captions perfectos |
| T22 | Baselines | B0–B6 y ablaciones bajo condiciones comparables; resultados y fallos incluidos |
| T23 | Cobertura y equidad | Comunidad silenciosa, rumor viral y fuente caída; déficit de grupos poco visibles no queda escondido |
| T24 | Economía y escala | Coste/token/cuota/revisión/carga dentro de presupuesto; comprobar degradación y operación manual |
| T25 | UX por rol | Recorridos §17, condiciones §23–26 y KPIs K20–K23/K28 con personas |
| T26 | Datos reales | Al menos una fuente real de lectura y procedimiento operativo revisado; distinguir prueba de concepto de despliegue de campo |
| T27 | Arquitectura local/cloud | Contratos portables, posterior despliegue limpio GCP, mismo smoke test end-to-end |

### 33.4 Extensiones P2

H1/memoria, nuevos tipos de servicio y conectores adicionales se incorporan con beneficio medible. No iniciar una extensión para compensar que T13–T24 todavía no acreditan el núcleo. Un agente autónomo adicional no evita la necesidad de pruebas.

### 33.5 Prueba numérica pequeña que debe poder revisarse a mano

Crear un mundo de cuatro necesidades, dos vehículos y dos propietarios, cantidades conocidas y ventanas cortas. Registrar todas las decisiones y calcular manualmente integral de déficit, cobertura a tiempo, stock reservado/en tránsito/recibido y horas humanas. Incluir una necesidad con plazo posterior al final del episodio y una entrega parcial. El evaluador debe coincidir exactamente con el cálculo. Después comprobar monotonicidad: acortar una demora logística sin cambiar otras condiciones no debe aumentar mágicamente recursos; más lecturas no alteran aleatoriedad física; duplicar una orden con el mismo ID no duplica ayuda.

## 34. Matriz de escenarios → capacidades → KPIs → demostración

Los fixtures existentes representan situaciones y mecanismos; deben complementarse con una política externa real que los resuelva o rechace correctamente. «El escenario corre sin romper invariantes» y «NEXO resolvió este problema» son pruebas distintas.

| Escenario | Comportamiento de NEXO a evaluar | Evidencia/KPIs |
|---|---|---|
| S01 retorno vacío | Detectar capacidad implícita, revisar turno/carga/permiso y completar entregas | K01–03, K14–16; trazas y recepción física |
| S02 refugio | Descubrir y reunir requisitos, inspección competente, autorización y servicio sostenido | C1/C2; K04/K10, plazas·h utilizadas |
| S03 planta | Comprobar especificación, préstamo, transporte, instalación, personal y producción finita | C1/C3; K04/K09/K10 |
| S04 video antiguo | Contrastar origen/tiempo y mantener evaluación de necesidad actual | K12/K13; ninguna etiqueta del evaluador llega al agente |
| S05 incendio | Adaptar respuesta al acceso/amenaza cambiante con órdenes demoradas | K02/K07/K08, personas que realmente llegan a destino utilizable |
| S06 réplica | Invalidar inspección previa y revisar operaciones dependientes | T05/T08/T09; K07 |
| S07 comunidad silenciosa | Detectar gap y priorizar comprobación útil por otro canal | K08/K11/K14, coste de verificación |
| S08 reposts | Conservar linaje, no multiplicar demanda y evitar fusionar incidentes distintos | K06/K12/K13 |
| S09 competencia | Elegir asignaciones globalmente compatibles y explicar desplazamientos | C4/C6; K01/K03/K20/K22 |
| S10 partición | TTL, permiso, versiones, reserva y reconciliación | C2/C7; K26, ningún doble consumo |
| S11 retirada | Reparación parcial con trabajo en marcha y costes hundidos | C5; K07/K09 |
| S12 orden no recibida | Estado comunicado distinto de mundo físico | K24/K26; orden/acuse separados |
| S13 reconexión | Procesar burst sin sobrescribir conocimiento fresco ni saturar operadores | K17/K22/K24 |
| S14 llegada sin servicio | Resolver descarga/instalación/recepción y medir necesidad pendiente | K01/K02/K10 |
| S15 desequilibrio | Considerar envíos en curso, reservas, necesidades cambiantes y consumo | K01/K05/K06, no cancelación infundada |
| S16 fuente hostil | Mantener límites de herramientas y permisos bajo contenido malicioso | T02/T03; K26 |
| S17 herramienta caída | Reintentos limitados, alternativa/manual y estado preservado | K24/K25/K26 |
| S18 imposible | Reconocer restricciones, acción parcial y parada de investigación | K14/K16/K25; no soluciones fabricadas |
| S19 cuatro organizaciones | Servicio colectivo con contribuciones autónomas y quinto socio externo | C1/C2/C7; K04/K15, mismos recursos que referencia |
| S20 fondos | Liquidación, compra, recepción parcial y transparencia agregada | T11, K23/K26, ledger financiero |
| S21 fuente cambia | HTML/API, schema, borrado/revocación y versiones | K17/K24/K26 |
| S22 ambigüedad | Consultar lugar/unidad/tiempo sin inventar precisión | K12/K13/K14 |
| S23 referencia suficiente | Evitar investigación innecesaria; reportar empate o pérdida | K15/K25, control negativo |
| S24 precedente | Revalidar precondiciones y detectar analogía equivocada | H1/K30 opcional |

Cada familia principal tiene variantes con solución, con solución parcial, con contradicción decisiva y sin solución viable. Combinar familias en holdout: por ejemplo retirada + partición + refugio inseguro + rumor viral. Mantener un oráculo de restricciones/factibilidad únicamente para evaluador en mundos pequeños, no como información accesible al modelo.

## 35. Qué tiene ya el simulador y qué le falta

La revisión del 12 de octubre de 2026 se documenta en [AUDITORIA_SIMULADOR.md](AUDITORIA_SIMULADOR.md). Se inspeccionó código, contratos, métricas, políticas, documentación y tests del commit `6980dda`; se ejecutaron 108 tests con éxito y `pnpm check` (62 módulos, 26 entradas, 23 acciones, 360 presets). No se ejecutó Gemini ni se volvió a auditar visualmente el visor 3D en esta revisión.

Existe una base causal sólida: desplazamiento real, tráfico, reservas, personal finito, instalaciones compuestas, eventos de desastre, conectividad, fuentes HTML/JSON, permisos por organización, evaluador y replay. Es suficiente para empezar a integrar NEXO. No está completo como instrumento de validación final de todas las afirmaciones.

Pendientes centrales: corregir medición de plazos; ampliar latencias desde necesidad y cobertura censurada; referencias competentes fuera de agua; integración externa con Gemini; credenciales humanas limitadas; medios reales; holdout independiente; trazabilidad de interpretación; métricas de coste/innovación/reparación/UX; calibración operacional; protocolos entre procesos; pruebas con operadores y público. La mortalidad simulada no sustituye esos resultados.

No rehacer el simulador por estética ni añadir física que NEXO no perciba o pueda influir. Añadir mecanismos solo si cambian observaciones, restricciones, acciones o consecuencias que una hipótesis del producto necesita evaluar. Mapas enormes y miles de objetos no reemplazan diversidad de decisiones.

## 36. Paquete de evidencias y límites de cada afirmación

### 36.1 Registro de claims

Cada afirmación pública obtiene ID, redacción exacta, ámbito, versiones, conjunto de datos, comparador, KPI, estimación/intervalo, fallos, límites y ruta a artefactos. Estados: hipótesis, implementado, verificado funcionalmente, medido en simulación, revisado con usuarios, probado en campo. No saltar de implementado a impacto demostrado.

| Claim | Prueba mínima para poder decirlo |
|---|---|
| Procesa información dispersa | Descargas reales, versiones, corpus anotado, cobertura, errores y tiempos |
| Investiga mejor | Consulta cambia respuesta; ventaja frente a extracción/consulta indiscriminada con presupuesto igual |
| Construye respuestas colectivas | Servicio conjunto físicamente activo frente a referencia competente con mismos recursos |
| Acelera la ayuda | K01–K03 medidos hasta servicio, no solo propuesta; casos pendientes y tiempos humanos incluidos |
| Se adapta a cambios | Perturbación no ensayada, reparación y continuidad con costes hundidos |
| Funciona a escala | Perfil declarado, calidad bajo carga, coste y cola humana; no solo FPS o número de posts |
| Mejora la confianza | Personas entienden fuente, estados, dinero y límites; investigación humana apropiada |
| Ayuda a proteger vidas | Objetivo y mecanismo operativo explicados; no conversión automática de minutos a muertes evitadas |
| Aprende entre desastres | H1 implementado y ventaja de transferencia medida, incluida transferencia negativa |
| Se despliega en un clic | Instalación probada en proyecto limpio con prerrequisitos explícitos |

### 36.2 Artefactos por ejecución

Manifest completo; seed y streams; versión motor/contenido/candidato/modelo/prompts/herramientas; política y presupuesto; modo de reloj; condiciones iniciales; entradas/salidas registradas; trazas de investigación; decisiones humanas; ledger de compromisos; operaciones y recibos; errores/reintentos; datos KPI; informe estadístico; hash; hardware; coste; exclusiones y estado completed/failed/cancelled. Evidencia privada permanece fuera de los repositorios de candidatura.

### 36.3 Validación que no puede producir el simulador

Revisión de procedimientos y rangos por personas de logística/emergencias; ejercicios de mesa con roles reales; prueba de comprensión pública; acceso efectivo a APIs/medios; acuerdo de compartir capacidades; aceptación del coste de integración y uso; disposición a usar el producto en su flujo.

Plan inicial: al menos dos perfiles con experiencia operativa revisan mecanismos/rangos y dos organizaciones potenciales contrastan autoridad e intercambio. Para UX, rondas formativas de cinco a ocho participantes por experiencia principal, informando que son muestras pequeñas; dimensionar validación cuantitativa según precisión deseada. Registrar objeciones y cambios, no solo testimonios positivos. No contactar ni enviar mensajes a terceros automáticamente por existir este plan.

### 36.4 Diferenciación frente a herramientas existentes

Actualizar una matriz basada en documentación o pruebas verificables: ingesta, interpretación, investigación activa, composición, compromisos, reparación y autonomía. Marcar desconocido cuando no hay evidencia. LogIE, IFRC GO, Ushahidi y productos similares pueden ser complementos o referencias parciales. No atribuirles ausencia de funciones por no verlas en una landing.

La contribución candidata es el mecanismo C1–C7 y sus resultados, no «usar Gemini» o «tener varios agentes». Una contribución publicable requeriría además pregunta investigable, benchmark reproducible, método, baselines, análisis de fallos y límites; no se promete un paper por el tamaño del software.

## 37. Secuencia de construcción y puertas de salida

| Fase | Construir | Condición para avanzar |
|---|---|---|
| F0 | Política inicial, contratos, corpus, KPIs, registro de supuestos y baseline | Fórmulas revisadas, T12 y defectos P0 del evaluador resueltos |
| F1 | Stack local, identidad, DB, outbox, fuente HTTP y trazabilidad | Reinicio/aislamiento/ingesta funcionan sin datos omniscientes |
| F2 | Una organización: interpretación, caso, investigación, propuesta y aprobación | T01 completo hasta servicio; Gemini real comparado con B1/B2 |
| F3 | Composición C1/C3 y competencia C4 | Servicio nuevo viable, alternativas y costes de oportunidad medidos |
| F4 | Red C2/C5/C7, socios y particiones | Reservas consistentes, reparación y autonomía con pruebas de fallo |
| F5 | Campo, recursos, comunicaciones, portal y pagos sandbox | Recorridos por rol y estados físicos/financieros correctos |
| F6 | C6, carga, resiliencia, multimodalidad y datos reales | Presupuestos/KPIs humanos, rendimiento, permisos y coste medidos |
| F7 | Holdout sellado, baselines competentes y sensibilidad | Informe completo que sostenga o refute los claims sin seleccionar solo éxitos |
| F8 | Migración a GCP y prueba limpia | Mismos contratos/invariantes y circuito real desplegado |

La fase local no tiene que implementar todos los conectores comerciales, todas las profesiones ni todos los países. Sí debe cerrar el ciclo y las limitaciones relevantes para los claims seleccionados. Ampliar alcance implica actualizar contratos, simulador, baseline, UX y métricas, no solo añadir un botón.

## 38. Definición de terminado y revisión de la rúbrica

| Criterio oficial | Lo que necesita estar probado para una candidatura fuerte | Evidencia de cierre |
|---|---|---|
| Technical Merit & Gen AI Implementation · 40% | Gemini contribuye de manera incremental; servicios consistentes, integraciones, límites y escala | B1/B2/B3 vs NEXO, T01–T24, trazas/costes, fallos, despliegue |
| Problem Alignment & Impact · 25% | Ayuda efectiva y cobertura mejoran bajo restricciones relevantes para usuarios | K01–K10, pruebas externas de procedimientos y alcance de datos |
| Innovation & Creativity · 25% | Composición/investigación/reparación generalizan y superan alternativas competentes | C1–C7, B3/B5/B6, holdout y análisis de mecanismos |
| User Experience & Solution Design · 10% | Cada rol puede actuar correctamente bajo carga y entender límites | UX01–UX14, K20–K23/K28, campo offline y accesibilidad |

No sumar artificialmente los KPIs para anunciar 100/100. El jurado decide cómo valora la evidencia y los competidores. Cumplir este documento cerraría objeciones técnicas y operativas identificadas; no demuestra que no exista una propuesta mejor.

### 38.1 Gate del producto

- [ ] C1–C7 implementados con una instancia útil y una red adicional.
- [ ] Todos los flujos obligatorios tienen versión feliz, parcial, rechazada, fallida y recuperación.
- [ ] Las pruebas P0 están verdes y no quedan incidentes graves abiertos.
- [ ] Gemini actúa sobre datos/herramientas y muestra actividad real; toda conclusión importante tiene evidencia.
- [ ] Operadores pueden comprender, modificar y rechazar sin perder contexto ni autoridad.
- [ ] Campo y público reciben estados correctos, accesibles y apropiados para su rol.
- [ ] La configuración de fuentes no depende de copiar manualmente cada publicación.

### 38.2 Gate de evidencia

- [ ] Métricas corregidas, cálculos manuales y clocks separados.
- [ ] Baselines competentes e iguales recursos/datos permitidos/presupuestos.
- [ ] Holdout estructural sellado, réplicas y análisis de incertidumbre.
- [ ] Mejora primaria y guardrails cumplidos, o claim limitado explícitamente si no se cumplen.
- [ ] Evidencia multimodal real y de acceso a fuentes cuando se anuncien esas capacidades.
- [ ] Validación humana y operacional documentada; límites del simulador visibles.
- [ ] Coste, saturación, fallos, pérdidas y escenarios sin ventaja incluidos.
- [ ] Cada afirmación de la landing/demo enlaza a una evidencia o sigue marcada como objetivo.

## 39. Requisitos de entrega y control del documento

Las reglas oficiales consultadas el 12 de octubre de 2026 exigen prototipo funcional con IA de Google y despliegue en Google Cloud mediante Cloud Run o Firebase, además de materiales de entrega en inglés. La validación local es una fase de desarrollo; habrá que completar el despliegue antes de presentar el prototipo como conforme. Revisar la convocatoria vigente al enviar.

Este documento interno está en español para revisión del autor. Preparar documentación, UI, código explicativo y material de entrega en inglés según el requisito de la competición. Las propuestas de muestreo, KPIs y gates de este documento son criterios internos, no requisitos adicionales de la organización del concurso.

Para cada cambio de alcance registrar: motivación, actor, entrada, salida, estado, permiso, pantalla, escenario, KPI y criterio de prueba. Actualizar la copia del repositorio del simulador y los enlaces cuando se cambie esta especificación. No modificar el histórico de una medición para hacerlo coincidir con una versión nueva.

## 40. Referencias y estado de las decisiones

- [Criterios y requisitos de AI Builder Cup](https://aibuildercup.com/themes.html), consultados el 12 de octubre de 2026.
- [API de IFRC GO](https://go-wiki.ifrc.org/en/go-api/api-overview): referencia para explorar acceso real, no integración ya desarrollada.
- [HDX HAPI](https://hdx-hapi.readthedocs.io/en/latest/getting-started/): referencia de datos humanitarios normalizados.
- Documentación y código de `disaster-response-simulator` en commit `6980dda`, especialmente `docs/API.md`, `docs/COVERAGE.md`, `docs/CALIBRATION.md`, `evaluation/metrics.mjs`, `evaluation/runs.mjs`, `adapters/reference.mjs`, `sources/server.mjs` y tests.
- [Auditoría realizada](AUDITORIA_SIMULADOR.md): evidencia, defectos reproducidos y backlog priorizado.
- [Arquitectura GCP futura](ARQUITECTURA_GCP.md): decisiones cloud y pruebas de migración, separadas del contrato funcional.

Decisiones propuestas, pendientes de validar en implementación/piloto: stack exacto de UI/API, primer conector real, modelo/versiones de Gemini, presupuestos, latencias objetivo, priorización aprobada, actor de despliegue, almacenamiento compartido o por instancia y tamaño final de evaluación. Las reglas de integridad, separación de verdad, autoridad y transparencia ya son requisitos, no decisiones optativas.
