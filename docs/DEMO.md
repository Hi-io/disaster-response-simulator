# NEXO — Guía para preparar la demo y defender la propuesta

## Estado local vigente · 13 de octubre de 2026

La comprobación temporal más reciente del simulador actualizado compara **Conventional: 44,279 min → NEXO + Gemma 4: 35,162 min**, una mejora del **20,59%**, con **24/24 necesidades atendidas por ambos** y **3,125% menos distancia y combustible** para NEXO. Es una pareja de la misma semilla, con seis llamadas reales por USD 0,00613892; las mantas tardaron más. [Resultado íntegro por recurso y límites](https://github.com/Hi-io/nexo-platform/blob/main/reports/analysis/final-two-response-closed-20261013/readout.md). La primaria de tres semillas se conserva por separado.

**Lectura operativa del mismo registro:** preparar y autorizar la ayuda pasó de **28,278 a 19,656 min (30,49% menos)**. Excluyendo ambos trayectos del envío, pero conservando coordinación, transmisión, carga y descarga: **30,295 → 21,673 min (28,46% menos)**. Son descomposiciones de los timestamps existentes; no nuevas simulaciones ni cambios de reglas. La espera previa por flota ocupada permanece incluida. [Tabla explicada: cada métrica, unidades, dirección de mejora y significado para quienes esperan ayuda](https://github.com/Hi-io/nexo-platform/blob/main/reports/analysis/final-two-response-explained-20261013/readout.md). “Food mean sufficient” es el tiempo medio hasta recibir toda la comida requerida; menos es mejor. Porciones·min y mantas·min expresan cantidad faltante × tiempo, sin equivalencias automáticas a personas o familias.

El producto funciona en local con **Gemma 4 31B mediante OpenRouter**. La atención humana finita vive dentro del motor: lectura, integración/decisión y transmisión tienen puestos, colas, duración y recibos propios. El visor permite elegir sus perfiles y muestra el trabajo recibido por organización. Terminar una tarea humana no autoriza una acción física. Las plantas exigen `water_operations` y los refugios `shelter_support`, además de evaluación física competente, permisos, suministros, transporte y turnos vigentes.

La comparación primaria de **tres semillas** dio **41,846 min para Conventional → 34,305 min para NEXO + modelo**, una mejora del **18,02%** hasta recibir ayuda suficiente; **ambos cubrieron 72/72 necesidades**. La cohorte, sus versiones y límites están en [los resultados medidos](RESULTADOS_CAPACIDAD_HUMANA.md). Son tiempos del laboratorio bajo supuestos declarados, con pérdida de paquetes y fracción silenciosa efectivas cero; no vidas salvadas ni productividad profesional medida. Esa primaria conserva su motor original: las regresiones actuales no se presentan como una nueva campaña temporal.

El objetivo de esta etapa es **demostrar una mejora sustancial del tiempo**, sin imponer un KPI numérico fijo. La verificación actual distingue **249/249 pruebas del simulador**, **31/31 regresiones de integración afectadas**, **7/7 comprobaciones del visor humano** y **5/5 casos de bytes multimedia**; estos últimos usaron tres llamadas reales y **USD 0,00053242**. Son comprobaciones funcionales. La suite completa anterior de plataforma sigue siendo **486/486** para el candidato `9b4de8b7…`, cuyos bytes no cambiaron; no se afirma una nueva ejecución completa de plataforma. [Recibo de competencias y suite](https://github.com/Hi-io/nexo-platform/blob/main/reports/verifications/facility-default-qualifications-20261013.json) · [integración afectada](https://github.com/Hi-io/nexo-platform/blob/main/reports/verifications/affected-facility-integration-20261013.json) · [visor](https://github.com/Hi-io/nexo-platform/blob/main/reports/human-profile-ui/1791891190000/result.json) · [medios](https://github.com/Hi-io/nexo-platform/blob/main/reports/runs/media-byte-1791891522255.json).

La UI operativa prioriza necesidad, estado, próximo paso y responsable; fuentes, alternativas y comprobaciones se abren bajo demanda. El público ve únicamente información agregada y aprobada. Siguen pendientes la validación con operadores y público, datos/escenarios independientes, calibración de campo, repetición con Gemini y despliegue/verificación en GCP. La historia fechada que sigue conserva su contexto; sus conteos no sustituyen este estado.

---

Documento de trabajo original · 11 de octubre de 2026. Actualización de implementación local · 12 de octubre de 2026. El guion original es una intención; el apartado 0 distingue qué puede mostrarse hoy.

Relacionados: [simulador](SIMULADOR.md) · [plataforma](PLATAFORMA.md).

## 0. Demo ejecutable de la fase local

Usar [LOCAL.md](LOCAL.md) para levantar cuatro instancias NEXO, un socio externo, el observador 3D y la red social ficticia. La plataforma utiliza **Gemma 4 31B mediante OpenRouter**. La futura identidad Gemini/GCP de la landing no cambia el modelo ni convierte una animación conceptual en una prueba.

Tres recorridos diferentes:

1. **Cadena operacional ×1:** `pnpm demo:live`. Fuente HTTP real, proveedor real, propuesta, propietario de prueba identificado, orden/acuse/transporte/descarga y recibo. Mostrar también cantidades todavía pendientes y coste. Las autorizaciones del script son un proxy; no un estudio con operadores.
2. **Composición desde una necesidad:** `node --env-file-if-exists=.env.local scripts/service-demo.mjs --from-need`. El operador selecciona una necesidad recibida de refugio, sin dar instalación ni solución. Gemma consulta un directorio conocido, pide inspección y prepara aportes de cuatro propietarios. El sistema exige cada aprobación y sigue entregas, activación, evacuación y ocupación sostenida. El ensayo del 12 de octubre alojó 50 personas; consultar su recibo y mantener los ensayos anteriores fallidos.
3. **Comparación reproducible:** mostrar Conventional y NEXO + modelo con el mismo mundo, horizonte, recursos, revisiones y permisos. Usar la primaria cerrada de tres semillas, sus recibos físicos y costes; distinguir reproducción de una consulta nueva. El resultado principal es ayuda suficiente recibida, con cantidades pendientes visibles cuando las haya.

Durante la explicación, mostrar solo necesidad → comprobación relevante → propuesta exacta → decisión del propietario → cambio físico observado. Abrir fuentes completas bajo demanda. El mapa 3D es observador del laboratorio y nunca una fuente secreta para el agente.

El portal público se demuestra en otra ventana: publicación aprobada, recepción sustentada, fotografía derivada revisada y fondos colectivos del sandbox. No se muestran víctimas identificables, archivos privados ni claves. Una corrección conserva historial y no oculta incertidumbre.

Antes de grabar, revisar [ESTADO_IMPLEMENTACION.md](ESTADO_IMPLEMENTACION.md) y [VALIDACION.md](VALIDACION.md). Cualquier resultado de una versión anterior debe mostrar su huella; cambiar modelo/prompt no permite reutilizarlo como medición de la versión nueva. Un replay grabado se etiqueta como replay, no consulta en vivo. GCP y pagos reales no forman parte de esta fase.

La huella local actual `c59fc605…` pasa 89 pruebas de plataforma y 117 del simulador, además de 57 checks de UI y 18 recorridos. Se puede demostrar composición dirigida de 50 ocupantes, agua aislada 500/600 L a ×1 y agua compartida 600/600 L en el comparativo modelado. No intercambiar esos modos ni atribuir la mejora de cobertura de compartir a una capacidad exclusiva del modelo: la red convencional también la consigue. En la campaña actual sin foco, agua y refugio compitieron y el modelo no consiguió ambas respuestas. Presentar ese límite y su plan de validación; el positivo de refugio del build anterior no se convierte en porcentaje vigente.

## 1. Lo que el jurado debe entender sin estudiar una pantalla

**NEXO es una plataforma para organizaciones humanitarias. Gemini descubre y ayuda a verificar respuestas que ninguna organización puede construir por separado.**

El beneficio humano: disponer antes de una respuesta viable para que la ayuda pueda llegar a quienes la necesitan. La misión es proteger vidas. Una reducción de minutos no demuestra por sí sola vidas salvadas.

El espectador debe poder identificar quién usa el producto, qué obstáculo existe, qué descubre Gemini y qué cambia gracias a ese descubrimiento. La comunicación es parte del resultado: si hay que leer diez recuadros para entenderlo, la escena no cumple su función.

## 2. Qué pesa en la competición

La página de [temas y evaluación de AI Builder Cup](https://aibuildercup.com/themes.html) indica 40% para implementación técnica y uso de GenAI, 25% para alineación e impacto, 25% para innovación y 10% para UX. Esto favorece una historia fuerte con una capacidad real y atribuible a Gemini; el tema humanitario por sí solo no garantiza una puntuación superior.

Las [FAQs oficiales](https://aibuildercup.com/Faqs.html) describen un prototipo funcional, despliegue en GCP/Cloud Run/Firebase y materiales de entrega que incluyen video menor de tres minutos, repositorio público, presentación y enlace desplegado. Preparar los materiales finales en inglés conforme a las instrucciones de la competición. Reconfirmar requisitos, plazos y condiciones de construcción antes de enviar: estas notas se basan en la consulta del 11 de octubre de 2026.

La web conceptual actual está en inglés y sirve para explorar el concepto y recibir feedback. Estas notas internas siguen en español; preparar en inglés la documentación que se entregue a la competición. La web no sustituye el prototipo ni las condiciones oficiales.

## 3. Guion inicial de 175 segundos

Revisión del concepto: la historia principal pasa de un puente y una planta a una inundación regional. El feedback mostró que el primer ejemplo parecía coordinación logística sencilla y no explicaba el desastre ni el trabajo de investigación. Mantener esa lección al construir la demo; más nodos o más 3D no sustituyen una relación causal comprensible.

| Tiempo | Qué ve el público | Qué debe comprender |
|---|---|---|
| 0–15 s | Inundación en tres provincias; mensajes de comunidades y equipos | El desastre dispersa la información y la ayuda no puede esperar |
| 15–35 s | Un refugio con nombres distintos, publicaciones contradictorias y reporte incompleto | La necesidad existe aunque todavía no figure en la coordinación |
| 35–75 s | Gemini relaciona las pistas, contrasta un video antiguo y pide confirmación local | Descubre y verifica una necesidad, sin confundir viralidad con evidencia |
| 75–110 s | Ayuda comprometida en Santa Elena; tres alternativas para Los Sauces | Cruza brechas con recursos y restricciones entre organizaciones |
| 110–140 s | Responsables autorizan agua y transporte; se sigue el envío hasta el resultado que el prototipo realmente demuestre | La propuesta cambia el mundo simulado; envío y recepción son estados distintos |
| 140–160 s | Comparación emparejada con una referencia competente | Qué mejoró, en qué medida y cuál es el aporte adicional de Gemini |
| 160–175 s | Una frase de cierre y alcance de la validación | Capacidad demostrada en laboratorio y siguiente paso hacia terreno |

Adaptar este guion a lo que realmente funcione. No fingir una consulta en vivo si solo se está reproduciendo una escena. Si el ciclo tarda demasiado, usar reproducción acelerada identificada o un resumen de eventos reales de una ejecución, conservando acceso a la traza.

### Ajuste de storytelling tras el feedback de comprensión

El mapa regional seguía obligando al espectador a descifrar demasiadas relaciones. Para la web conceptual, usar una misión concreta: **el equipo local solicita 600 litros de agua para Los Sauces antes de las 12:00**. 300 personas, cantidades y tiempos son ficticios; no son umbrales médicos ni resultados medidos.

La secuencia revela una entrada y una comprobación por momento: localizar el refugio, contrastar el video antiguo, comprobar que el camión llega tarde, descubrir que una furgoneta solo lleva 300 litros y relacionar un audio sobre un regreso vacío con la capacidad que falta. Las herramientas y responsables verifican antes de proponer dos envíos. La aprobación humana habilita la salida; la recepción sigue pendiente.

El momento central es interpretar una capacidad latente y decidir qué comprobar, no sumar 300 + 300 ni dibujar una ruta. Mostrar fuentes → consulta → resultado observable. La maqueta puede usar colas animadas; el prototipo deberá alimentarlas con eventos reales y resúmenes de comprobaciones, nunca fingir una traza interna del modelo. Pausa, avance y movimiento reducido deben estar disponibles.

## 4. La representación 3D tiene un trabajo concreto

Usar edificios geométricos, personajes simples y vehículos básicos. Cámara estable y pocos colores con significado. El recorrido de un camión puede mostrar que una autorización produce una acción; no seguirlo tanto tiempo que se pierda la relación con la necesidad.

Mostrar una sola idea por momento:

1. Titular corto: «Un refugio pide ayuda. El reporte aún no lo ve».
2. Resaltar en el mapa las piezas de esa relación; atenuar el resto.
3. Una frase explica lo que Gemini acaba de comprobar.
4. Fuentes y detalles se abren al solicitar evidencia.

Conservar orientación espacial, escala temporal y continuidad. Los estados deben distinguir información pendiente, propuesta y acción autorizada; una línea luminosa no debe sugerir que algo ya se entregó.

El laboratorio puede tener muchas variables. La demo necesita una secuencia comprensible. Controles de pausa, reinicio y avance permiten explicar un instante sin pelear contra la animación. No ocultar la complejidad del ensayo; llevarla a la vista de evidencia.

## 5. Mostrar el aporte de Gemini, no solo su nombre

Enseñar una decisión de investigación que cambie según la evidencia: qué comprobación falta, qué herramienta se consulta, qué devuelve y cómo cambia la propuesta. La hipótesis debe ser no trivial, pero explicable en una frase.

Ejemplos:

- Relacionar nombres ambiguos, audio y publicaciones para encontrar un refugio que aún no figura en el reporte consolidado.
- Contrastar necesidades con envíos en camino y tres alternativas reales, sin confundir viralidad con evidencia ni disponibilidad teórica con compromiso.
- Combinar suministros, transporte y acceso local entre provincias; revisar la cantidad necesaria cuando llegan más familias sin duplicar lo ya reservado.

Registrar entradas y salidas de herramientas, referencias, tiempos y decisiones. Mostrar estos observables, no una narración inventada de lo que el modelo «pensó». No es necesario revelar razonamiento interno privado para demostrar el trabajo ejecutado.

Una arquitectura con muchos agentes, MCP y GCP no prueba innovación por sí misma. Explicar qué nuevo comportamiento permite cada elemento y mostrar al menos un caso en que hace una diferencia medible.

## 6. Comparación que un jurado exigente pueda creer

Utilizar condiciones iniciales y sucesos externos comparables. La referencia debe tener herramientas competentes y un procedimiento razonable. Sus resultados pueden divergir porque toma otras decisiones; no forzar que reproduzca el mismo mundo posterior.

Separar al presentar:

- Mejora de centralizar/compartir información.
- Mejora de automatizar con reglas y optimización.
- Mejora de extraer información con Gemini.
- Mejora adicional de investigar y revisar propuestas con Gemini.

Presentar distribución de resultados y errores del conjunto reservado, no exclusivamente la ejecución más vistosa. Conservar una ficha de metodología para preguntas: variantes, número de ejecuciones, condiciones, costes, tiempos reales y simulados, y límites de extrapolación.

En una demo corta basta una comparación dominante. El resto debe poder abrirse y comprobarse, no competir simultáneamente por atención.

## 7. Traducir números a consecuencias sin inventar equivalencias

| Número | Explicación humana defendible |
|---|---|
| De 90 a 12 minutos hasta una propuesta, si se mide | Los responsables reciben 78 minutos antes una opción para revisar |
| Menor tiempo hasta atención, si también se mide | Una comunidad pasa menos tiempo esperando ese servicio |
| Menor exceso asignado | Más capacidad queda disponible para necesidades pendientes, según el contexto |
| Más necesidades críticas atendidas | Mostrar cuáles, cuándo y qué comunidades continúan esperando |

No decir «78 minutos = X vidas». Tampoco atribuir a Gemini todo el tiempo ganado por conectores, reservas automáticas o un mejor acceso a datos. Una mejor propuesta puede no mejorar la llegada si el cuello de botella sigue siendo transporte, personal o autorización.

El mensaje puede ser ambicioso: **ganar tiempo para proteger vidas**. Su evidencia debe ser precisa: qué cadena se mejoró y hasta dónde llegó la prueba.

## 8. Preparar una intervención que no esté escrita para ganar

Ofrecer al jurado, en una demostración ampliada, cambiar una condición reservada: retirar uno de los vehículos, cerrar otra ruta, reducir capacidad, introducir un reporte antiguo o negar un permiso. Debe cambiar el resultado de forma coherente; también es válido que el sistema diga que no tiene una opción viable.

No escoger únicamente cambios que ya tienen una respuesta favorable. Preparar una prueba de falta de información y otra donde una decisión inicial de Gemini se corrija. La recuperación ante un error puede demostrar más madurez que una secuencia perfecta.

El visor podrá alternar «realidad del simulador» e «información disponible para NEXO». Esa separación ayuda a demostrar que el agente no conoce la respuesta de antemano.

## 9. Respuestas que deben estar preparadas

**¿Ya existe algo parecido?** Sí existen sistemas de información y coordinación. Explicar qué aporta NEXO y qué puede consumir o devolver a esos sistemas; no negar sus capacidades. Separar conectores reales de conectores previstos.

**¿Por qué Gemini?** Mostrar una investigación adaptable y su comparación con extracción, reglas y optimización; evitar la respuesta genérica «entiende lenguaje natural».

**¿Funciona fuera de tu simulador?** Precisar qué se validó, con qué escenarios independientes y qué queda pendiente de terreno. No confundir un mundo visualmente convincente con validez externa.

**¿Quién responde si falla?** Responsables identificados, evidencia disponible al decidir, autorizaciones y cambios trazables. Demostrar también que esa revisión es viable para una persona.

**¿Por qué Google Cloud?** Explicar la función real de Gemini, Cloud Run, Firebase, eventos y persistencia en el prototipo desplegado. Mostrar observabilidad, costes y límites si preguntan; no convertir el pitch en una lista de servicios.

**¿Qué ocurre si una ONG no comparte todo o no acepta?** Mostrar valor con una instancia y la mejora incremental con otra; compartir información no otorga autoridad sobre sus recursos.

## 10. Preparación visual y operativa

- [ ] El comienzo explica producto, usuario y problema antes de hablar de arquitectura.
- [ ] Cada escena tiene un mensaje principal y una consecuencia visible.
- [ ] La demo ejecuta el prototipo o identifica claramente cualquier reproducción grabada.
- [ ] Las cifras presentadas salen de ejecuciones registradas y reemplazan las ficticias de la web.
- [ ] Se puede abrir la evidencia sin navegar por múltiples pantallas densas.
- [ ] La comparación es justa y sus variantes están documentadas.
- [ ] Hay al menos una restricción inesperada, un caso sin respuesta fácil y una recuperación.
- [ ] Se separan tiempo simulado, aceleración de reproducción y latencia real.
- [ ] La versión desplegada, el repositorio y el video corresponden al mismo alcance.
- [ ] El video cumple la duración y el idioma oficiales vigentes.
- [ ] Hay una grabación de respaldo identificada como tal si falla la conexión; nunca se presenta como ejecución en vivo.
- [ ] Se ha ensayado la explicación sin conocer de antemano el contenido de cada panel.

## 11. Prueba de comprensión antes de presentar

Mostrar el primer tramo a alguien que no haya participado en el proyecto. Pedirle que explique qué es NEXO, quién lo usa y qué acaba de conseguir Gemini. Si solo recuerda «un mapa con IA» o «una página de donaciones», revisar la jerarquía y el guion.

La aspiración es convencer mediante una capacidad concreta, una consecuencia humana comprensible y pruebas que resistan preguntas. Ninguna presentación garantiza un primer puesto; una demo fuerte permite al jurado comprobar por qué la propuesta merece competir por él.

## 12. Énfasis de la presentación conceptual actual

La portada representa conexiones entre comunidades, fuentes y capacidades regionales; no un problema de navegación alrededor de un puente. El caso de Los Sauces ilustra un descubrimiento dentro de esa escala.

- Separar extracción de datos, investigación dirigida por Gemini y comprobación mediante herramientas. Comparar las dos últimas con el mismo planificador y las mismas fuentes disponibles. Los ejemplos 90/42/29/12 minutos y 8/12/17 necesidades son ficticios; sustituirlos solo por mediciones reproducibles.
- Mostrar un cambio de condición que retire un compromiso, otro que amplíe una necesidad y otro que introduzca evidencia contradictoria. Conservar lo válido y mostrar qué debe comprobarse nuevamente.
- Medir el tiempo que realmente dedica el operador a revisar. Una maqueta de tres comprobaciones no demuestra aún que se reduzca la carga humana.
- Demostrar permisos distintos entre organizaciones y rechazo de solicitudes; compartir capacidad no concede autoridad sobre ella. Una base central también puede ser una alternativa legítima.
- Seguir la cadena hasta la recepción confirmada y medir necesidades atendidas a tiempo. No inferir vidas salvadas de minutos ahorrados o de un envío animado.
- Exponer la configuración necesaria antes del despliegue: fuentes autorizadas, responsables y política de intercambio. El portal público deriva de registros revisados, no de una narración inventada por el modelo.

La sección «¿Qué cambia con NEXO?» permite profundizar sin interrumpir la historia principal. En un video breve, escoger solo las preguntas que correspondan a lo demostrado; no intentar recorrer toda la web.

## 13. Qué evidencia llevar para cada criterio

Revisión del 11 de octubre de 2026, a partir de [criterios oficiales](https://aibuildercup.com/themes.html) y [FAQs](https://aibuildercup.com/Faqs.html). Los umbrales de abajo son una exigencia interna para defender la propuesta, no requisitos inventados del organizador. El concurso admite un prototipo funcional; no exige una operación industrial ni un paper.

| Criterio | Evidencia central | Objeción que no resuelve un buen pitch |
|---|---|---|
| Técnica y GenAI · 40% | Una investigación real con Gemini que cambia la acción, comparación con el mismo modelo/herramientas en un agente general y métricas de coste/cola bajo carga | Que el resultado provenga solo de mejores datos, una regla o un planificador |
| Problema e impacto · 25% | Un usuario y operación inicial definidos; ayuda prestada a tiempo; demanda no cubierta; revisión de supuestos con personas del sector | Que propuestas rápidas no cambien la atención, o beneficien solo a comunidades muy visibles |
| Innovación · 25% | Un servicio habilitado mediante dependencias y compromisos entre actores, en escenarios no memorizados, con comparación de antecedentes | Que se haya construido otro agregador de reportes con un modelo y un mapa |
| UX y diseño · 10% | Un operador entiende, cuestiona, modifica o rechaza; recibe cambios relevantes y confirma resultados sin revisar cientos de publicaciones | Que la landing sea clara pero el flujo operativo produzca saturación o aprobaciones sin comprensión |

No concederse 100/100 por haber implementado todos los módulos. La evaluación depende del resultado frente a alternativas, los límites, la adecuación al usuario y el juicio relativo de los evaluadores. Tampoco añadir memoria global o más agentes solo para aparentar ambición: C1–C7 ya permiten una contribución fuerte.

### Una afirmación dominante, tres comprobaciones

La afirmación a defender: **con los mismos recursos, NEXO descubre, verifica y mantiene respuestas conjuntas que una coordinación competente no encuentra con la misma rapidez o fiabilidad**. No afirmar imposibilidad universal para métodos tradicionales.

1. **Atribución:** una señal ambigua lleva a una consulta que cambia lo que se puede hacer; ver qué ocurre sin esa investigación y con un agente general equivalente.
2. **Cooperación:** una necesidad requiere contribuciones de varios actores, con competencia por recursos y permisos parciales; comparar la misma dotación, no una ONG contra cuatro con más recursos.
3. **Consecuencia:** seguir hasta servicio efectivo y mostrar la demanda que queda pendiente; retirar un compromiso y comprobar qué se preserva y qué se repara.

El caso simple de los 600 litros ayuda a entender el producto. No usarlo como única evidencia de complejidad. Acompañarlo con resultados de una familia no trivial y reservada; repetir cien veces la misma suma no demuestra investigación generalizable.

### Preguntas adicionales que deben tener respuesta

- ¿Qué parte ya puede hacer una herramienta existente y qué mecanismo añade NEXO?
- ¿Qué fuente real y autorizada alimentará el primer despliegue? ¿Qué sucede si no está disponible?
- ¿Quién paga o mantiene la instancia, quién puede comprometer recursos y qué se hace antes de la emergencia?
- ¿Una organización sin NEXO puede participar sin migrar sus herramientas?
- ¿Qué políticas impiden que la popularidad de una publicación determine la prioridad humanitaria?
- ¿En qué condiciones no hay ganancia y cuál es el coste de coordinación o de una propuesta equivocada?

Mantener un dossier de pruebas para profundizar, sin meter todas las respuestas en una sola vista. El resultado del laboratorio es evidencia condicionada a sus supuestos. Un ejercicio de mesa con operadores puede cuestionar esos supuestos; no presentarlo como piloto de terreno ni contactar organizaciones sin autorización.

## 14. Demostrar con el laboratorio 3D

El catálogo S01–S24 de [SIMULADOR.md](SIMULADOR.md) especifica qué debe ser visible y comprobable. Seleccionar una historia comprensible y una perturbación; no intentar exhibir todos los escenarios en una sola pantalla.

- Vista isométrica simple, posibilidad de seguir un vehículo y distinguir necesidad, refugio candidato, instalación operativa y ayuda recibida.
- Tres columnas para realidad, información comunicada y consumo real de NEXO. Mostrar una sola cadena seleccionada mientras el resto transmite volumen de fondo.
- El observador puede ver que un post es falso; NEXO no recibe esa etiqueta. Identificar siempre desde qué perspectiva se mira.
- Separar trayectos físicos de conexiones entre organizaciones y de mensajes pendientes de entrega.
- Explicar el modo de reloj: ejecución viva, latencias modeladas o replay. Velocidad de reproducción y velocidad real de inferencia son distintas.
- Describir un video mediante un objeto textual no demuestra visión multimodal. Si se afirma esa capacidad, incluir la prueba correspondiente con medios reales autorizados o sintéticos.
- La comparación A/B usa el mismo comienzo y perturbaciones externas; decisiones distintas producen consecuencias distintas de forma legítima.
- Guardar manifiesto, seed, versiones y traza; el jurado puede inspeccionar una operación o introducir una condición nueva sin que el escenario garantice el éxito.


## 15. Demo de la implementación local y resultados reales

La fase actual usa Gemma 4 31B/OpenRouter; Gemini y GCP son posteriores. Separar la landing conceptual con métricas inventadas de los resultados medidos. No copiar esos porcentajes a la demo como si fueran un benchmark.

Mostrar una necesidad recibida, la consulta real del modelo, la propuesta con condiciones, revisión por cada dueño y servicio efectivo en el visor. Un refugio debe mostrar personas ocupando plazas; un camión debe mostrar carga, viaje y recepción. Bloquear el viaje original ya cargado y mostrar cómo Repair conserva esa carga y resuelve la misma operación. No reemplazar la reparación con un envío nuevo.

En el dossier de apoyo incluir el contraste completo B4/B5/B6/B7, variantes internas imposibles y seguras, carga semántica y física, latencia/coste/fallos y lo que queda pendiente. Una animación de 100 necesidades no significa 100 necesidades resueltas. La actividad visible usa herramientas y evidencia registradas; no inventa pensamiento privado.

Los archivos exactos del build final se enlazan desde [VALIDACION.md](VALIDACION.md) y [CIERRE_LOCAL.md](CIERRE_LOCAL.md). Las pruebas humanas, calibración y holdout externo mantienen su protocolo propio. No presentar replay, tiempo modelado o revisión programada como inferencia ×1 ni estudio con profesionales.

## 16. Qué demostró la entrega anterior y qué no anunciar

- 120+120 pruebas de mecanismos; 80 checks de navegador, sin llamarlos estudio con personas.
- Composición estándar real: 600 L y 50 personas ocupando refugio; prueba dirigida desde necesidad sin ID de instalación.
- Reparación sobre la misma operación cargada: 4/4 ensayos; su objetivo de mejora de tiempo K07 no se cumplió.
- 4.000/4.000 versiones durables con p95 3,33 s desde disponibilidad, sin polling ni inferencia incluidos.
- 100 necesidades reconocidas por cada una de cuatro organizaciones en un corpus interno; no 100 entregas/minuto ni precisión certificada sobre desastres reales.
- Campaña principal de 36 outcomes y carga física de 101 necesidades con pérdidas, parciales y backlog. B6 no acreditó ventaja robusta sobre B5/B7; mostrarlo si se pregunta por atribución.
- Propuesta real de Gemma para revisión, después de intentos inconclusos y comprobaciones de campo. No describir el recorrido como éxito al primer intento o respuesta instantánea.

Los reportes históricos exactos están en [VALIDACION §13](VALIDACION.md#13-resultados-finales-de-la-entrega-local--13-de-octubre-de-2026-tokio). No son resultados del candidato posterior `d2a9932…`: consultar [MEJORA_RESPUESTA.md](MEJORA_RESPUESTA.md) y [COBERTURA_REQUISITOS.md](COBERTURA_REQUISITOS.md) para la iteración actual. El laboratorio de presentación está en pausa para inspección y el operador puede reanudarlo. El mensaje de una futura demo debe apoyarse en los mecanismos medidos para su versión; los porcentajes de la landing continúan siendo objetivos conceptuales.
