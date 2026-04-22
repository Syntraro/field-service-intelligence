/**
 * Admin Tenants — Platform Tenant Account Dashboard
 *
 * Owner-only page displaying tenant account/admin metrics.
 * Shows ONLY account-level data: identity, subscription, users, QBO integration.
 * NO operational metrics (jobs, scheduling, visits, tasks).
 *
 * Architecture rule (2026-03-08): Tenant admin must not depend on operational schema.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Users,
  Cloud,
  CloudOff,
  AlertTriangle,
  Search,
  ArrowUpDown,
  ChevronRight,
  Shield,
} from "lucide-react";

// ============================================================================
// Types — Account/admin only. No operational metrics.
// ============================================================================

interface TenantAccount {
  company: {
    id: string;
    name: string;
    createdAt: string;
    subscriptionStatus: string;
    qboEnabled: boolean;
    qboEnvironment: string;
  };
  owner: {
    id: string;
    email: string;
    fullName: string | null;
  } | null;
  users: {
    total: number;
    lastLoginAt: string | null;
  };
  qbo: {
    connected: boolean;
    lastSyncAt: string | null;
    failedSyncCount: number;
    queueSize: number;
  };
}

type SortField = "name" | "users" | "subscription" | "qbo";
type SortDirection = "asc" | "desc";

// ============================================================================
// Helper Components
// ============================================================================

function QboStatus({ connected, queueSize, failedCount }: { connected: boolean; queueSize: number; failedCount: number }) {
  if (!connected) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <CloudOff className="h-4 w-4" />
        <span className="text-xs">Not connected</span>
      </div>
    );
  }

  const hasIssues = queueSize > 0 || failedCount > 0;
  return (
    <div className="flex items-center gap-2">
      <Cloud className={`h-4 w-4 ${hasIssues ? "text-amber-500" : "text-green-500"}`} />
      {queueSize > 0 && (
        <Badge variant="secondary" className="text-xs">
          {queueSize} queued
        </Badge>
      )}
      {failedCount > 0 && (
        <Badge variant="destructive" className="text-xs">
          {failedCount} failed
        </Badge>
      )}
      {!hasIssues && <span className="text-xs text-green-600">OK</span>}
    </div>
  );
}

function SubscriptionBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    trial: "secondary",
    cancelled: "destructive",
  };
  return (
    <Badge variant={variants[status] || "outline"}>
      {status}
    </Badge>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AdminTenants() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const { data, isLoading, error } = useQuery<{ tenants: TenantAccount[] }>({
    queryKey: ["/api/admin/tenants"],
  });

  const tenants = data?.tenants || [];

  // Filter and sort
  const filteredTenants = useMemo(() => {
    let result = [...tenants];

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.company.name.toLowerCase().includes(searchLower) ||
          t.company.id.toLowerCase().includes(searchLower)
      );
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = a.company.name.localeCompare(b.company.name);
          break;
        case "users":
          comparison = a.users.total - b.users.total;
          break;
        case "subscription":
          comparison = a.company.subscriptionStatus.localeCompare(b.company.subscriptionStatus);
          break;
        case "qbo":
          comparison = (a.qbo.connected ? 1 : 0) - (b.qbo.connected ? 1 : 0);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [tenants, search, sortField, sortDirection]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Summary stats — account-level only
  const stats = useMemo(() => {
    return {
      totalTenants: tenants.length,
      totalUsers: tenants.reduce((sum, t) => sum + t.users.total, 0),
      qboConnected: tenants.filter((t) => t.qbo.connected).length,
      qboWithIssues: tenants.filter(
        (t) => t.qbo.failedSyncCount > 0 || t.qbo.queueSize > 5
      ).length,
    };
  }, [tenants]);

  // Access check
  if (!user || user.role !== "owner") {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This area is restricted to platform owners only.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4" />
          <div className="h-32 bg-muted rounded" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {(error as Error).message || "Failed to load tenant data"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8" />
            Tenant Administration
          </h1>
          <p className="text-muted-foreground mt-1">
            Account management for all tenants
          </p>
        </div>
      </div>

      {/* Summary Cards — account metrics only */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Tenants</p>
                <p className="text-2xl font-bold">{stats.totalTenants}</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-2xl font-bold">{stats.totalUsers}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">QBO Connected</p>
                <p className="text-2xl font-bold">{stats.qboConnected}</p>
              </div>
              <Cloud className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className={stats.qboWithIssues > 0 ? "border-amber-500" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">QBO Issues</p>
                <p className={`text-2xl font-bold ${stats.qboWithIssues > 0 ? "text-amber-600" : ""}`}>
                  {stats.qboWithIssues}
                </p>
              </div>
              <AlertTriangle className={`h-8 w-8 ${stats.qboWithIssues > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tenant List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Tenants</CardTitle>
              <CardDescription>
                Click on a tenant to view details and manage features
              </CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tenants..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => toggleSort("name")}
                  >
                    Company
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => toggleSort("subscription")}
                  >
                    Status
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => toggleSort("users")}
                  >
                    Users
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => toggleSort("qbo")}
                  >
                    QBO
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTenants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {search ? "No tenants match your search" : "No tenants found"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredTenants.map((tenant) => (
                  <TableRow
                    key={tenant.company.id}
                    className="cursor-pointer"
                    onClick={() => setLocation(`/platform/tenants/${tenant.company.id}`)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{tenant.company.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Created {new Date(tenant.company.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <SubscriptionBadge status={tenant.company.subscriptionStatus} />
                    </TableCell>
                    <TableCell>
                      {tenant.owner ? (
                        <div>
                          <p className="text-sm">{tenant.owner.email}</p>
                          {tenant.owner.fullName && (
                            <p className="text-xs text-muted-foreground">{tenant.owner.fullName}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No owner</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{tenant.users.total} users</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-muted-foreground">
                        {tenant.users.lastLoginAt
                          ? new Date(tenant.users.lastLoginAt).toLocaleDateString()
                          : "Never"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <QboStatus
                        connected={tenant.qbo.connected}
                        queueSize={tenant.qbo.queueSize}
                        failedCount={tenant.qbo.failedSyncCount}
                      />
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
