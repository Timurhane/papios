import { useEffect, useRef, useState } from 'react';

/**
 * Minimal async loader: { data, error, loading, reload }. `key` identifies the inputs; the loader is
 * re-run when it changes.
 */
export function useAsync<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let active = true;
    loadRef.current().then(
      (data) => active && setState({ data, error: null, loading: false }),
      (err: unknown) =>
        active &&
        setState({
          data: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        }),
    );
    return () => {
      active = false;
    };
  }, [key, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
