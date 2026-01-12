import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, GripVertical, Lock, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface JobStatusConfig {
  key: string;
  label: string;
  phase: "open" | "in_progress" | "closed";
  color: string;
  isSystem: boolean;
  description: string;
}

const DEFAULT_STATUSES: JobStatusConfig[] = [
  { key: "draft", label: "Draft", phase: "open", color: "bg-slate-500", isSystem: true, description: "Job created but not yet scheduled" },
  { key: "scheduled", label: "Scheduled", phase: "open", color: "bg-blue-500", isSystem: true, description: "Job is scheduled for a future date" },
  { key: "dispatched", label: "Dispatched", phase: "in_progress", color: "bg-indigo-500", isSystem: false, description: "Job assigned to technician" },
  { key: "en_route", label: "En Route", phase: "in_progress", color: "bg-purple-500", isSystem: false, description: "Technician is traveling to the job site" },
  { key: "on_site", label: "On Site", phase: "in_progress", color: "bg-teal-500", isSystem: false, description: "Technician has arrived at the job site" },
  { key: "in_progress", label: "In Progress", phase: "in_progress", color: "bg-amber-500", isSystem: true, description: "Work is actively being performed" },
  { key: "needs_parts", label: "Needs Parts", phase: "in_progress", color: "bg-orange-500", isSystem: false, description: "Waiting for parts to arrive" },
  { key: "on_hold", label: "On Hold", phase: "in_progress", color: "bg-gray-500", isSystem: false, description: "Job paused, awaiting action" },
  { key: "completed", label: "Completed (Legacy)", phase: "closed", color: "bg-green-400", isSystem: true, description: "LEGACY: Work finished, use 'Requires Invoicing' for new jobs" },
  { key: "requires_invoicing", label: "Requires Invoicing", phase: "closed", color: "bg-green-500", isSystem: true, description: "Work finished, needs invoice created" },
  { key: "invoiced", label: "Invoiced", phase: "closed", color: "bg-emerald-600", isSystem: true, description: "Invoice has been created" },
  { key: "closed", label: "Closed", phase: "closed", color: "bg-slate-600", isSystem: false, description: "Job closed without invoice" },
  { key: "archived", label: "Archived", phase: "closed", color: "bg-slate-400", isSystem: false, description: "Job archived for historical record" },
  { key: "cancelled", label: "Cancelled", phase: "closed", color: "bg-red-500", isSystem: true, description: "Job was cancelled" },
];

function StatusRow({ status, onLabelChange }: { 
  status: JobStatusConfig; 
  onLabelChange: (key: string, newLabel: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(status.label);

  const handleSave = () => {
    onLabelChange(status.key, editLabel);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditLabel(status.label);
    setIsEditing(false);
  };

  return (
    <div 
      className="flex items-center gap-3 p-3 rounded-lg border bg-card"
      data-testid={`row-status-${status.key}`}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
      
      <div className={`w-3 h-3 rounded-full ${status.color}`} />
      
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              className="h-8 w-40"
              data-testid={`input-status-label-${status.key}`}
            />
            <Button size="icon" variant="ghost" onClick={handleSave} className="h-8 w-8">
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={handleCancel} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{status.label}</span>
            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{status.key}</code>
            {status.isSystem && (
              <Badge variant="outline" className="text-[10px] h-5">
                <Lock className="h-2.5 w-2.5 mr-1" />
                System
              </Badge>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{status.description}</p>
      </div>
      
      <Badge 
        variant="secondary" 
        className={`text-[10px] ${
          status.phase === "open" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
          status.phase === "in_progress" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
          "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
        }`}
      >
        {status.phase === "open" ? "Open" : status.phase === "in_progress" ? "In Progress" : "Closed"}
      </Badge>
      
      {!status.isSystem && !isEditing && (
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8"
          onClick={() => setIsEditing(true)}
          data-testid={`button-edit-status-${status.key}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export default function JobStatusesPage() {
  const { toast } = useToast();
  const [statuses, setStatuses] = useState<JobStatusConfig[]>(DEFAULT_STATUSES);

  const handleLabelChange = (key: string, newLabel: string) => {
    setStatuses(prev => prev.map(s => 
      s.key === key ? { ...s, label: newLabel } : s
    ));
    toast({
      title: "Status Updated",
      description: `Status label changed to "${newLabel}"`,
    });
  };

  const openStatuses = statuses.filter(s => s.phase === "open");
  const inProgressStatuses = statuses.filter(s => s.phase === "in_progress");
  const closedStatuses = statuses.filter(s => s.phase === "closed");

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Job Statuses</h1>
          <p className="text-sm text-muted-foreground">
            Configure job workflow statuses used by technicians in the field
          </p>
        </div>
      </div>

      {/* Info Card */}
      <Card className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
        <CardContent className="p-4">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            Job statuses help track work progress. Technicians can update status from their mobile device as they travel to sites and complete work.
            <strong className="block mt-1">System statuses</strong> are required for core functionality and cannot be deleted.
          </p>
        </CardContent>
      </Card>

      {/* Open Statuses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            Open
          </CardTitle>
          <CardDescription>Jobs that are scheduled but work hasn't started</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {openStatuses.map(status => (
            <StatusRow 
              key={status.key} 
              status={status} 
              onLabelChange={handleLabelChange}
            />
          ))}
        </CardContent>
      </Card>

      {/* In Progress Statuses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            In Progress
          </CardTitle>
          <CardDescription>Jobs where work is actively being performed or paused</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {inProgressStatuses.map(status => (
            <StatusRow 
              key={status.key} 
              status={status} 
              onLabelChange={handleLabelChange}
            />
          ))}
        </CardContent>
      </Card>

      {/* Closed Statuses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            Closed
          </CardTitle>
          <CardDescription>Jobs that are finished, invoiced, or cancelled</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {closedStatuses.map(status => (
            <StatusRow 
              key={status.key} 
              status={status} 
              onLabelChange={handleLabelChange}
            />
          ))}
        </CardContent>
      </Card>

      {/* Usage Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How Statuses Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <Badge className="bg-purple-500 text-white text-[10px]">En Route</Badge>
            <p className="text-muted-foreground">Technician taps when leaving for job site</p>
          </div>
          <div className="flex items-start gap-3">
            <Badge className="bg-teal-500 text-white text-[10px]">On Site</Badge>
            <p className="text-muted-foreground">Technician taps when arriving at location</p>
          </div>
          <div className="flex items-start gap-3">
            <Badge className="bg-orange-500 text-white text-[10px]">Needs Parts</Badge>
            <p className="text-muted-foreground">Work paused while waiting for parts delivery</p>
          </div>
          <div className="flex items-start gap-3">
            <Badge className="bg-green-500 text-white text-[10px]">Completed</Badge>
            <p className="text-muted-foreground">Work finished, ready for review and invoicing</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
