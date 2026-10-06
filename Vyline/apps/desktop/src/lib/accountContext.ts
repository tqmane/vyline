type AccountState = { accountId: string | null; demoMode: boolean; self?: { mid?: string | undefined } };
type AccountStore = {
  getState: () => AccountState;
  subscribe: (listener: (state: AccountState) => void) => () => void;
};

/** An accepted operation may outlive its pane, but never its account session. */
export function captureAccountContext(store: AccountStore) {
  const initial = store.getState();
  let current = true;
  let mid = initial.self?.mid || undefined;
  const matches = (state: AccountState) => {
    if (state.accountId !== initial.accountId || state.demoMode !== initial.demoMode) return false;
    if (mid && state.self?.mid !== mid) return false;
    mid ??= state.self?.mid || undefined;
    return true;
  };
  const unsubscribe = store.subscribe(state => { if (!matches(state)) current = false; });
  return {
    isCurrent: () => current && matches(store.getState()),
    dispose: () => { current = false; unsubscribe(); },
  };
}
