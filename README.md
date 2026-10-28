# Natossi

Una experiencia interactiva para el Track B «La plaga zombie» de Spookython 2026. NATOSSI convierte un escenario de contención en Manta en una secuencia visual: recorre la ciudad, observa cómo se conecta un brote y compara decisiones con recursos limitados.

La interfaz combina una introducción cartográfica ligada al scroll, un mapa satelital local de Manta y un laboratorio de simulación reproducible. Es HTML, CSS y JavaScript estático; la demo no necesita un backend ni credenciales.

## Ejecutar localmente

Con Python 3 y Node.js 22 disponibles, desde esta carpeta:

```bash
npm run dev
```

Abre <http://localhost:4173>. También puedes ejecutar `python3 -m http.server 4173 --directory dist`. Usa un servidor HTTP: los módulos y los datos del mapa no se cargan de forma fiable al abrir `index.html` como archivo.

Para comprobar el motor:

```bash
npm test
```

La suite incluye 17 pruebas de reproducibilidad, conservación de la población, asignación de dosis, eficacia parcial, respuesta diferida y coherencia de los estados utilizados por el mapa.

## Recorrido de la demo

1. **Explorar Manta.** La introducción utiliza un vídeo satelital local de 24 segundos y cinco capítulos, sobre un recorrido de 7,2 pantallas en escritorio y 6,2 en móvil. Las imágenes son de archivo de Esri World Imagery; las vías son de OpenStreetMap. No requiere descargar teselas durante la presentación.
2. **Definir el escenario.** Cambia el punto inicial, contagio, dosis, casos iniciales, eficacia, día de respuesta y semilla. Elige 12, 32 o 64 réplicas, priorización por grado o una heurística de conexiones entre sectores, y una respuesta adaptativa opcional.
3. **Comparar decisiones.** Ejecuta la estrategia, la vacunación aleatoria con el mismo presupuesto y la ausencia de intervención. Las curvas, la tabla y los rangos muestran resultados calculados.
4. **Recorrer el brote.** Reproduce o selecciona un día y una estrategia sobre el mapa. Puedes pausar las figuras y alternar vista completa y dos niveles de acercamiento al foco. Esta animación representa la primera réplica, mientras las curvas y métricas resumen todas las réplicas.
5. **Probar un brote sorpresa.** Duplica el contagio, reduce a la mitad las dosis, mueve el inicio al transporte o establece una eficacia del 50 %. Los atajos modifican parámetros del mismo modelo.
6. **Compartir el resultado.** Exporta el experimento como JSON o imprime un resumen con la configuración y la comparación.

El vídeo tiene dos archivos de entrega: Full HD 1920 × 1080 a 60 fps para escritorio y HD 1280 × 720 a 60 fps para móvil. Ambas versiones se interpolan desde la secuencia cartográfica renderizada a 24 fps; los fotogramas de entrega no añaden detalle satelital a la imagen de origen.

El recorrido temporal usa `requestAnimationFrame`, con 1,8 segundos por día a velocidad 1× y opciones 0,5× y 2×. Los estados SEIR cambian sólo al entrar en un día entero. El reloj intradiario, los destellos, las señales entre contactos y la marcha de los personajes son visuales; no alteran la simulación. Los contadores describen la primera réplica y conservan la población total de 240 agentes.

La interfaz respeta `prefers-reduced-motion`: evita el scrubbing y la reproducción automática del vídeo cuando se solicita movimiento reducido. Los controles siguen disponibles y el contenido puede recorrerse sin depender de las transiciones.

## Geografía real, población sintética

`dist/assets/manta-map.json` conserva geometría y referencias cartográficas de Manta obtenidas de OpenStreetMap. Las fuentes, la atribución y el tratamiento de los datos se describen en [docs/mapa-manta.md](docs/mapa-manta.md).

Los personajes sombreados tienen un ciclo de marcha y un aspecto distinto por estado. La animación se limita a 60 fps, se pausa fuera de pantalla y al ocultar la pestaña, y respeta movimiento reducido. El movimiento es visual: no modifica los contactos ni el resultado epidemiológico.

Las personas, sus contactos y sus ubicaciones superpuestas son **sintéticos**. No representan domicilios, desplazamientos, pacientes ni registros sanitarios reales. La cartografía da contexto geográfico a la demo; no calibra el modelo epidemiológico.

## Modelo y supuestos

La red contiene hogares de cinco personas, cuatro nodos de encuentro y un 10 % de probabilidad de añadir un contacto entre grupos. Su estructura favorece especialmente la protección de nodos con muchos contactos; no es una estimación de la red social real de Manta.

El modelo usa cuatro estados: susceptible, expuesto, infeccioso y recuperado o inmune. Cada contacto infeccioso aporta una probabilidad diaria de transmisión; con `n` contactos se combina como `1 − (1 − p)^n`. La exposición dura dos días y el periodo infeccioso cuatro. Además de los casos iniciales seleccionados, el escenario comienza con dos personas expuestas.

Las dosis se asignan una sola vez, antes de transmitir el día de respuesta elegido. El día cero significa antes del inicio de la simulación. Sólo se vacuna a personas susceptibles. Cada dosis consume presupuesto y tiene la probabilidad de éxito indicada por la eficacia; una dosis exitosa confiere inmunidad inmediata.

La estrategia por **grado** prioriza a quienes tienen más conexiones. La opción **puentes** pondera los contactos entre sectores y el grado de sus vecinos; es una heurística explicable, no centralidad de intermediación exacta. La respuesta **adaptativa** prioriza a las personas susceptibles vecinas de casos infecciosos al momento de intervenir.

| Parámetro inicial                              | Valor                           |
| ---------------------------------------------- | ------------------------------- |
| Población sintética                            | 240 personas                    |
| Horizonte                                      | 30 días                         |
| Probabilidad de transmisión por contacto y día | 0,28                            |
| Dosis disponibles                              | 40                              |
| Casos infecciosos iniciales                    | 1                               |
| Eficacia de la intervención                    | 100 %                           |
| Día de respuesta                               | 0                               |
| Estrategia                                     | Grado, sin respuesta adaptativa |
| Semilla                                        | 2026                            |
| Réplicas por estrategia                        | 12                              |
| Punto inicial                                  | Mercado                         |

Las tres estrategias comparten red, estados iniciales y sorteos de contagio para cada réplica. La intervención aleatoria y la estratégica utilizan el mismo presupuesto; la línea base no recibe dosis. La misma configuración y semilla producen el mismo resultado.

Las curvas muestran medias de contagios acumulados. El rango indica el mínimo y máximo observados, **no un intervalo de confianza**. El mapa reproduce los estados de la primera réplica y no debe interpretarse como la curva media. El JSON incluye configuración, medias, totales por réplica, red sintética y estados diarios de esa primera réplica.

La comparación informa infecciones evitadas dentro del modelo; no equivale a vidas salvadas. No se modelan mortalidad, capacidad hospitalaria, reinfección ni movilidad real. Los parámetros son ilustrativos y no están calibrados para tomar decisiones sanitarias.

## Estructura

```text
umbra/
├── dist/                     # Contenido completo del hosting
│   ├── index.html
│   ├── styles.css
│   ├── app.js                # Interfaz, scroll, mapa y resultados
│   ├── assets/               # Cartografía y vídeo locales
│   └── simulation.js         # Motor reproducible
├── tests/
│   └── simulation.test.mjs
├── docs/
│   ├── arquitectura.md
│   └── mapa-manta.md
└── README.md
```

El motor se ejecuta en el navegador y no envía la configuración a un servicio remoto. La demo no guarda resultados en un servidor. El archivo JSON se descarga en el dispositivo y el informe usa la impresión del navegador.

## Publicación

La versión pública está en [Natossi](https://mrcat7777.github.io/natossi-spookython-2026/). El workflow `.github/workflows/pages.yml` ejecuta las pruebas del modelo y publica `dist/` en GitHub Pages al actualizar `main`.

## Despliegue en AWS

La propuesta es un bucket S3 privado servido mediante CloudFront y Origin Access Control (OAC), descrita en [docs/arquitectura.md](docs/arquitectura.md). Publica el contenido de `dist/` en la raíz del bucket, configura `index.html` como documento raíz de CloudFront y conserva las rutas de los recursos. Verifica los tipos MIME de JavaScript, JSON y MP4 y la reproducción del vídeo desde la distribución HTTPS.

**Estado: despliegue en AWS pendiente.** Para completar la entrega, crea y comprueba la distribución en la cuenta del equipo, registra su URL y región y añade la captura del AWS Budget con alerta. La vista previa alojada de la interfaz es independiente del requisito AWS.

## Costos

Estima la operación en [AWS Pricing Calculator](https://calculator.aws/) con la región, tamaño de los recursos y tráfico esperado:

```text
Costo mensual ≈ almacenamiento S3
              + solicitudes S3
              + solicitudes HTTPS CloudFront
              + transferencia de salida CloudFront
              + servicios opcionales contratados
```

El vídeo debe incluirse en el cálculo de transferencia. Registra cantidades y tarifas, condiciones del plan de la cuenta y gasto real en AWS Billing. Configura la alerta de presupuesto antes de publicar recursos.

## Desarrollo

El repositorio principal es [MrCat7777/natossi-spookython-2026](https://github.com/MrCat7777/natossi-spookython-2026). Para trabajar en un cambio:

```bash
git pull --ff-only
git switch -c feature/nombre-del-cambio
npm run dev
```

Antes de subirlo, ejecuta `npm test`, revisa la interfaz en escritorio y móvil y crea un commit que describa el cambio. Publica la rama con `git push -u origin HEAD` y abre un pull request hacia `main`.
