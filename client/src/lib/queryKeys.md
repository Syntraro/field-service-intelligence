# Query Key Convention

This codebase uses two valid `queryKey` patterns side-by-side. Both are
working today; the rule is **consistency per logical entity**, not
universal alignment to one form.

This file exists so the next person adding a query doesn't accidentally
straddle both conventions for the same entity (which would silently break
SSE invalidation and family-key cache busts).

## The two patterns

### Pattern A — URL-as-key (prefix-matchable)

The first element of `queryKey` is the literal API URL. Any extra elements
are query parameters that affect the result set.

```ts
// useTodayVisits
queryKey: ["/api/tech/visits/today", dateStr ?? "today", scopeKey(scope)]

// useLocationSearch
queryKey: ["/api/clients/search-locations", searchText]

// useCalendarRange
queryKey: ["/api/calendar/range", startISO, endISO]
```

**Why this matters.** The default queryFn at
`client/src/lib/queryClient.ts:360-388` reads `queryKey[0]` as the URL and
calls fetch with credentials, returning a parsed JSON body or throwing
`ApiError`. Queries that follow Pattern A can omit a custom `queryFn`
entirely.

**SSE invalidation.** The tech-app SSE consumer at
`client/src/tech-app/hooks/useTechRealtimeSync.ts:31-41` invalidates by
URL prefix (`["/api/tech/visits/today"]`, `["/api/tech/visits"]`, etc.).
Pattern A queries are caught by these prefix invalidations automatically.

**When to choose Pattern A:**
- The query maps 1:1 to a single REST endpoint with no client-side
  derivation.
- The data is or might become SSE-driven.
- You want the default queryFn — fewer lines, consistent error shape.

### Pattern B — Semantic-key

The first element of `queryKey` is a descriptive name; subsequent
elements are filters or parameters.

```ts
// useJobsFeed
queryKey: ["jobs", "feed", status, techId, search, locationId]

// useJobHeader
queryKey: ["jobs", "detail", jobId]

// useJobVisits
queryKey: ["visits", jobId, "all"]
```

**Why this matters.** Family-wide invalidation by `["jobs"]` clears every
key whose first element is `"jobs"`. This is the right shape when
multiple endpoints feed the same logical entity (list endpoint + detail
endpoint + filters), or when the cache is derived/composed.

**SSE invalidation.** Pattern B does NOT match URL-prefix invalidation.
The `useTechRealtimeSync` consumer would have to explicitly add the
semantic family key to its invalidation set. If you add an SSE-driven
entity using Pattern B, audit `useTechRealtimeSync.ts` and
`useDispatchStream.ts` to make sure the new family is covered.

**When to choose Pattern B:**
- Multiple endpoints feed the same logical entity (list, detail, derived).
- You want family-wide invalidation under a single name.
- You need to compose data on the client and hide the URL.

## The rule

Pick one pattern per logical entity. Don't mix them.

- Locations → Pattern A (`["/api/clients/search-locations", ...]`,
  `["/api/clients/resolve", id]`).
- Jobs → Pattern B (`["jobs", "feed", ...]`, `["jobs", "detail", id]`,
  `["visits", jobId, "all"]`).
- Tech-app visits/time → Pattern A (`["/api/tech/visits/today", ...]`,
  `["/api/tech/time/summary"]`).
- Calendar → Pattern A (`["/api/calendar/range", startISO, endISO]`).
- Items / Products → Pattern A (`["/api/items", { limit: 1000 }]`,
  `["/api/items", "search", q]`).
- Notifications → Pattern A (`["/api/notifications"]`).

If you're adding a new query for an entity that already has queries on
the surface, match the pattern they use. If the pattern is mixed today
(rare; the codebase is largely consistent), pick the dominant pattern
for that entity and don't add to the minority.

## The two anti-patterns

1. **Two different keys for the same data.** If the company-contacts
   list is read as `["/api/customer-companies", id, "contacts"]` in one
   file and as `["customer-contacts", id]` in another, every mutation
   that invalidates one key leaves the other stale. The cure is grep
   before adding: search for the URL or any keyword that would identify
   the data, and reuse the existing key.

2. **`invalidateQueries({})` (no args).** This invalidates the entire
   query cache. Almost always wrong. There is currently zero use of
   this pattern in the codebase; keep it that way.

## SSE alignment checklist

Before introducing an SSE-driven entity:

1. Pick Pattern A unless you have a strong reason not to.
2. Identify every queryKey for the entity (list, detail, filtered
   variants).
3. In `useTechRealtimeSync.ts` (tech-app) or `useDispatchStream.ts`
   (office), add the URL prefix(es) to the invalidation set for the
   relevant scope.
4. Verify with grep that the queryKey doesn't appear in a different
   shape elsewhere on the surface.
