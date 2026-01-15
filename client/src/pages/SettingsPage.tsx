import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, ChevronRight, Users, FormInput, Receipt, Plug, FileText, ListChecks, FileCheck } from "lucide-react";

interface SettingsCardProps {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  detail: string;
  testId: string;
}

function SettingsCard({ href, icon: Icon, title, description, detail, testId }: SettingsCardProps) {
  return (
    <Link href={href}>
      <Card className="hover-elevate cursor-pointer transition-all h-full" data-testid={testId}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription className="text-sm">{description}</CardDescription>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function SettingsPage() {
  const settingsItems: SettingsCardProps[] = [
    {
      href: "/settings/products",
      icon: Package,
      title: "Products & Services",
      description: "Manage your product catalog",
      detail: "Add, edit, and organize products and services for invoicing and job management.",
      testId: "card-products-settings",
    },
    {
      href: "/manage-team",
      icon: Users,
      title: "Team Management",
      description: "Manage technicians and staff",
      detail: "Add team members, assign roles, set permissions, and manage technician schedules.",
      testId: "card-team-settings",
    },
    {
      href: "/settings/custom-fields",
      icon: FormInput,
      title: "Custom Fields",
      description: "Define custom data fields",
      detail: "Create custom fields for clients, jobs, and invoices to capture additional information.",
      testId: "card-custom-fields-settings",
    },
    {
      href: "/settings/tax-billing",
      icon: Receipt,
      title: "Tax & Billing Rules",
      description: "Configure tax and billing",
      detail: "Set up tax codes, rates, and billing rules for automated invoice calculations.",
      testId: "card-tax-billing-settings",
    },
    {
      href: "/settings/integrations",
      icon: Plug,
      title: "Integrations",
      description: "Connect third-party services",
      detail: "Connect with QuickBooks, payment processors, and other business tools.",
      testId: "card-integrations-settings",
    },
    {
      href: "/settings/job-templates",
      icon: FileText,
      title: "Job Templates",
      description: "Manage reusable templates",
      detail: "Create and manage templates with predefined line items for service calls, PMs, and more.",
      testId: "card-job-templates-settings",
    },
    {
      href: "/settings/quote-templates",
      icon: FileCheck,
      title: "Quote Templates",
      description: "Manage quote templates",
      detail: "Create and manage templates with predefined line items for quotes.",
      testId: "card-quote-templates-settings",
    },
    {
      href: "/settings/job-statuses",
      icon: ListChecks,
      title: "Job Statuses",
      description: "Customize workflow statuses",
      detail: "Configure job statuses like En Route, On Site, Needs Parts for technician tracking.",
      testId: "card-job-statuses-settings",
    },
  ];

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-settings-title">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your application settings and preferences.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {settingsItems.map((item) => (
          <SettingsCard key={item.href} {...item} />
        ))}
      </div>
    </div>
  );
}
