import { Link } from "wouter";
import { ArrowLeft, ChevronRight, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function IntegrationsPage() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-integrations-title">Integrations</h1>
          <p className="text-sm text-muted-foreground">Connect with third-party services.</p>
        </div>
      </div>

      {/* QuickBooks Online */}
      <Link href="/settings/integrations/qbo">
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
                  <Cloud className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <CardTitle className="text-lg">QuickBooks Online</CardTitle>
                  <CardDescription>
                    Connect QuickBooks and import customers.
                  </CardDescription>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
        </Card>
      </Link>

      {/* More integrations placeholder */}
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-muted">
              <Cloud className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-lg text-muted-foreground">More Integrations</CardTitle>
              <CardDescription>
                Payment processors and additional services coming soon
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
