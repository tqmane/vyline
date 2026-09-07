export const CALL_PANEL_MIN_WIDTH = 320;

/** Reserve the host's sidebar before fitting a 320px chat beside a 320px call. */
export function callPanelLayout(totalWidth: number, requestedWidth: number, sidebarSpace = 0) {
  const total = Number.isFinite(totalWidth) ? Math.max(0, totalWidth) : 0;
  const sidebar = Number.isFinite(sidebarSpace) ? Math.max(0, sidebarSpace) : 0;
  const available = total - sidebar;
  const maximum = Math.max(CALL_PANEL_MIN_WIDTH, available - CALL_PANEL_MIN_WIDTH);
  const requested = Number.isFinite(requestedWidth) ? requestedWidth : 400;
  return {
    docked: available >= CALL_PANEL_MIN_WIDTH * 2,
    maximum,
    width: Math.max(CALL_PANEL_MIN_WIDTH, Math.min(maximum, requested)),
  };
}
