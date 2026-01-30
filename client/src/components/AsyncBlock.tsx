import { useState, type ReactNode } from "react";
import { AlertCircle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/queryClient";

interface AsyncBlockProps {
  /** Title shown in error messages (e.g., "invoices", "jobs") */
  title?: string;
  /** Whether data is loading */
  isLoading: boolean;
  /** Whether an error occurred */
  isError: boolean;
  /** The error object (ApiError or Error) */
  error?: unknown;
  /** Callback to retry the failed request */
  onRetry?: () => void;
  /** Whether the data is empty (after successful load) */
  isEmpty?: boolean;
  /** Message shown when data is empty */
  emptyMessage?: string;
  /** Number of skeleton rows to show when loading (default: 3) */
  skeletonRows?: number;
  /** Content to render when data loads successfully */
  children: ReactNode;
}

/**
 * AsyncBlock - Consistent wrapper for async data states.
 *
 * Handles loading, error, and empty states uniformly across the app.
 * In development, shows additional error details (status, URL).
 */
export function AsyncBlock({
  title,
  isLoading,
  isError,
  error,
  onRetry,
  isEmpty,
  emptyMessage = "No data found",
  skeletonRows = 3,
  children,
}: AsyncBlockProps) {
  const [showDetails, setShowDetails] = useState(false);
  const isDev = import.meta.env.DEV;

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  // Error state
  if (isError) {
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    const apiError = isApiError(error) ? error : null;

    return (
      <Alert variant="destructive" className="my-2">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to load{title ? ` ${title}` : ""}</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="text-sm">{errorMessage}</p>

          {/* Dev-only details toggle */}
          {isDev && apiError && (
            <div className="mt-2">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Details
              </button>
              {showDetails && (
                <div className="mt-1 text-xs font-mono bg-destructive/10 rounded p-2">
                  <div>Status: {apiError.status}</div>
                  <div className="truncate">URL: {apiError.url}</div>
                </div>
              )}
            </div>
          )}

          {/* Retry button */}
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="mt-3"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Empty state
  if (isEmpty) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  // Success state - render children
  return <>{children}</>;
}
