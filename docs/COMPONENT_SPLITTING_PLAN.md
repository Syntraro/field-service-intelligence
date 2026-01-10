# Component Splitting Plan

This document outlines the plan for splitting oversized React components into smaller, more maintainable pieces.

## Overview

| Component | Current Lines | Target | Priority |
|-----------|---------------|--------|----------|
| Calendar.tsx | 2,044 | <300 each | HIGH |
| ProductsServicesManager.tsx | 1,106 | <300 each | MEDIUM |
| Dashboard.tsx | 986 | <300 each | MEDIUM |

**Recommended Maximum**: 300 lines per component file

---

## 1. Calendar.tsx (2,044 lines)

### Current Structure Analysis
The Calendar component handles:
- Month/week/day view switching
- Job drag-and-drop scheduling
- Technician assignment
- Unscheduled jobs sidebar
- Job creation/editing dialogs
- Calendar navigation

### Proposed Split

```
client/src/pages/Calendar.tsx (main orchestrator, ~200 lines)
├── components/calendar/
│   ├── CalendarHeader.tsx (~100 lines)
│   │   - View mode selector (month/week/day)
│   │   - Date navigation
│   │   - Filter controls
│   │
│   ├── CalendarGrid.tsx (~250 lines)
│   │   - Main calendar grid rendering
│   │   - Day cell rendering
│   │   - Drop zone handling
│   │
│   ├── CalendarJobCard.tsx (~150 lines)
│   │   - Individual job card display
│   │   - Drag source handling
│   │   - Status indicators
│   │
│   ├── UnscheduledJobsSidebar.tsx (~200 lines)
│   │   - Unscheduled jobs list
│   │   - Search/filter
│   │   - Drag source for scheduling
│   │
│   ├── TechnicianColumn.tsx (~150 lines)
│   │   - Technician avatar/name
│   │   - Availability indicator
│   │   - Assignment drop zone
│   │
│   ├── JobQuickView.tsx (~150 lines)
│   │   - Hover/click job details
│   │   - Quick actions
│   │
│   └── hooks/
│       ├── useCalendarData.ts (~100 lines)
│       │   - Data fetching logic
│       │   - Query management
│       │
│       ├── useCalendarDragDrop.ts (~150 lines)
│       │   - DnD state management
│       │   - Drop handlers
│       │
│       └── useCalendarNavigation.ts (~50 lines)
│           - Date navigation logic
│           - View mode state
```

### Migration Steps
1. Extract hooks first (lowest risk)
2. Extract stateless presentation components
3. Extract sidebar components
4. Refactor main Calendar to orchestrate sub-components

---

## 2. ProductsServicesManager.tsx (1,106 lines)

### Current Structure Analysis
The component handles:
- Products/Services CRUD
- Category management
- Pricing calculations
- Import/export functionality
- Table display with sorting/filtering

### Proposed Split

```
client/src/components/ProductsServicesManager.tsx (main, ~150 lines)
├── components/products/
│   ├── ProductsTable.tsx (~200 lines)
│   │   - Table rendering
│   │   - Column definitions
│   │   - Sorting/filtering UI
│   │
│   ├── ProductForm.tsx (~200 lines)
│   │   - Create/edit form
│   │   - Validation
│   │   - Price calculation
│   │
│   ├── ProductRow.tsx (~100 lines)
│   │   - Individual row rendering
│   │   - Inline actions
│   │
│   ├── CategoryFilter.tsx (~80 lines)
│   │   - Category dropdown
│   │   - Filter logic
│   │
│   ├── ProductImportDialog.tsx (~150 lines)
│   │   - CSV import UI
│   │   - Validation feedback
│   │
│   └── hooks/
│       ├── useProducts.ts (~100 lines)
│       │   - CRUD operations
│       │   - Optimistic updates
│       │
│       └── usePriceCalculation.ts (~50 lines)
│           - Markup calculations
│           - Tax handling
```

---

## 3. Dashboard.tsx (986 lines)

### Current Structure Analysis
The Dashboard handles:
- Overview statistics cards
- Recent jobs list
- Upcoming schedules
- Quick actions
- Charts/visualizations

### Proposed Split

```
client/src/pages/Dashboard.tsx (main, ~150 lines)
├── components/dashboard/
│   ├── StatsCards.tsx (~150 lines)
│   │   - Jobs stats
│   │   - Invoice stats
│   │   - Client stats
│   │
│   ├── RecentJobsList.tsx (~150 lines)
│   │   - Recent jobs table
│   │   - Status badges
│   │   - Quick actions
│   │
│   ├── UpcomingSchedule.tsx (~150 lines)
│   │   - Today's schedule
│   │   - Week preview
│   │
│   ├── QuickActions.tsx (~100 lines)
│   │   - New job button
│   │   - New client button
│   │   - Common actions
│   │
│   ├── OverdueAlerts.tsx (~100 lines)
│   │   - Overdue jobs
│   │   - Overdue invoices
│   │
│   └── hooks/
│       └── useDashboardData.ts (~100 lines)
│           - Aggregated data fetching
│           - Stats calculations
```

---

## Implementation Guidelines

### 1. Extract Hooks First
Custom hooks are the safest starting point:
- No UI changes
- Easy to test in isolation
- Immediate code reduction

### 2. Use Composition Over Props Drilling
```tsx
// Bad: Props drilling
<Calendar
  jobs={jobs}
  technicians={technicians}
  onJobClick={handleJobClick}
  onDrop={handleDrop}
  // ...20 more props
/>

// Good: Context + composition
<CalendarProvider>
  <CalendarHeader />
  <CalendarGrid />
  <UnscheduledSidebar />
</CalendarProvider>
```

### 3. Co-locate Related Code
Keep related components together:
```
components/calendar/
├── index.ts          # Public exports
├── Calendar.tsx      # Main component
├── CalendarGrid.tsx  # Sub-component
├── types.ts          # Shared types
└── hooks/            # Related hooks
```

### 4. Gradual Migration
1. Create new component files
2. Import into existing file
3. Replace inline code with component
4. Test thoroughly
5. Repeat

---

## Priority Order

1. **Calendar.tsx** - Highest complexity, most benefit from splitting
2. **ProductsServicesManager.tsx** - Medium complexity, self-contained
3. **Dashboard.tsx** - Lower complexity, mostly display logic

---

## Estimated Effort

| Component | Effort | Risk |
|-----------|--------|------|
| Calendar.tsx | 8-12 hours | Medium |
| ProductsServicesManager.tsx | 4-6 hours | Low |
| Dashboard.tsx | 3-4 hours | Low |

**Total**: 15-22 hours of focused refactoring

---

*Document created: 2026-01-10*
