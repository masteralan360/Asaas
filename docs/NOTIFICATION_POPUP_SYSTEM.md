# Notification Popup System Documentation

## Overview
The Notification Popup System is a scalable, registry-driven architecture designed to intercept Novu notifications and display specialized UI modals (popups) based on notification content or metadata. This allows for dynamic user interaction (e.g., roadmap updates, forced feature toggles) driven directly from the Novu notification cloud.

## Core Architecture

The system is built on a "Registry-Driven Rule Engine" to ensure scalability and maintainability.

### 1. Central Registry (`src/lib/notificationPopups.ts`)
The `POPUP_REGISTRY` is the single source of truth. It maps "Popup IDs" to React components and defines the rules for when each should appear.

### 2. Rule Engine
Each popup in the registry has a `rules` object. The engine iterates through the registry and performs a logical **AND** check on all specified rules:
- `enabled`: Global toggle for the popup.
- `subjectMatch`: Exact string match for the notification subject.
- `contentMatch`: Exact string match for the notification body/content.
- `workflowSlug`: Match for the Novu workflow identifier.

### 3. Controller (`src/ui/components/popups/NotificationPopupController.tsx`)
The controller acts as a dynamic renderer. It:
- Receives the raw notification data.
- Asks the library to resolve a `popupId`.
- Looks up the component and injects the corresponding configuration rules via the `config` prop.

## Configuration Guide

### Adding a New Modal
1. **Create the UI Component**: Add a new `.tsx` file in `src/ui/components/popups/`.
2. **Accept Config Prop**: Ensure the component accepts a `config` prop to receive its rules dynamically.
3. **Register**: Add the component to the `POPUP_REGISTRY` in `notificationPopups.ts`.

### Example Registry Entry
```typescript
{
    id: 'roadmap-v1',
    component: RoadmapModal,
    rules: {
        enabled: true,
        subjectMatch: "New Roadmap",
        contentMatch: "Roadmap",
        preventOutsideClose: true // UI-specific flag
    }
}
```

## Advanced Patterns

### Override Behavior
The registry is an **array**. The engine scans from top to bottom. The first modal that satisfies all its rules will be the one displayed. This allows you to set high-priority "Roadblock" modals at the top of the list.

### Circular Dependency Safety
Components **must not** import constants or the registry from `notificationPopups.ts`. Instead, they should rely solely on the `config` prop passed down by the `NotificationPopupController`. This prevents runtime `ReferenceErrors` during application boot.

## Notification Metadata Mapping
- **Subject**: `notification.subject`
- **Content**: `notification.body` or `notification.content`
- **Identifier**: `notification.workflow.slug` or `notification.transactionId`
