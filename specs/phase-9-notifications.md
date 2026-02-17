# Phase 9: Notification Delivery Engine

## Overview
Build the backend notification service that delivers alerts to Discord, Pushover,
and email (SMTP) when alert conditions fire. The frontend config UI already exists
(NotificationsTab in Phase 8 Settings). This phase wires up actual delivery.

## Components

### 1. NotificationService (`backend/app/services/notification_service.py`)
- Singleton service with `send(alert, config)` method
- Channel dispatchers: Discord webhook, Pushover API, SMTP email
- Respects `notify_on` severity filter from config
- Cooldown logic: skip if same alert sent within `cooldown_minutes`
- Recovery notifications: send "resolved" when alert clears (if `notify_on_recovery`)
- Delivery history: in-memory ring buffer (last 100), exposed via API
- Rate limiting: max 30 notifications/minute per channel

### 2. Discord Dispatcher
- POST to webhook URL with rich embed (color-coded by severity)
- Fields: device name, alert type, severity, timestamp, details
- Mention role from config (default @here)
- Test endpoint for settings UI "Test" button

### 3. Pushover Dispatcher
- POST to api.pushover.net/1/messages.json
- Priority mapping: critical→emergency(2), high→high(1), medium→normal(0), low→low(-1)
- Emergency priority: retry=60, expire=3600
- Sound: siren for critical, mechanical for high, default for others

### 4. SMTP Email Dispatcher
- HTML email template with alert details
- Configurable recipients, subject prefix
- TLS support

### 5. API Endpoints (`backend/app/routers/notifications.py`)
- GET /api/notifications/history - delivery history
- POST /api/notifications/test/{channel} - test a channel (discord/pushover/email)
- GET /api/notifications/stats - delivery stats (sent/failed/cooldown counts)

### 6. Integration Points
- Hook into existing alert generation in `alerts.py`
- When new alert detected → check severity against notify_on → dispatch
- When alert resolves → send recovery if enabled
- Demo mode: log notifications instead of sending (return mock success)

### 7. Frontend Updates
- Add "Test" buttons to NotificationsTab channel cards (wire to test endpoint)
- Add NotificationHistoryPanel component (shows recent deliveries in settings or alerts page)

## Files to Create/Modify
- CREATE: `backend/app/services/notification_service.py`
- CREATE: `backend/app/routers/notifications.py`
- CREATE: `frontend/src/components/Settings/NotificationHistory.tsx`
- MODIFY: `backend/app/main.py` (register router)
- MODIFY: `backend/app/routers/alerts.py` (hook notification dispatch)
- MODIFY: `frontend/src/components/Settings/NotificationsTab.tsx` (add test buttons)
- MODIFY: `backend/app/config.py` (add email config if missing)
