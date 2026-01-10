import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, CheckCircle, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

export interface MaintenanceItem {
  id: string;
  companyName: string;
  location?: string | null;
  selectedMonths: number[];
  nextDue: Date;
  status: "overdue" | "upcoming" | "completed";
  assignmentId?: string;
  originalMonth?: number;
  originalYear?: number;
}

interface MaintenanceCardProps {
  item: MaintenanceItem;
  onMarkComplete: (id: string) => void;
  onEdit: (id: string) => void;
  onViewReport?: (clientId: string) => void;
  parts?: ClientPart[];
  isCompleted?: boolean;
  isScheduled?: boolean;
  isThisMonthPM?: boolean;
}

interface ClientPart {
  id: string;
  partId: string;
  quantity: number;
  part: {
    id: string;
    name: string;
    type: string;
    size: string;
    filterType?: string;
    beltType?: string;
  };
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const getPartDisplayName = (part: ClientPart['part']): string => {
  if (part.type === 'filter' && part.filterType) {
    return `${part.filterType} Filter`;
  } else if (part.type === 'belt') {
    return 'Belt';
  } else if (part.name) {
    return part.name;
  }
  return 'Part';
};

export default function MaintenanceCard({ item, onMarkComplete, onEdit, onViewReport, parts = [], isCompleted = false, isScheduled = false, isThisMonthPM = false }: MaintenanceCardProps) {
  const [, setLocation] = useLocation();
  const isOverdue = item.status === "overdue";
  const monthsDisplay = item.selectedMonths.map(m => MONTH_NAMES[m]).join(", ");

  const handleCardClick = () => {
    const clientId = item.id.includes('|') ? item.id.split('|')[0] : item.id;
    if (onViewReport) {
      onViewReport(clientId);
    } else {
      // Fallback to navigation if callback not provided
      setLocation(`/client-report/${clientId}`);
    }
  };

  const getStatusStyles = () => {
    // White background with subtle border for all cards
    return 'border-border';
  };

  const getIconColor = () => {
    // Keep icon colors for status indication
    if (isCompleted) return 'text-primary';
    if (isOverdue) return 'text-status-overdue';
    
    if (isThisMonthPM && !isScheduled) return 'text-status-unscheduled';
    
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    if (item.nextDue <= weekFromNow && !isOverdue) return 'text-status-upcoming';
    
    if (isScheduled) return 'text-status-this-month';
    
    return 'text-muted-foreground';
  };

  const getBorderColor = () => {
    // Match the status colors from the top stats cards
    if (isCompleted) return 'border-l-primary';
    if (isOverdue) return 'border-l-status-overdue';
    
    if (isThisMonthPM && !isScheduled) return 'border-l-status-unscheduled';
    
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    if (item.nextDue <= weekFromNow && !isOverdue) return 'border-l-status-upcoming';
    
    if (isScheduled) return 'border-l-status-this-month';
    
    return 'border-l-border';
  };

  return (
    <Card 
      className={`bg-card hover-elevate cursor-pointer shadow-sm rounded-xl border border-l-4 ${getStatusStyles()} ${getBorderColor()}`}
      data-testid={`card-maintenance-${item.id}`}
      onClick={handleCardClick}
    >
      <CardContent className="p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm leading-tight" data-testid={`text-company-${item.id}`}>
              {item.companyName}
            </h3>
            {item.location && (
              <span className="text-xs text-muted-foreground mt-0.5 block" data-testid={`text-location-${item.id}`}>{item.location}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{monthsDisplay}</span>
            <Button
              size="sm"
              variant={isCompleted ? "default" : "outline"}
              onClick={(e) => {
                e.stopPropagation();
                onMarkComplete(item.id);
              }}
              data-testid={`button-complete-${item.id}`}
              aria-label={isCompleted ? "Reopen maintenance" : "Mark maintenance complete"}
              className={`h-7 text-xs whitespace-nowrap gap-1 ${isCompleted ? '' : isOverdue ? 'border-status-overdue text-status-overdue hover:bg-status-overdue/10' : ''}`}
            >
              {isCompleted ? (
                <>
                  <CheckCircle className="h-3 w-3" />
                  Completed
                </>
              ) : isOverdue ? (
                <>
                  <AlertTriangle className="h-3 w-3" />
                  Complete
                </>
              ) : (
                <>
                  <CheckCircle className="h-3 w-3" />
                  Complete
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
