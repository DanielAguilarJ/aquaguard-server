# AquaGuard Telemetría Gateway (Node.js)

Backend Express listo para DigitalOcean App Platform y Appwrite. Expone endpoints seguros para autenticación de dispositivos ESP8266 y la ingesta de telemetría (individual y en lote).

## Endpoints
- POST /auth/token
- GET  /health
- POST /ingest
- POST /ingest/bulk

## Requisitos
- Node.js 18+
- Proyecto Appwrite con base de datos y colección configuradas

## Instalación local
```bash
npm install
cp .env.sample .env
# edita .env con tus credenciales
npm run dev
```

## Variables de entorno (clave)
- PORT, NODE_ENV, LOG_LEVEL, ALLOWED_ORIGINS
- DEVICE_SECRET_PREFIX, JWT_SECRET, JWT_EXPIRES_IN
- APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID
- RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, INGEST_RATE_LIMIT_WINDOW_MS, INGEST_RATE_LIMIT_MAX_REQUESTS

## Inicializar Appwrite (opcional pero recomendado)
Con las variables de `.env` completas y un API Key con permisos de Database (crear colecciones/atributos), ejecuta:
```bash
npm run bootstrap:appwrite
```
Esto asegura la base de datos y la colección de lecturas con los atributos:
- deviceId (string), sensorType (string), value (float), unit (string), timestamp (datetime), location (string), isAnomalous (boolean), ingestedAt (datetime), metadata (json)

## Esquema de documentos en Appwrite (colección de lecturas)
- deviceId: string
- sensorType: string (flow, pressure, temperature, humidity, ph, turbidity, dissolvedOxygen, conductivity)
- value: number
- unit: string (p. ej. °C, L/min)
- timestamp: ISO8601
- location: string
- isAnomalous: boolean
- ingestedAt: ISO8601
- metadata: object

## Docker (opcional)
```bash
# build
docker build -t aquaguard-gateway .
# run
docker run --env-file .env -p 3000:3000 aquaguard-gateway
```

## DigitalOcean App Platform
- No requiere Docker. App Platform detecta Node y ejecuta `npm start`.
- Usa el spec `.do/app.yaml` (actualiza el nombre del repo si es necesario) o configura variables en el panel.

## Notas
- El gateway valida que `deviceId` en el payload coincida con el del token JWT.
- Para dispositivos: deviceSecret = DEVICE_SECRET_PREFIX + deviceId.
