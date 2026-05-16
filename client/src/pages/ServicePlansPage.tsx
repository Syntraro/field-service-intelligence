import { useState } from "react";
import { Plus, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/PageHeader";
import CreateMaintenancePlanDialog from "@/components/pm/CreateMaintenancePlanDialog";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { ServicePlansWorkspaceTab } from "./service-plans/ServicePlansWorkspaceTab";

export default function ServicePlansPage() {
  const [createPmDialogOpen, setCreatePmDialogOpen] = useState(false);
  const [quickAddJobOpen, setQuickAddJobOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="h-full bg-app-bg flex flex-col overflow-hidden" data-testid="service-plans-page">
      <PageHeader title="Service Plans">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
          <Input
            placeholder="Search plans, clients, addresses…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 w-56 h-8 rounded-lg border-slate-200 bg-white text-sm"
            data-testid="input-search-service-plans"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="rounded-lg px-3.5 gap-1.5">
              <Plus className="h-4 w-4" />
              New Plan
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setCreatePmDialogOpen(true)}>
              Service Plan
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setQuickAddJobOpen(true)}>
              Recurring Job
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      {/* Service Plans workspace — fills remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ServicePlansWorkspaceTab searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      </div>

      <CreateMaintenancePlanDialog
        open={createPmDialogOpen}
        onOpenChange={setCreatePmDialogOpen}
      />
      <QuickAddJobDialog
        open={quickAddJobOpen}
        onOpenChange={setQuickAddJobOpen}
      />
    </div>
  );
}
