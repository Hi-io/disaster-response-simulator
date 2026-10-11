# NEXO — Arquitectura objetivo en Google Cloud y plan de migración desde local

Documento de diseño · 12 de octubre de 2026. Arquitectura propuesta, no desplegada ni medida. El contrato funcional, UI, KPIs y tests están en [PLATAFORMA.md](PLATAFORMA.md). Este documento no autoriza crear recursos, contratar servicios o ejecutar inferencias de pago durante una revisión documental.

## 1. Decisión principal

Primero construir y evaluar NEXO localmente con componentes equivalentes y adaptadores explícitos. Después migrar conservando contratos, estados, autoridad, evidencias y pruebas. Google Cloud será el destino del prototipo de entrega; el laboratorio y el despliegue operativo se mantienen separados.

La capacidad diferenciadora viene de cómo se investiga, compone y mantiene una respuesta. Los servicios cloud sostienen ejecución, aislamiento, persistencia, integración y escala; no convierten automáticamente una arquitectura en infinitamente escalable.

## 2. Mapa lógico

    Operadores          Campo/PWA             Portal público
          \                |                      /
            Hosting de interfaces + identidad
                         |
                   API de aplicación
                         |
       +-----------------+------------------+
       |                 |                  |
    Dominio          Investigaciones     Proyección pública
       |                 |                  |
    PostgreSQL       Gemini + tools     Datos aprobados
       |                 |
    Outbox ------ Eventos/colas ------ Conectores
       |                                    |
    Evidencia                       Otras instancias / herramientas

    Laboratorio y evaluator: servicio separado, con credenciales propias
    NEXO solo puede entrar al gateway de su organización.

## 3. Equivalencias local → cloud

| Función | Local primero | Google Cloud después | Qué hay que volver a probar |
|---|---|---|---|
| Frontend operativo/campo/público | Servidor web y PWA local | Firebase Hosting para frontend estático; Cloud Run para contenido dinámico/API | Rutas, cache, auth, offline y separación público/privado |
| Identidad | OIDC local o sesiones de desarrollo con issuer explícito | Firebase Authentication, o proveedor corporativo integrado según necesidad | Tokens, issuer/audience, expiración, revocación y roles en backend |
| API y módulos del producto | Contenedores locales | Cloud Run services | Concurrencia, cold start, timeouts, autoscaling y shutdown |
| Investigaciones breves | Workers locales con jobs durables | Workers ejecutados como unidades de trabajo acotadas mediante servicios Cloud Run y cola | Persistencia, reintentos, lease y respuesta perdida |
| Trabajo finito/batch | CLI/workers limitados | Cloud Run jobs donde encaje | Reanudación, cancelación, artefactos y límites |
| Estado y compromisos | PostgreSQL local | Cloud SQL for PostgreSQL | Conexiones, locking, aislamiento, failover y migraciones |
| Distribución de eventos | Outbox PostgreSQL + despachador | Pub/Sub detrás de la misma interfaz, conservando outbox | Entrega repetida, orden por entidad, redelivery y dead-letter |
| Evidencia | Volumen local con claves/hash | Cloud Storage | ACL, URLs temporales, retención, integridad y costes |
| Secretos | Archivo/env local ignorado, accesos limitados | Secret Manager + identidades de servicio | Rotación, permiso mínimo y ausencia en logs/cliente |
| Observabilidad | Logs/OTel/export local | Cloud Logging/Monitoring/Trace según integración elegida | Correlación, redacción, retención y alertas |
| Imágenes/build | Build local reproducible | Cloud Build + Artifact Registry | Dependencias fijadas, artefacto identificado, permisos y rollback |
| Modelo | Fixtures/replay; Gemini remoto en pruebas reales | Gemini mediante API gestionada de Google, con vía/versiones fijadas al implementar | Tool calling, cuotas, latencia, coste, región y políticas de datos |
| Evaluador | Proceso/volúmenes separados | Entorno de evaluación aislado, opcionalmente proyecto separado | Que el candidato no acceda a verdad, seeds privados ni resultados intermedios |

«Equivalente» significa cumplir el mismo contrato de aplicación; no promete que un emulador reproduzca rendimiento, facturación, IAM o fallos de producción. La infraestructura puede seguir siendo un monolito modular y un pequeño número de workers; no es obligatorio separar un servicio por agente.

## 4. UI, Firebase e identidad

Firebase Hosting puede servir las interfaces y dirigir peticiones dinámicas a Cloud Run. Esta integración está documentada oficialmente: [Firebase Hosting con Cloud Run](https://firebase.google.com/docs/hosting/cloud-run).

Mantener rutas/superficies por rol. La UI pública consume únicamente proyecciones publicables; no recibe todas las tablas privadas para esconderlas con CSS. Campo usa almacenamiento local acotado y sincronización, con estado offline visible. Las fotos/documentos privados usan accesos limitados, no URLs públicas permanentes.

Firebase Authentication resuelve identidad, no toda la autorización del dominio. El backend verifica tokens y cruza organización, rol, delegación, turno y acción. Distinguir usuario humano, agente, conector e instancia socia. Nadie puede cambiar su rol desde un parámetro JSON. Las credenciales del proveedor Gemini permanecen fuera del navegador.

Si la organización necesita identidad corporativa, comprobar requisitos y coste de esa integración antes de prometerla. El proveedor local de desarrollo no debe aceptar tokens de producción ni viceversa.

## 5. Cloud Run: API, trabajo y límites

Desplegar API y workers contenedorizados. Cada tarea persiste progreso y puede repetirse sin duplicar efectos. No iniciar una investigación crítica como una promesa en memoria después de devolver un HTTP 200; debe quedar un trabajo durable con estado y lease.

Cloud Run tiene servicios para peticiones/eventos y jobs para trabajo finito; escoger según ciclo de vida, no tratar una petición web como un demonio persistente. Su filesystem local es efímero, por lo que evidencia y estado operativo deben guardarse fuera del contenedor. [Descripción oficial de Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run)

Configurar límites máximos de instancias y concurrencia según conexiones de DB, cuotas de modelo y presupuesto de cada organización. Mínimos de instancias, timeouts y tamaño se deciden con mediciones. Cold starts y escalado se incluyen en latencia de cola; no atribuir esa demora a operadores o eliminarla del benchmark.

Una llamada larga al modelo puede continuar como trabajo dividido/persistido; un restart no autoriza una segunda orden. Usar deadlines, cancelación, backoff acotado y distinción de fallo transitorio/permanente. Los jobs de evaluación producen artefactos y terminan; la simulación viva requiere su propio diseño de estado/reanudación.

## 6. Datos, evidencia y transacciones

Cloud SQL PostgreSQL conserva casos, claims, propuestas, aprobaciones, recursos, compromisos, operaciones, auditoría y proyecciones. El esquema y migraciones provienen del desarrollo local. No usar una base adicional solo por asociarla visualmente a Firebase.

Conexiones limitadas por pool y por instancia; el máximo total de Cloud Run no puede superar alegremente la capacidad de PostgreSQL. Elegir conexión privada/conector y cuentas de servicio según entorno; validar aislamiento y conectividad. [Conectar Cloud Run a Cloud SQL PostgreSQL](https://docs.cloud.google.com/sql/docs/postgres/connect-run)

Guardar decisión y evento outbox en una transacción. La publicación posterior puede repetirse; cada consumidor mantiene idempotencia y versión. Los leases y reservas pertenecen al ledger del propietario, con comprobaciones consistentes en DB. Los reintentos de una investigación no reabren por defecto una reserva ya confirmada.

Cloud Storage conserva adjuntos y evidencias permitidas con hash, metadata, permisos y retención. PostgreSQL guarda referencias; no pasar archivos enormes dentro de cada evento. Una corrección conserva la relación con la versión usada al autorizar cuando la política de retención lo permita.

Backups, restauración y migraciones reversibles o con recuperación explícita. Fijar RPO/RTO reales y probarlos; no copiar el objetivo de recuperación local como si fuera una garantía de operación cloud.

## 7. Pub/Sub e intercambio entre organizaciones

Pub/Sub transporta eventos; no decide quién puede prestar un vehículo ni garantiza consistencia de inventario. Diseñar para duplicados, reordenamiento y reentrega. Incluso una opción del servicio denominada exactly-once no convierte compras, escrituras externas y efectos físicos en una transacción exactamente una vez; mantener idempotencia de negocio. La disponibilidad de esa opción depende del tipo de suscripción y condiciones documentadas. [Semántica de entrega Pub/Sub](https://docs.cloud.google.com/pubsub/docs/exactly-once-delivery)

Eventos mínimos: ID, schemaVersion, entityId/version, tenant, emisor, scope, correlationId, observedAt, publishedAt, validity, payload mínimo y referencias autorizadas. Verificar identidad de quien publica/consume y permisos de cada destino. Un topic compartido no debe exponer indiscriminadamente todo el contenido.

La federación entre organizaciones puede empezar con un directorio/broker autenticado y APIs de capacidad. No requiere desde el inicio una malla peer-to-peer. El broker conecta ofertas/actualizaciones; los propietarios conservan autoridad y disponibilidad. Probar caída del broker sin detener operaciones locales ya autorizadas.

MCP puede exponer tools a Gemini a través de un gateway con permisos. No reemplaza autenticación entre organizaciones, event delivery, outbox, reservas o reconciliación.

## 8. Gemini como dependencia controlada

Elegir modelo, API, versión y región disponibles al implementar; no fijar una variante por marketing sin medir calidad/coste/latencia. La documentación de function calling de Google describe cómo ofrecer funciones al modelo: [herramientas y function calling](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling).

El backend valida argumentos, permisos y presupuesto antes de ejecutar una herramienta. Respuestas externas se tratan como datos. Las fuentes no pueden definir instrucciones nuevas ni conceder acceso. Guardar resultados estructurados con referencias y validaciones; las explicaciones visibles se basan en actividades observables.

Procesamiento por lotes, deduplicación, recuperación selectiva de documentos y caching con versión pueden reducir consumo. No enviar todos los reposts completos ni llamar al modelo por fotograma de la simulación. Revalidar datos de contexto cuya vigencia pueda haber cambiado.

Medir tokens/coste, tasa de fallo, timeouts y latencia de llamadas/herramientas por organización, caso y modelo. Configurar budgets/quotas y una condición de parada; las alertas de facturación son avisos, no un límite de gasto infalible. El presupuesto de aplicación debe limitar concurrencia y nuevas investigaciones.

La modalidad offline local no acredita Gemini. La migración a cloud tampoco sustituye las pruebas de ablación o generalización. Repetir la suite de modelo si cambia su versión o configuración materialmente.

## 9. Instancia por organización y aislamiento

Para el POC, organización como ámbito lógico aislado con permisos server-side y pruebas de no fuga. La UI puede mostrar cuatro organizaciones sin que eso implique cuatro proyectos cloud o cuatro bases físicas.

Para validar autonomía, ejecutar al menos varias instancias de API/workers con credenciales separadas y fallos independientes. Dos opciones futuras: servicio compartido multitenant, o proyecto/instancia dedicado por organización con conexiones permitidas. Elegir con operadores según residencia, control, coste y operación; no prometer ambas modalidades como ya construidas.

En ambos casos: eventos mínimos autorizados, control de recursos local, revocación, socios externos y backups. Una organización desconectada conserva sus compromisos conocidos; el resto no recibe consentimiento implícito por timeout.

## 10. Laboratorio y evaluador en cloud

El mundo y la verdad privada deben estar separados de NEXO. Red, identidades y mounts impiden al candidato leer checkpoints, bases de evaluación o archivos de escenarios ocultos. El servicio de observación 3D se autentica aparte; no incrustar una sesión omnisciente en el contexto del agente.

El simulador actual usa SQLite/archivos para archivos durables locales. No trasladarlo a filesystem efímero sin rediseñar persistencia y checkpoints. Para una demo puede seguir en un entorno controlado y comunicar por gateway autenticado; para batch, usar jobs con volúmenes/almacenamiento y exportación apropiados. No afirmar escalabilidad cloud del laboratorio solo porque NEXO está en Cloud Run.

Live ×1 mide llamadas reales y latencia cloud; modeled usa latencias declaradas para simular aceleración; replay no consume nuevas inferencias. Mantener etiquetas y artefactos separados. El benchmark final guarda versión de infraestructura y límites de red/región además de seed y build.

## 11. Seguridad, observabilidad y costes operativos

Servicios con identidades específicas, privilegio mínimo y secretos independientes. Redactar PII/secrets en logs, restringir evidencias y proteger exports. Los entornos dev/eval/demo no comparten automáticamente datos ni credenciales. El portal público y los endpoints de pago usan proyecciones/webhooks validados; la UI no habla directamente con la DB.

Trazas: fuente → interpretación → investigación → herramienta → propuesta → autorización → compromiso → orden → recepción → servicio. Cada salto tiene correlationId, actor, tiempo, resultado, retry y coste cuando corresponde. El panel de actividad muestra datos de esas trazas sanitizados, no payloads privados íntegros.

Alertas operativas: cola creciente, fuentes caídas, ingestión estancada, trabajos sin lease, exceso de errores, intentos de permisos inválidos, pool saturado, reservas huérfanas y discrepancia entre publicación/operación. Alertas encaminadas a responsables, no a todos los operadores.

Coste por capa: modelo, ejecuciones, base, almacenamiento, red, logs, herramientas externas y operación humana. Hacer presupuesto por carga nominal y stress; medir variación real. No prometer costo cero por free tiers ni escalado infinito.

## 12. Plan de migración verificable

### M0 — Contrato local cerrado

PLATAFORMA T01–T12 verdes, integración real con Gemini, datos persistentes, roles separados, simulador sin truth leakage, smoke test documentado y configuración sin secretos en repo. Fijar imágenes/dependencias y formato de evidencias.

### M1 — Proyecto y permisos

Elegir proyecto, región, facturación, servicios, responsables, límites y políticas de datos. Provisionar mediante infraestructura como código. Los pasos que requieren autorización administrativa se documentan; no ocultarlos detrás de un botón conceptual.

### M2 — Estado y secretos

Crear DB/almacenamiento/identidades, cargar solo datos sintéticos de demo y ejecutar migraciones. Probar backup/restore, configuración y acceso. Los fixtures locales no contienen credenciales de producción.

### M3 — Servicios y colas

Construir imágenes, desplegar API/workers, configurar eventos y conectar adaptadores. Probar reinicios, mensajes duplicados, DB caído y órdenes confirmadas tras timeout. Limitar escalado antes de una prueba de carga.

### M4 — Frontend e identidad

Desplegar UI, autenticar roles, comprobar campo offline, portal público y links de evidencia. Comparar contratos funcionales con local. No permitir acceso anónimo a endpoints operativos por usar un dominio público de demo.

### M5 — Extremo a extremo y medición

Ejecutar el mismo caso pequeño y su versión fallida, comparar estados/invariantes, medir latencia/coste cloud y una prueba de carga nominal. Un cambio material del modelo o conector requiere repetir las evaluaciones afectadas. Registrar cold starts, región y egress.

### M6 — Instalación limpia y rollback

Desplegar desde cero en entorno controlado con infraestructura/configuración declaradas; registrar pasos manuales, duración y errores. Probar rollback de aplicación y compatibilidad de schema. Ofrecer limpieza documentada de recursos de prueba preservando artefactos necesarios.

## 13. Qué significa el objetivo «desplegar en un clic»

Una plantilla asistida prepara APIs, identidades, servicios, base, almacenamiento, cola e interfaces; después guía configuración de organización, conectores y políticas. Requiere proyecto/facturación/permisos y credenciales de fuentes externas. Las decisiones operativas y de intercambio no se pueden adivinar.

El botón de la landing sigue siendo conceptual hasta que M6 esté probado. No debe crear recursos ni transferir datos por sorpresa. El resultado de instalar no es «listo para tomar decisiones sobre una emergencia» hasta que responsables, fuentes y autoridad se hayan configurado.

## 14. Criterios de aceptación cloud

- [ ] Despliegue real en Cloud Run/Firebase según convocatoria y documentación de entrega.
- [ ] Un circuito con Gemini real, tools, aprobación y consecuencia del simulador funciona desde la UI desplegada.
- [ ] Igualdad de contratos e invariantes con local; pruebas de identidad/aislamiento/replay apropiadas.
- [ ] Estado durable ante scale-down/restart y sin archivos críticos en disco efímero.
- [ ] Concurrencia limitada por DB, quotas de modelo y presupuesto.
- [ ] Pub/Sub duplicado/reordenado no duplica efectos físicos o financieros.
- [ ] Costes, latencias y límites medidos; ninguna cifra local se presenta como cloud sin verificación.
- [ ] Operador, público y evaluador tienen sesiones y datos adecuados a cada rol.
- [ ] Instalación limpia, observabilidad y recuperación documentadas.
- [ ] Materiales de entrega y UI en inglés natural; claims coherentes con evidencias.

## 15. Fuentes y decisiones abiertas

Documentación oficial consultada el 12 de octubre de 2026: Cloud Run, Firebase Hosting con Cloud Run, Cloud SQL para Cloud Run, semántica de entrega Pub/Sub y function calling de Gemini enlazados arriba. Verificar disponibilidad, precios, quotas, regiones y nombres exactos de APIs al implementar; no se han presupuestado tarifas actuales aquí.

Decisiones abiertas: modelo/versiones, proveedor/SDK exacto de Gemini, región, límites iniciales, proveedor de identidad de producción, aislamiento físico por organización, API pública entre instancias y topología de ejecución del laboratorio. Mantener contratos funcionales estables mientras se resuelven mediante pruebas y necesidad operacional.
