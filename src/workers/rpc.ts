type AnyFn = (...args: any[]) => any;
export type Remote<T> = {
  [K in keyof T]: T[K] extends AnyFn
    ? (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>>
    : never;
};

interface Request {
  id: number;
  method: string;
  args: unknown[];
}
type Response = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

const transfers = new WeakMap<object, Transferable[]>();

export function transfer<T>(value: T, list: Transferable[]): T {
  if (value && typeof value === 'object') transfers.set(value as object, list);
  return value;
}

function transferListOf(values: unknown[]): Transferable[] {
  const out: Transferable[] = [];
  for (const v of values) if (v && typeof v === 'object') out.push(...(transfers.get(v as object) ?? []));
  return out;
}

interface Endpoint {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
}

export function expose(api: Record<string, AnyFn>, endpoint: Endpoint = self as unknown as Endpoint): void {
  endpoint.addEventListener('message', async (ev: MessageEvent<Request>) => {
    const { id, method, args } = ev.data;
    try {
      const fn = api[method];
      if (!fn) throw new Error(`Unknown method ${method}`);
      const value = await fn(...args);
      endpoint.postMessage({ id, ok: true, value } satisfies Response, transferListOf([value]));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      endpoint.postMessage({ id, ok: false, error } satisfies Response, []);
    }
  });
}

export function wrap<T>(worker: Worker): Remote<T> {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.addEventListener('message', (ev: MessageEvent<Response>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data.value);
    else p.reject(new Error(ev.data.error));
  });
  worker.addEventListener('error', (ev) => {
    for (const p of pending.values()) p.reject(new Error(ev.message || 'Worker error'));
    pending.clear();
  });
  return new Proxy({} as Remote<T>, {
    get(_, method: string) {
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, method, args } satisfies Request, transferListOf(args));
        });
    },
  });
}
