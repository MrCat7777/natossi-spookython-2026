# UMBRA

Landing interactiva para el Track B «La plaga zombie»: una experiencia de Halloween que presenta una herramienta de contención de brotes en Manta. Combina una estética oscura, acentos naranja y violeta, animaciones de aparición y una demo de simulación que se ejecuta en el navegador.

El proyecto es HTML, CSS y JavaScript estático. No requiere un proceso de compilación ni credenciales para ejecutar la demo.

## Ejecutar localmente

Desde esta carpeta:

```bash
python3 -m http.server 4173 --directory dist
```

Abre <http://localhost:4173>. Se necesita un servidor HTTP para cargar los módulos JavaScript; abrir `index.html` directamente como archivo puede impedir su carga.

Para ejecutar las pruebas del motor, con Node.js 22:

```bash
node --test tests/*.test.mjs
```

## Qué puedes presentar

- Una landing responsiva que explica el problema y conduce a la demo.
- Una comparación de tres decisiones sobre una misma población sintética: sin intervención, vacunación al azar y vacunación priorizada por número de contactos.
- Parámetros modificables para explorar cómo cambia el resultado y una semilla para repetir el experimento.
- Resultados calculados en el navegador, con promedios de varias ejecuciones; los valores de la demo no son estadísticas reales de Manta.

## Modelo y supuestos

La demo utiliza una red sintética con hogares de cinco personas, cuatro personas que actúan como nodos de encuentro y un 10 % de probabilidad de añadir un contacto entre grupos. «Manta» es el contexto narrativo: no se han importado datos censales, coordenadas reales ni registros de salud. Esta estructura favorece especialmente la protección de los nodos con muchos contactos.

Los estados son susceptible, expuesto, infeccioso y recuperado o inmune. Cada contacto infeccioso aporta una probabilidad diaria de transmisión; con `n` contactos se combina como `1 − (1 − p)^n`. La latencia dura dos días y el periodo infeccioso cuatro. El escenario comienza con un nodo infeccioso y dos contactos expuestos. Las dosis se asignan al inicio, únicamente a personas susceptibles. La intervención estratégica prioriza personas con más conexiones; la aleatoria utiliza el mismo número de dosis. La línea base no recibe dosis.

Configuración inicial del motor:

| Parámetro | Valor |
| --- | --- |
| Población sintética | 240 personas |
| Horizonte | 30 días |
| Probabilidad de transmisión por contacto | 0,28 |
| Dosis disponibles | 40 |
| Semilla | 2026 |
| Repeticiones | 12 |
| Punto inicial | Mercado |

Las tres estrategias comparten red, estados iniciales y sorteos de contagio para cada repetición. La misma configuración y semilla producen el mismo resultado. El motor devuelve medias y el rango mínimo–máximo observado de infecciones acumuladas; ese rango no es un intervalo de confianza. La comparación informa diferencias del modelo; una estrategia puede rendir de manera distinta al cambiar las condiciones.

Las dosis representan inmunidad inmediata en este escenario simplificado. No se modelan capacidad hospitalaria, mortalidad, reinfección, desplazamientos reales ni eficacia clínica. No existe calibración epidemiológica: la simulación sirve para una demostración de producto y algoritmos, y no para tomar decisiones sanitarias.

## Estructura

```text
umbra/
├── dist/                     # Carpeta completa que debe servir el hosting
│   ├── index.html
│   ├── assets/               # Recursos visuales
│   └── simulation.js         # Motor reproducible
├── tests/
│   └── simulation.test.mjs
├── docs/
│   └── arquitectura.md
└── README.md
```

La imagen de portada se sirve en WebP para mantener ligera la carga inicial. El motor se ejecuta localmente y no envía la configuración de simulación a un backend.

## Despliegue en AWS

La arquitectura propuesta es un bucket S3 privado con distribución CloudFront y Origin Access Control (OAC), descrita en [docs/arquitectura.md](docs/arquitectura.md). Publica el contenido de `dist/` en la raíz del bucket y configura `index.html` como documento raíz de CloudFront. Usa HTTPS y restringe la lectura del bucket a esa distribución.

**Estado:** despliegue en AWS pendiente. Para completar la entrega, configura y comprueba la distribución de CloudFront, registra su URL y región, y añade una captura del AWS Budget con alerta. La vista previa de la interfaz es independiente del despliegue AWS.

## Costos

Estima la operación en [AWS Pricing Calculator](https://calculator.aws/) con la región y el tráfico esperado:

```text
Costo mensual ≈ almacenamiento S3
              + solicitudes S3
              + solicitudes HTTPS CloudFront
              + transferencia de salida CloudFront
              + servicios opcionales contratados
```

Registra las cantidades y tarifas empleadas, las condiciones del plan de tu cuenta y el gasto real que aparezca en AWS Billing. Configura una alerta de presupuesto antes de publicar recursos.
