# Ponte en Pista · prototipo de demostración

Plataforma de software libre (AGPL-3.0) para reservar instalaciones deportivas municipales y entrar con un QR firmado o con un botón en el móvil.
Prototipo para el **I Certame GOBTEC de Software Libre** (Ponte Strategy, S.L.).

## Despliegue con Docker

```bash
docker compose up -d --build        # web + API en http://localhost:8000 y broker MQTT en :1883
docker compose logs -f app          # ver arranque
docker compose down                 # parar (los datos persisten en el volumen pista-data)
docker compose down -v              # parar y borrar los datos
```
Otro puerto: `PORT=9000 docker compose up -d --build`. Solo la app, sin broker: `docker build -t ponte-en-pista . && docker run -d -p 8000:8000 -v pista-data:/data ponte-en-pista`.

## Qué incluye
Catálogo público · reglas de reparto y tarifas visibles al reservar · identificación por niveles · reserva, cambio, cancelación y lista de espera · QR Ed25519 + código alternativo · .ics y suscripción de calendario ·
persona validadora con modo sin conexión · **puerta simulada** (QR, teclado, botón + pulsador de 30 s, sin red, anulaciones, luz, sensor, mensajes MQTT) · reserva asistida por teléfono/oficina con excepciones auditadas ·
incidencias operativas/técnicas · menores y personas tutoras · normas versionadas · reservas de tempada · indicadores y exportación CSV/JSON · multi-concello (una BD por concello) · galego/castellano · PWA ·
cursos breves · API REST en `/api/docs`.

Guía de demostración dentro de la app: `/#/demo`.

## Simulado en la demo
Cl@ve, certificado, códigos SMS/correo (siempre `123456`), WebAuthn y la puerta física (controlador simulado en el servidor con el mismo protocolo MQTT; broker opcional).
El reloj de la demo se puede mover para probar la puerta a la hora de una reserva. El motor es FastAPI + SQLite; en producción la API la sirve Odoo Community + OCA.

## Credenciales de demo
Personal: contraseña `demo` y código 2FA `123456` (carmen@vilaverde.example gestora, jose@vilaverde.example validador, soporte@ponte.example asistencia), o atajos en `/#/demo`.

## Pruebas
`python tests/smoke.py http://localhost:8000` (30 comprobaciones de la API).

## Despliegue público con HTTPS
En un servidor con Docker y el DNS de `pista.pontestrategy.com` apuntando a él:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.publico.yml up -d --build
crontab deploy/reset-demo.cron   # reinicio nocturno de los datos de prueba
```
Solo queda abierto el 443 (y el 80 para el certificado). El broker MQTT no se expone: en la demo no tiene autenticación ni TLS.

## Licencia
Código: [GNU AGPL-3.0-or-later](LICENSE). Diseño de hardware de la puerta: CERN-OHL-S-2.0.
Copyright (C) 2026 Ponte Strategy, S.L.
