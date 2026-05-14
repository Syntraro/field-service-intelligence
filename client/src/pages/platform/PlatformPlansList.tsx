/**
 * Platform Plans list — /platform/plans (2026-04-19).
 *
 * Shows all subscription plans with feature counts and tenant assignment
 * counts. No hard delete — deactivation only via the detail page.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PlanRow {
  id: string;
  name: string;
  displayName: string;
  monthlyPriceCents: number | null;
  locationLimit: number;
  active: boolean;
  isTrial: boolean;
  trialDays: number | null;
  sortOrder: number;
  featureCount: number;
  enabledFeatureCount: number;
  tenantCount: number;
  metadata: { isPublic: boolean; annualPriceCents: number | null; trialEligible: boolean } | null;
}

function fmtMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PlatformPlansList() {
  const { data, isLoading } = useQuery<PlanRow[]>({
    queryKey: ["/api/platform/plans"],
    queryFn: () => apiRequest("/api/platform/plans"),
  });

  return (
    <PlatformLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-title font-semibold">Plans</h2>
          <p className="text-sm text-muted-foreground">Subscription plans and their feature configuration.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Plans</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Display</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="text-right">Annual</TableHead>
                <TableHead className="text-right">Location cap</TableHead>
                <TableHead className="text-right">Features</TableHead>
                <TableHead className="text-right">Tenants</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!isLoading && (data ?? []).map((p) => (
                <TableRow key={p.id} data-testid={`plan-row-${p.name}`}>
                  <TableCell className="font-mono text-xs">{p.name}</TableCell>
                  <TableCell>{p.displayName}</TableCell>
                  <TableCell className="text-right">{fmtMoney(p.monthlyPriceCents)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(p.metadata?.annualPriceCents ?? null)}</TableCell>
                  <TableCell className="text-right">{p.locationLimit}</TableCell>
                  <TableCell className="text-right">
                    {p.enabledFeatureCount}/{p.featureCount}
                  </TableCell>
                  <TableCell className="text-right">{p.tenantCount}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Badge variant={p.active ? "secondary" : "outline"}>{p.active ? "Active" : "Inactive"}</Badge>
                      {p.isTrial && <Badge variant="outline">Trial</Badge>}
                      {p.metadata?.isPublic && <Badge variant="outline">Public</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/platform/plans/${p.id}`}>
                      <Button size="sm" variant="outline">Manage</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PlatformLayout>
  );
}
