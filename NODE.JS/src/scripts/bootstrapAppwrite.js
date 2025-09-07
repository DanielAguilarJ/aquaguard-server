// Bootstrap de Appwrite: crea/asegura DB, colecciones, atributos e índices requeridos
// Requiere variables de entorno APPWRITE_* y permisos de API Key para Database (write/admin)
require('dotenv').config();
const { Client, Databases } = require('node-appwrite');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    APPWRITE_API_KEY,
    APPWRITE_DATABASE_ID,
    APPWRITE_SENSOR_READINGS_COLLECTION_ID,
    APPWRITE_DEVICES_COLLECTION_ID,
    APPWRITE_ALERTS_COLLECTION_ID,
    APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID
  } = process.env;

  if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
    console.error('[bootstrap] Faltan variables APPWRITE_ENDPOINT/PROJECT_ID/API_KEY');
    process.exit(1);
  }
  if (!APPWRITE_DATABASE_ID || !APPWRITE_SENSOR_READINGS_COLLECTION_ID) {
    console.error('[bootstrap] Faltan APPWRITE_DATABASE_ID o APPWRITE_SENSOR_READINGS_COLLECTION_ID');
    process.exit(1);
  }

  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);
  const databases = new Databases(client);

  // Helpers de creación con idempotencia (ignora 409 ya existente)
  const ensure = async (fn, args, label) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err && (err.code === 409 || err.response?.status === 409)) {
        console.log(`[bootstrap] ${label} ya existe`);
        return null;
      }
      console.error(`[bootstrap] Error creando ${label}:`, err?.message || err);
      throw err;
    }
  };

  // 1) DB
  await ensure(databases.create, [APPWRITE_DATABASE_ID, APPWRITE_DATABASE_ID, 'AquaGuard Database'], `DB ${APPWRITE_DATABASE_ID}`);

  // 2) Colección de lecturas de sensor
  await ensure(
    databases.createCollection,
    [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, {
      permissions: [],
      documentSecurity: true
    }],
    `Collection ${APPWRITE_SENSOR_READINGS_COLLECTION_ID}`
  );

  // Atributos requeridos (camelCase)
  const createAttrs = [
    () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'deviceId', 128, true], 'attr deviceId'),
    () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'sensorType', 64, true], 'attr sensorType'),
    () => ensure(databases.createFloatAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'value', true], 'attr value'),
    () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'unit', 16, false], 'attr unit'),
    () => ensure(databases.createDatetimeAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'timestamp', false], 'attr timestamp'),
    () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'location', 256, false], 'attr location'),
    () => ensure(databases.createBooleanAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'isAnomalous', false], 'attr isAnomalous'),
    () => ensure(databases.createDatetimeAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'ingestedAt', false], 'attr ingestedAt'),
    () => ensure(databases.createJsonAttribute, [APPWRITE_DATABASE_ID, APPWRITE_SENSOR_READINGS_COLLECTION_ID, 'metadata', false], 'attr metadata'),
  ];
  for (const create of createAttrs) {
    try { await create(); } catch (_) {}
    await sleep(150); // Pequeña pausa para que Appwrite aplique cambios
  }

  // Índices útiles
  await ensure(databases.createIndex, [
    APPWRITE_DATABASE_ID,
    APPWRITE_SENSOR_READINGS_COLLECTION_ID,
    'idx_device_timestamp',
    'key',
    ['deviceId', 'timestamp'],
    ['asc', 'desc']
  ], 'index idx_device_timestamp');

  await ensure(databases.createIndex, [
    APPWRITE_DATABASE_ID,
    APPWRITE_SENSOR_READINGS_COLLECTION_ID,
    'idx_sensorType',
    'key',
    ['sensorType'],
    ['asc']
  ], 'index idx_sensorType');

  // 3) Colección de dispositivos (si se define)
  if (APPWRITE_DEVICES_COLLECTION_ID) {
    await ensure(
      databases.createCollection,
      [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, APPWRITE_DEVICES_COLLECTION_ID, { permissions: [], documentSecurity: true }],
      `Collection ${APPWRITE_DEVICES_COLLECTION_ID}`
    );

    const deviceAttrs = [
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'deviceId', 128, true], 'devices.deviceId'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'serialNumber', 128, false], 'devices.serialNumber'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'name', 128, false], 'devices.name'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'location', 256, false], 'devices.location'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'macAddress', 64, false], 'devices.macAddress'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'wifiSSID', 128, false], 'devices.wifiSSID'),
      () => ensure(databases.createBooleanAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'isOnline', false], 'devices.isOnline'),
      () => ensure(databases.createFloatAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'batteryLevel', false], 'devices.batteryLevel'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'firmwareVersion', 64, false], 'devices.firmwareVersion'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'deviceType', 64, false], 'devices.deviceType'),
      () => ensure(databases.createDatetimeAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'createdAt', false], 'devices.createdAt'),
      () => ensure(databases.createDatetimeAttribute, [APPWRITE_DATABASE_ID, APPWRITE_DEVICES_COLLECTION_ID, 'lastSeen', false], 'devices.lastSeen')
    ];
    for (const create of deviceAttrs) {
      try { await create(); } catch (_) {}
      await sleep(150);
    }

    await ensure(databases.createIndex, [
      APPWRITE_DATABASE_ID,
      APPWRITE_DEVICES_COLLECTION_ID,
      'idx_deviceId',
      'key',
      ['deviceId'],
      ['asc']
    ], 'devices.idx_deviceId');
  }

  // 4) Colección de alerts (si se define) - esquema mínimo genérico
  if (APPWRITE_ALERTS_COLLECTION_ID) {
    await ensure(
      databases.createCollection,
      [APPWRITE_DATABASE_ID, APPWRITE_ALERTS_COLLECTION_ID, APPWRITE_ALERTS_COLLECTION_ID, { permissions: [], documentSecurity: true }],
      `Collection ${APPWRITE_ALERTS_COLLECTION_ID}`
    );

    const alertAttrs = [
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_ALERTS_COLLECTION_ID, 'deviceId', 128, true], 'alerts.deviceId'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_ALERTS_COLLECTION_ID, 'type', 64, true], 'alerts.type'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_ALERTS_COLLECTION_ID, 'severity', 32, true], 'alerts.severity'),
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_ALERTS_COLLECTION_ID, 'message', 1024, false], 'alerts.message'),
      () => ensure(databases.createDatetimeAttribute, [APPWRITE_DATABASE_ID, APPWRITE_ALERTS_COLLECTION_ID, 'timestamp', true], 'alerts.timestamp'),
      () => ensure(databases.createJsonAttribute, [APPWRITE_DATABASE_ID, APPWRITE_ALERTS_COLLECTION_ID, 'metadata', false], 'alerts.metadata')
    ];
    for (const create of alertAttrs) {
      try { await create(); } catch (_) {}
      await sleep(150);
    }

    await ensure(databases.createIndex, [
      APPWRITE_DATABASE_ID,
      APPWRITE_ALERTS_COLLECTION_ID,
      'idx_device_timestamp',
      'key',
      ['deviceId', 'timestamp'],
      ['asc', 'desc']
    ], 'alerts.idx_device_timestamp');
  }

  // 5) Colección de leak_predictions (si se define)
  if (APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID) {
    await ensure(
      databases.createCollection,
      [APPWRITE_DATABASE_ID, APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID, APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID, { permissions: [], documentSecurity: true }],
      `Collection ${APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID}`
    );

    const leakAttrs = [
      () => ensure(databases.createStringAttribute, [APPWRITE_DATABASE_ID, APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID, 'deviceLocation', 256, true], 'leaks.deviceLocation'),
      () => ensure(databases.createFloatAttribute, [APPWRITE_DATABASE_ID, APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID, 'probability', true], 'leaks.probability'),
      () => ensure(databases.createFloatAttribute, [APPWRITE_DATABASE_ID, APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID, 'confidence', true], 'leaks.confidence'),
      () => ensure(databases.createDatetimeAttribute, [APPWRITE_DATABASE_ID, APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID, 'timestamp', true], 'leaks.timestamp'),
      () => ensure(databases.createJsonAttribute, [APPWRITE_DATABASE_ID, APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID, 'contributingFactors', false], 'leaks.contributingFactors')
    ];
    for (const create of leakAttrs) {
      try { await create(); } catch (_) {}
      await sleep(150);
    }

    await ensure(databases.createIndex, [
      APPWRITE_DATABASE_ID,
      APPWRITE_LEAK_PREDICTIONS_COLLECTION_ID,
      'idx_location_timestamp',
      'key',
      ['deviceLocation', 'timestamp'],
      ['asc', 'desc']
    ], 'leaks.idx_location_timestamp');
  }

  console.log('[bootstrap] Appwrite listo. DB y colecciones verificadas.');
}

main().catch((e) => {
  console.error('[bootstrap] Error fatal:', e?.message || e);
  process.exit(1);
});
