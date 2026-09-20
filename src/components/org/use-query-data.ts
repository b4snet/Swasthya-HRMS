"use client";

import * as React from "react";

interface QueryEnvelope<R> {
  ok: boolean;
  data?: R[] | undefined;
  error?: { code: string; message: string };
}

type QueryAction<R> = (organizationId: string) => Promise<QueryEnvelope<R>>;

/**
 * Load scoped reference rows once per organization (options for selects,
 * placement pickers). Returns undefined while loading; returns [] on error
 * or denial — reference data never blocks the main entity page, and failed
 * option loads degrade to "no options" rather than a broken form. The main
 * list independently surfaces denial via EntityPage.
 */
export function useQueryData<R>(
  action: QueryAction<R>,
  organizationId?: string,
  statuses?: string[],
): R[] | undefined {
  const [data, setData] = React.useState<R[] | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    action(organizationId ?? "__tenant__")
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          let rows = res.data ?? [];
          if (statuses) {
            rows = rows.filter((r) =>
              statuses.includes(String((r as unknown as Record<string, unknown>)["status"] ?? "")),
            );
          }
          setData(rows);
        } else {
          setData([]);
        }
      })
      .catch(() => {
        if (!cancelled) setData([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, actionKey(action), statusesKey(statuses)]);

  return data;
}

// Stable identity per action function (avoids effect loops when callers
// pass module-level server action references).
const keys = new WeakMap<object, number>();
let counter = 0;
function actionKey(action: object): number {
  let k = keys.get(action);
  if (k === undefined) {
    k = ++counter;
    keys.set(action, k);
  }
  return k;
}

function statusesKey(statuses?: string[]): string {
  return statuses ? statuses.join(",") : "";
}
