import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Users,
  Briefcase,
  DollarSign,
  Zap,
  Settings,
  Wrench,
  Clock,
  Globe,
  Lock,
  Receipt,
  Tag,
  ListTree,
  FileText,
  FileCheck,
  Bell,
  FormInput,
  Upload,
  Settings2,
  CreditCard,
  Timer,
  ClipboardList,
} from "lucide-react";

export interface SettingsChild {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  keywords?: string[];
}

export interface SettingsCategory {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  children: SettingsChild[];
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    key: "company",
    title: "Company",
    description: "Business info, hours, and regional preferences",
    icon: Building2,
    children: [
      {
        key: "company-information",
        title: "Company Information",
        description: "Name, address, and contact details",
        href: "/settings/company/information",
        icon: Building2,
        keywords: ["name", "address", "phone", "email", "contact"],
      },
      {
        key: "company-business-hours",
        title: "Business Hours",
        description: "Operating hours and scheduling buffer",
        href: "/settings/business-hours",
        icon: Clock,
        keywords: ["hours", "schedule", "open", "close", "days", "buffer"],
      },
      {
        key: "company-regional",
        title: "Regional Settings",
        description: "Timezone, date format, and locale",
        href: "/settings/company/regional",
        icon: Globe,
        keywords: ["timezone", "date format", "time format", "locale", "week"],
      },
    ],
  },
  {
    key: "team",
    title: "Team",
    description: "Manage staff and permissions",
    icon: Users,
    children: [
      {
        key: "team-members",
        title: "Team Members",
        description: "Manage staff, technicians, and schedules",
        href: "/settings/team",
        icon: Users,
        keywords: ["technicians", "staff", "employees", "workers", "members", "schedules"],
      },
      {
        key: "team-roles",
        title: "Roles & Permissions",
        description: "Access levels and capabilities",
        href: "/manage-roles",
        icon: Lock,
        keywords: ["access", "permissions", "admin", "manager", "dispatcher", "roles"],
      },
    ],
  },
  {
    key: "operations",
    title: "Operations",
    description: "Categories and tags",
    icon: Briefcase,
    children: [
      {
        key: "operations-categories",
        title: "Job Categories",
        description: "Organize jobs by category",
        href: "/price-book?view=categories",
        icon: ListTree,
        keywords: ["categories", "job types", "organize", "types"],
      },
      {
        key: "operations-tags",
        title: "Tags & Labels",
        description: "Client and location tags",
        href: "/settings/tags",
        icon: Tag,
        keywords: ["tags", "labels", "categorize", "filter", "client tags"],
      },
    ],
  },
  {
    key: "financials",
    title: "Financials",
    description: "Billing, payments, and subscription",
    icon: DollarSign,
    children: [
      {
        key: "financials-tax",
        title: "Tax Settings",
        description: "Tax rates and billing rules",
        href: "/settings/tax-billing",
        icon: Receipt,
        keywords: ["tax", "GST", "HST", "VAT", "rates", "billing rules"],
      },
      {
        key: "financials-time-billing",
        title: "Time & Materials Billing",
        description: "Labour rates and billable time rules",
        href: "/settings/time-billing",
        icon: Timer,
        keywords: ["time billing", "labour", "materials", "rates", "billable"],
      },
      {
        key: "financials-payments",
        title: "Payments",
        description: "Accept card payments and connect bank",
        href: "/settings/payments",
        icon: CreditCard,
        keywords: ["payments", "stripe", "card", "bank", "payout", "online payments"],
      },
      {
        key: "financials-subscription",
        title: "Subscription",
        description: "Billing plan and subscription status",
        href: "/settings/subscription",
        icon: Receipt,
        keywords: ["subscription", "plan", "billing", "renewal", "upgrade"],
      },
    ],
  },
  {
    key: "automation",
    title: "Automation",
    description: "Templates and notifications",
    icon: Zap,
    children: [
      {
        key: "automation-job-templates",
        title: "Job Templates",
        description: "Reusable job configurations",
        href: "/settings/job-templates",
        icon: FileText,
        keywords: ["job templates", "reusable", "configurations", "checklist"],
      },
      {
        key: "automation-quote-templates",
        title: "Quote Templates",
        description: "Pre-built quote templates",
        href: "/settings/quote-templates",
        icon: FileCheck,
        keywords: ["quote templates", "proposals", "pricing", "packages"],
      },
      {
        key: "automation-client-communication",
        title: "Client Communication",
        description: "Invoice, quote, and job email templates",
        href: "/settings/communication",
        icon: ClipboardList,
        keywords: ["email templates", "communication", "outbound", "client emails"],
      },
      {
        key: "automation-invoice-reminders",
        title: "Invoice Reminders",
        description: "Automatic overdue invoice reminders",
        href: "/settings/invoice-reminders",
        icon: Bell,
        keywords: ["reminders", "notifications", "overdue", "invoice", "alerts"],
      },
      {
        key: "automation-invoice-display",
        title: "Invoice Display",
        description: "What appears on client-facing invoices",
        href: "/settings/invoice-display",
        icon: FileText,
        keywords: ["invoice display", "PDF", "client message", "visibility"],
      },
    ],
  },
  {
    key: "system",
    title: "System",
    description: "Custom fields and data import",
    icon: Settings,
    children: [
      {
        key: "system-custom-fields",
        title: "Custom Fields",
        description: "Define custom data fields",
        href: "/settings/custom-fields",
        icon: FormInput,
        keywords: ["custom fields", "data", "extra fields", "properties"],
      },
      {
        key: "system-import",
        title: "Import Center",
        description: "Bulk import clients, jobs, or products",
        href: "/settings/import",
        icon: Upload,
        keywords: ["import", "CSV", "bulk", "migrate", "upload", "data"],
      },
    ],
  },
  {
    key: "advanced",
    title: "Advanced",
    description: "Third-party integrations",
    icon: Wrench,
    children: [
      {
        key: "advanced-integrations",
        title: "Integrations",
        description: "Connect third-party services",
        href: "/settings/integrations",
        icon: Settings2,
        keywords: ["integrations", "connect", "third-party", "apps", "services"],
      },
      {
        key: "advanced-qbo",
        title: "QuickBooks Online",
        description: "Sync clients, invoices, and payments",
        href: "/settings/integrations/qbo",
        icon: Settings2,
        keywords: ["quickbooks", "QBO", "accounting", "sync"],
      },
    ],
  },
];
