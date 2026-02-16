# Phase 8: Settings UI

## Overview
Wire up the existing Settings components into a full Settings page with tab navigation, accessible via `#settings` route and the header gear icon. Add missing Discovery tab and user management section.

## Current State (Already Built)
- **Backend**: `routers/settings.py` — GET/PUT/PATCH config, POST test-connection, GET status (fully functional)
- **Backend**: `config.py` — `persist_config()`, `mask_secrets()`, `merge_config()`, `get_config_dict()`
- **Frontend Store**: `settingsApiStore.ts` — fetch/save/testConnection, dirty tracking, tab state
- **Frontend Components** (7 tabs, ~990 LOC):
  - `IntegrationsTab.tsx` — LibreNMS, Proxmox, InfluxDB, Netdisco with connection test buttons
  - `PollingTab.tsx` — Polling intervals
  - `AlertsTab.tsx` — CPU/memory/interface thresholds
  - `NotificationsTab.tsx` — Discord, Pushover, Email, Twilio channels
  - `SpeedtestTab.tsx` — Speedtest config
  - `AboutTab.tsx` — Version/system info
  - `SettingsTab.tsx` — Reusable wrapper with save button, dirty indicator, demo mode badge
  - `SecretInput.tsx` — Password input with show/hide toggle
  - `ConnectionTest.tsx` — Test connection button with status indicator

## What Needs Building

### 1. SettingsPage.tsx (`frontend/src/pages/SettingsPage.tsx`)
- Full-page view (same pattern as HistoryPage/DocsPage)
- Left sidebar with tab navigation (icons + labels)
- Tabs: Integrations, Polling, Alerts, Notifications, Speedtest, Discovery, Users, About
- Admin-only gate (redirect to `#/` if not admin in non-demo mode)
- Demo mode: all tabs visible but read-only (existing SettingsTab wrapper handles this)
- Fetch settings + status on mount
- Dark theme matching existing pages

### 2. Discovery Tab (`frontend/src/components/Settings/DiscoveryTab.tsx`)
- VM subnets list (add/remove)
- Include types checkboxes (firewall, network, server, wireless)
- Auto-sync toggle + interval input
- Matches existing tab component pattern

### 3. Users Tab (`frontend/src/components/Settings/UsersTab.tsx`)
- Current user info display
- Change password form (uses existing `/api/auth/change-password`)
- Future: multi-user management (Phase 8.5, just show placeholder)

### 4. Route + Navigation
- `App.tsx`: Add `#settings` route → `<SettingsPage />`
- `Header.tsx`: Settings gear icon links to `#settings`
- Back-to-dashboard link in SettingsPage header

### 5. Auth Token in API Calls
- `settingsApiStore.ts` fetch calls need Authorization header from `authStore`
- Currently missing auth headers (would fail in non-demo mode)

## Files to Create
- `frontend/src/pages/SettingsPage.tsx`
- `frontend/src/components/Settings/DiscoveryTab.tsx`
- `frontend/src/components/Settings/UsersTab.tsx`

## Files to Modify
- `frontend/src/App.tsx` — add settings route
- `frontend/src/components/Layout/Header.tsx` — wire gear icon to `#settings`
- `frontend/src/store/settingsApiStore.ts` — add auth headers to all fetch calls

## Design
- Consistent with HistoryPage/DocsPage (full-page, own header with back link)
- Tab sidebar on left (desktop), horizontal tabs (mobile)
- S³ badge in header
- Unsaved changes indicator in tab labels
