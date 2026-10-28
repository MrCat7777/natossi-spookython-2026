# Cartografía de Manta

La capa geográfica proviene de OpenStreetMap y se distribuye localmente en `dist/assets/manta-map.json`. Se consultó la base de datos mediante Overpass API; la fecha de actualización de los datos queda registrada en `dataTimestamp` dentro del archivo.

## Alcance

- Límites del recorte: oeste **−80.785**, sur **−1.005**, este **−80.675**, norte **−0.915** (grados WGS84).
- Una línea costera real, unida a partir de los tramos OSM, con 284 puntos tras simplificación.
- Un polígono de tierra cerrado por los bordes sur del recorte. El océano queda al norte y noroeste de la costa.
- 2.252 segmentos de vías: se conservan las rutas principales y se toma una muestra determinista de las calles residenciales para mantener ligera la capa visual. Los trazados conservados mantienen su geometría geográfica.
- Seis referencias verificadas en OSM. Los cinco polígonos se ubican mediante los centros de sus geometrías envolventes; Tarqui usa el nodo OSM de lugar. No representan entradas exactas a edificios.

| Referencia                |   Longitud |   Latitud | Objeto de origen                                                   |
| ------------------------- | ---------: | --------: | ------------------------------------------------------------------ |
| Playa El Murciélago       | −80.729021 | −0.937450 | [way 32500785](https://www.openstreetmap.org/way/32500785)         |
| Mercado Central Municipal | −80.726142 | −0.949379 | [way 32687071](https://www.openstreetmap.org/way/32687071)         |
| Puerto de Manta           | −80.723689 | −0.936075 | [way 62172771](https://www.openstreetmap.org/way/62172771)         |
| ULEAM                     | −80.745279 | −0.952674 | [way 851414676](https://www.openstreetmap.org/way/851414676)       |
| Terminal Terrestre        | −80.690186 | −0.959739 | [way 1428211018](https://www.openstreetmap.org/way/1428211018)     |
| Tarqui                    | −80.714028 | −0.963676 | [node 10213104581](https://www.openstreetmap.org/node/10213104581) |

## Datos geográficos y simulación

La costa, las vías y las referencias anteriores son cartografía real. Las personas, conexiones de contagio, zonas de intensidad y estados del brote superpuestos son **sintéticos**. El mapa no contiene direcciones de personas ni casos sanitarios reales. La reproducción de la introducción es una visualización narrativa; no representa un brote observado.

La capa se descarga una vez para preparar el proyecto: el navegador sirve el JSON local y no depende de solicitudes a Overpass ni de teselas remotas para dibujar el mapa.

## Fuente, licencia y atribución

Fuente: [OpenStreetMap](https://www.openstreetmap.org/), obtenida mediante [Overpass API](https://overpass-api.de/api/interpreter).

Atribución que debe permanecer visible en el mapa: **© OpenStreetMap contributors**, con enlace a [Copyright and License](https://www.openstreetmap.org/copyright). Los datos cartográficos se distribuyen bajo [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). La licencia se aplica a la capa de datos OSM y sus adaptaciones; la interfaz y el motor de simulación son componentes separados.

Consulta usada sobre el área ampliada `(-1.035,-80.79,-0.91,-80.64)`:

```overpass
[out:json][timeout:45];
(
  way["natural"="coastline"](-1.035,-80.79,-0.91,-80.64);
  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential"](-1.035,-80.79,-0.91,-80.64);
  nwr["name"~"Murci|Universidad Laica|Mercado Central|Terminal Terrestre|Puerto de Manta",i](-1.035,-80.79,-0.91,-80.64);
);
out geom;
```

Tarqui se verificó adicionalmente con una consulta puntual a [Nominatim de OpenStreetMap](https://nominatim.openstreetmap.org/search?q=Tarqui%2C%20Manta%2C%20Ecuador&format=jsonv2&limit=3), que devolvió el nodo de suburbio 10213104581.

El área ampliada permite unir tramos completos antes de recortar y simplificar. No se han inferido carreteras ni trazado calles ficticias.

## Imagen satelital de referencia

`dist/assets/manta-satellite.webp` contiene una única imagen cartográfica exportada del servicio público **Esri World Imagery**. El metadato reproducible está en `dist/assets/manta-satellite.json`: resolución de **4096 × 3352 píxeles**, referencia **WGS84 / EPSG:4326**, y extensión `[-80.785, -1.005, -80.675, -0.915]`. La extensión devuelta por el servicio coincide con ese recorte salvo redondeo numérico. Las calles OSM y la imagen se alinean usando sus coordenadas geográficas; no se trata de una imagen generada.

La fotografía representa imágenes de archivo del proveedor. No es una cámara ni un satélite en vivo; sólo las animaciones de la simulación se calculan en tiempo de ejecución. La fecha exacta de captura puede variar entre las imágenes que forman el mosaico y no se afirma una fecha de adquisición concreta.

Atribución que debe permanecer visible: **Esri, Vantor, Earthstar Geographics, and the GIS User Community**. La capa vectorial sigue requiriendo además **© OpenStreetMap contributors**.

- [Servicio Esri World Imagery y metadatos](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer)
- [Elemento oficial y términos del proveedor](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)
- [Operación oficial Export Map](https://developers.arcgis.com/rest/services-reference/enterprise/export-map/)

Se obtuvo una sola imagen mediante la operación `export` del servicio MapServer, con `bboxSR=4326`, `imageSR=4326` y `size=2200,1800`. No se descargó un paquete de teselas ni se realizó una extracción masiva del servicio. La imagen conserva los términos de Esri y sus proveedores; no se incluye bajo la licencia ODbL de los datos OSM. La ficha oficial distingue esta capa del servicio específico destinado a exportar teselas para uso sin conexión.

La imagen de origen se actualizó a 4096 × 3352 para generar el vídeo en Full HD nativo, manteniendo el mismo recorte geográfico. La vista en perspectiva es una proyección visual de esa fotografía; no representa relieve o edificios reconstruidos en 3D.
