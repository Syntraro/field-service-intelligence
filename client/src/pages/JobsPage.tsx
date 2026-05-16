import { useState } from "react";
import { Search } from "lucide-react";
import { CreateJobModal } from "@/components/CreateJobModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobsWorkspaceTab } from "./jobs/JobsWorkspaceTab";

export default function JobsPage() {
  const [createOpen, setCreateOpen] = useState(false);

  // Search state — rendered in page header, threaded into workspace.
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="h-full bg-app-bg flex flex-col overflow-hidden" data-testid="jobs-page">
      <PageHeader title="Jobs">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
          <Input
            placeholder="Search jobs, clients, addresses…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 w-64 h-8 rounded-lg border-slate-200 bg-white text-sm"
            data-testid="input-search-jobs-toolbar"
          />
        </div>

        {/* New Job */}
        <Button
          size="sm"
          className="rounded-lg px-3.5"
          onClick={() => setCreateOpen(true)}
          data-testid="button-new-job"
        >
          New Job
        </Button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-hidden">
        <JobsWorkspaceTab
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      <CreateJobModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
