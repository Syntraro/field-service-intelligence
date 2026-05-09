# Adding a New Page

## Steps

1. Create a page component in `client/src/pages/PageName.tsx`.
2. Add the route in `client/src/App.tsx` inside the `<Switch>` router.
3. Wrap with `<ProtectedRoute>` if authentication is required. Add `requireAdmin` prop for admin-only pages.
4. Add a navigation link in `client/src/components/AppSidebar.tsx`.

## Route Registration

```tsx
// client/src/App.tsx
import { Route, Switch } from "wouter";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import MyNewPage from "@/pages/MyNewPage";

// Inside <Switch>:
<ProtectedRoute path="/my-new-page" component={MyNewPage} />
```

## Page Structure Pattern

```tsx
// client/src/pages/MyNewPage.tsx
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";

export default function MyNewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/my-resource"],
    queryFn: async () => {
      const res = await fetch("/api/my-resource");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  return (
    <div>
      <PageHeader title="My New Page" />
      {/* page content */}
    </div>
  );
}
```

## Protected Route Options

```tsx
<ProtectedRoute path="/admin-only" component={AdminPage} requireAdmin />
```
