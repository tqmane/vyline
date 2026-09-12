type AccountState = { accountId: string | null; demoMode: boolean };
type AccountStore = {
  getState: () => AccountState;
  subscribe: (listener: (state: AccountState) => void) => () => void;
};

/** An accepted operation may outlive its pane, but never its account session. */
export function captureAccountContext(store: AccountStore) {
  const initial = store.getState();
  let current = true;
  const matches = (state: AccountState) => state.accountId === initial.accountId && state.demoMode === initial.demoMode;
  const unsubscribe = store.subscribe(state => { if (!matches(state)) current = false; });
  return {
    isCurrent: () => current && matches(store.getState()),
    dispose: () => { current = false; unsubscribe(); },
  };
}
