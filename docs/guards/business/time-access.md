# TimeBasedAccessGuard

Restringe el acceso a endpoints según la **hora y día de la semana**. Usa `Intl.DateTimeFormat` nativo — sin dependencias externas — para comparaciones timezone-aware. Soporta múltiples ventanas de acceso, días de la semana, ventanas nocturnas (que cruzan medianoche) y maintenance windows que bloquean el acceso independientemente del horario permitido.

```
GET /reports  (09:00–17:00 UTC, Lun–Vie)
  → Miércoles 14:00 UTC  ✅
  → Sábado    10:00 UTC  ❌ 403
  → Jueves    22:00 UTC  ❌ 403
```

---

## Archivos

```
src/guards/business/time-based-access.guard.ts
src/examples/level5-business.controller.ts   ← 5 endpoints de demo
scripts/test-time-based.ts
```

---

## Quick start

```bash
npm run start:dev
npm run test:time-based
```

---

## Uso

### Horario de oficina (L–V 9–18h)

```typescript
@SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
  allowedWindows: [{ start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }],
  timezone: 'America/Mexico_City',
})
@UseGuards(TimeBasedAccessGuard)
@Get('reports')
getReports() {}
// Solo lunes a viernes, 9am–6pm hora México
```

### Múltiples ventanas (por ejemplo, acceso en dos turnos)

```typescript
@SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
  allowedWindows: [
    { start: '06:00', end: '14:00', days: [1, 2, 3, 4, 5] },  // turno mañana
    { start: '14:00', end: '22:00', days: [1, 2, 3, 4, 5] },  // turno tarde
  ],
  timezone: 'America/Bogota',
})
@UseGuards(TimeBasedAccessGuard)
@Get('shift-data')
shiftData() {}
```

### Ventana nocturna (cruza medianoche)

```typescript
@SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
  allowedWindows: [{ start: '22:00', end: '06:00' }],
  timezone: 'UTC',
})
@UseGuards(TimeBasedAccessGuard)
@Get('batch-jobs')
batchJobs() {}
// Accesible de 22:00 a 06:00 — el guard detecta automáticamente que es overnight
```

### Maintenance window (bloquea aunque esté en horario permitido)

```typescript
@SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
  allowedWindows: [{ start: '00:00', end: '23:59' }],
  maintenanceWindows: [{ start: '02:00', end: '04:00' }],  // mantenimiento nocturno
  timezone: 'UTC',
})
@UseGuards(TimeBasedAccessGuard)
@Get('api')
api() {}
// Bloqueado entre 02:00–04:00 UTC aunque la allowedWindow sea 24/7
```

---

## Opciones

```typescript
export interface TimeWindow {
  start: string;    // 'HH:MM' en formato 24h
  end:   string;    // 'HH:MM' en formato 24h
  days?: number[];  // 0=Dom, 1=Lun ... 6=Sáb. Sin este campo = todos los días
}

export interface TimeAccessOptions {
  allowedWindows:     TimeWindow[];
  maintenanceWindows?: TimeWindow[];
  timezone?:          string;   // default: 'UTC'
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `allowedWindows` | — | Una o más ventanas de tiempo permitidas (OR — basta con estar en una) |
| `maintenanceWindows` | — | Ventanas de bloqueo total. Tienen **prioridad** sobre `allowedWindows` |
| `timezone` | `'UTC'` | Timezone IANA (ej: `'America/Mexico_City'`, `'Europe/Madrid'`) |
| `days` | todos | Días de semana donde aplica la ventana (0=Dom … 6=Sáb) |

---

## Lógica de evaluación

```
1. Obtener hora actual en el timezone configurado  (Intl.DateTimeFormat)
         ↓
2. ¿Está en alguna maintenanceWindow?
         ├── SÍ → 403 inmediato (maintenance tiene prioridad total)
         └── NO ↓
3. ¿Está en alguna allowedWindow?
         ├── SÍ → pasa ✅
         └── NO → 403
```

### Ventana overnight (cruza medianoche)

```
allowedWindow: { start: '22:00', end: '06:00' }

startMinutes (22*60=1320) > endMinutes (6*60=360) → overnight
Condición: currentMinutes >= 1320 OR currentMinutes < 360
```

---

## Sin dependencias externas

El guard usa `Intl.DateTimeFormat` nativo de Node.js para extraer hora, minuto y día de la semana en cualquier timezone IANA. No requiere `moment`, `date-fns` ni `luxon`.

```typescript
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone,
  hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
});
const parts = formatter.formatToParts(new Date());
// → [{ type: 'weekday', value: 'Wed' }, { type: 'hour', value: '14' }, ...]
```

---

## Comportamiento

| Situación | Status | Log |
|-----------|--------|-----|
| Dentro de una `allowedWindow` | `200` | — |
| Fuera de todas las `allowedWindows` | `403` | `WARN Access blocked — outside allowed hours (current: 22:05 UTC day=3)` |
| Dentro de una `maintenanceWindow` | `403` | `WARN Access blocked — maintenance window active` |
| Sin `@SetMetadata(TIME_ACCESS_OPTIONS, ...)` | `200` | — (guard no aplica) |

---

## Script de prueba

```bash
npm run test:time-based
```

Los resultados de `business-hours` y `overnight-access` dependen de la hora en que ejecutes el script:

```
Hora actual: Jue 03:59 UTC  |  México: mié 21:59

── always-open  (00:00–23:59 UTC) ──
✅ [200] Siempre pasa → PASS

── narrow-window  (00:00–00:01 UTC) ──
🚫 [403] Ventana de 1 min por hora (casi siempre bloqueado)

── under-maintenance  (maintenance 24h) ──
🚫 [403] Maintenance overrides allowedWindows → siempre bloqueado

── business-hours  (09:00–18:00 L–V, México City) ──
🚫 [403] fuera de horario laboral MX (L–V 9–18h)   ← son las 21:59 MX

── overnight-access  (22:00–06:00 UTC) ──
✅ [200] estás en la ventana nocturna (22–06 UTC)   ← son las 03:59 UTC
```

---

## Copiar a tu proyecto

1. Copia `time-based-access.guard.ts`
2. Copia `AccessOutsideAllowedHoursException` de `business.exception.ts`
3. Registra en tu módulo:

```typescript
@Module({
  providers: [TimeBasedAccessGuard],
})
export class TuModulo {}
```

4. Aplica en tus endpoints:

```typescript
@SetMetadata(GUARD_METADATA.TIME_ACCESS_OPTIONS, {
  allowedWindows: [{ start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] }],
  timezone: 'America/Mexico_City',
})
@UseGuards(TimeBasedAccessGuard)
@Get('restricted')
restricted() {}
```
