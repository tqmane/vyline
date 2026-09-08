/** Presentation only. No timers, host actions, browser heuristics or message snapshots. */
internal enum class MessagePanel { Actions, Edit, Revoke }

/**
 * A sheet/dialog stays composed while it exits. Switching sheet -> dialog is also an exit,
 * followed by a new entry, rather than destroying the first surface on the click frame.
 * A late completion while a surface is visible cannot dismiss a newly opened surface.
 */
internal data class MessagePanelTransition(
    val panel: MessagePanel = MessagePanel.Actions,
    val visible: Boolean = true,
    val nextPanel: MessagePanel? = null,
) {
    fun request(panel: MessagePanel): MessagePanelTransition =
        if (visible && panel == this.panel) this else copy(visible = false, nextPanel = panel)

    fun dismiss(): MessagePanelTransition = copy(visible = false, nextPanel = null)

    fun exited(): MessagePanelTransition? =
        if (visible) this else nextPanel?.let { MessagePanelTransition(panel = it) }
}

/** Do not key animation on an entire snapshot: typing/receipts must never restart navigation. */
internal data class NavigationMotionKey(
    val epoch: Int,
    val theme: String,
    val view: String,
    val chatId: String?,
    val paneIds: List<String>,
    val split: Boolean,
)
