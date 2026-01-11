# HVAC/R Maintenance Scheduler

## Overview

This project is a preventive maintenance scheduling application designed for HVAC/R contractors. Its primary goal is to streamline client contract management, automate maintenance scheduling, and track parts inventory. The application provides a comprehensive dashboard displaying overdue maintenance, upcoming schedules, and completed work, aiming to significantly enhance operational efficiency, reduce downtime, and improve client satisfaction. The business vision is to deliver a robust tool that supports efficient maintenance operations and optimizes resource management for HVAC/R businesses.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is developed using React and TypeScript with Vite. It employs `wouter` for routing, `shadcn/ui` (built on Radix UI) styled with Tailwind CSS, adhering to Material Design principles. TanStack Query manages state and data fetching, while React Hook Form and Zod handle form management and validation. The component structure follows an atomic design pattern.

### Backend
The backend is an Express.js server written in TypeScript, providing a RESTful API. It uses a PostgreSQL database (Neon serverless) with Drizzle ORM for data persistence, managing clients, parts, and their relationships with enforced data integrity via foreign key constraints.

### Soft Delete Standard
All soft-deletable tables use `deletedAt` timestamp as the canonical mechanism:
- **Active row**: `deletedAt IS NULL`
- **Soft-deleted row**: `deletedAt IS NOT NULL`
- **Legacy `isActive`**: Kept for transition period with dual-write; use `deletedAt` in all new queries
- **Tables with deletedAt**: users, client_locations, customer_companies, items, equipment, invoices, jobs, job_parts, job_templates, location_equipment, location_pm_plans, location_pm_part_templates, recurring_job_series, suppliers, supplier_locations, technicians

### Design System
The application features a Material Design-inspired typography with the Inter font family, consistent spacing, and a responsive 12-column grid system (mobile-first). The color system uses CSS custom properties, and key UI patterns include stats cards, maintenance cards, and dialog-based forms.

### Key Features & Technical Implementations
- **Client & Parts Management**: Includes client deletion, inactive status, CSV import for clients, and comprehensive parts inventory with custom parts and categorized selection.
- **Maintenance Scheduling**: Supports monthly PM reports, tracking recently completed maintenance with an undo option, and automated next due date assignment.
- **Authentication & Authorization**: Implements a secure Role-Based Access Control (RBAC) system with 5 default roles (Owner, Admin, Manager, Dispatcher, Technician), 24 granular permissions, and user-level overrides. Includes technician profiles with labor costs, billable rates, and working hours.
- **Mobile Technician Dashboard**: An optimized view for field technicians displaying schedules, client details, parts inventory, and equipment information.
- **Subscription System**: A feature-flagged tiered subscription model with location limits and usage tracking, designed for future Stripe integration.
- **Route Optimization**: Integrates with OpenRouteService API for efficient technician routing, including GPS conversion, optimal sequencing, and interactive map visualization.
- **Calendar Cleanup**: Automatically removes invalid calendar assignments when client PM months are updated, while preserving completed jobs.
- **Platform Admin Impersonation**: A secure system for platform administrators to impersonate company admins for support, featuring server-side session management, time limits, and audit trails.
- **Client Notes System**: Allows for multiple timestamped notes per client with full CRUD capabilities.
- **Workflow-First Client Detail Page**: Redesigned client detail page with tabs for Overview, Jobs, Locations, Parts, and Notes, including quick actions and filtered job views.
- **QuickBooks Online (QBO) Sync Infrastructure**: Supports QBO Customer/Sub-Customer hierarchy, bidirectional mapping between app entities and QBO payloads, and a QBO Sync Service for create/update/deactivate operations.
- **Invoice System with QBO Integration**: A complete invoicing system with status workflow, QBO sync fields, and billing logic that integrates with QBO for invoice creation, updates, and voiding.
- **Jobs System**: A comprehensive dispatching system supporting various job statuses, priority levels, job types, technician assignment, and recurring job series. It includes atomic job number sequences and date/location-based filtering.
- **Equipment Tracking System**: Manages location-level equipment assets, links equipment to jobs for service history tracking, and integrates with PM templates for automatic job generation.
- **Job Templates System**: Provides reusable templates for job parts and billing configurations, allowing for creation, editing, and application of default templates per job type.
- **Enhanced Job/Invoice Workflow**: Unified header cards with clickable client names, automatic "Invoiced" status on jobs when linked, "Sent/Not Sent" invoice status labels, 15-minute time picker increments, and Assigned Technicians & Visits displayed as header mini-cards.
- **Invoice Client Visibility Controls**: Per-invoice toggles to control what clients see (line items, quantities, unit prices, line totals, account balance), with collapsible Job Description section for client-facing work performed summaries.
- **Company Tax Settings**: Configurable tax name and default rate per company, displayed dynamically on invoice totals (e.g., "HST (13%)").

## External Dependencies

### Database
- **Neon PostgreSQL**: Serverless PostgreSQL database.
- **Drizzle ORM**: TypeScript ORM for database interactions.

### UI Libraries
- **Radix UI**: Unstyled, accessible component primitives.
- **Tailwind CSS**: Utility-first CSS framework.
- **shadcn/ui**: Pre-built component library configuration.
- **Lucide React**: Icon library.
- **date-fns**: Date manipulation and formatting utility.
- **Leaflet / react-leaflet**: Interactive map visualization.

### Form & Validation
- **React Hook Form**: Performant form state management.
- **Zod**: TypeScript-first schema validation.
- **@hookform/resolvers**: Zod integration for React Hook Form.

### State Management
- **TanStack Query (React Query)**: Server state management, caching, and synchronization.

### Development Tools
- **Vite**: Fast build tool and development server.
- **TypeScript**: Ensures type safety across the application.

### Additional Libraries
- **wouter**: Lightweight client-side routing.
- **class-variance-authority**: Type-safe component variant management.
- **clsx** & **tailwind-merge**: Utilities for conditional class names.
- **OpenRouteService API**: External API for geocoding and route optimization.