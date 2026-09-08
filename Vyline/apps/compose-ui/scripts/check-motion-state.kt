/** Offline test for production commonMain policy; not a substitute for Compose/browser tests.
 * From compose-ui:
 * kotlinc src/commonMain/kotlin/MotionState.kt scripts/check-motion-state.kt -include-runtime -d motion-state.jar
 * java -jar motion-state.jar
 */
fun main() {
    val initial = MessagePanelTransition()
    check(initial.visible && initial.panel == MessagePanel.Actions)
    check(initial.request(MessagePanel.Actions) == initial)
    val openingEdit = initial.request(MessagePanel.Edit)
    check(!openingEdit.visible && openingEdit.panel == MessagePanel.Actions)
    check(openingEdit.nextPanel == MessagePanel.Edit)
    val editing = checkNotNull(openingEdit.exited())
    check(editing.visible && editing.panel == MessagePanel.Edit && editing.nextPanel == null)
    check(editing.exited() == editing) // Stale exit callback cannot close a new visible panel.
    check(editing.request(MessagePanel.Actions).exited() == initial)
    check(initial.dismiss().exited() == null)
    check(openingEdit.dismiss().exited() == null) // Cancel pending switch; never resurrect it.
    check(openingEdit.request(MessagePanel.Revoke).exited()?.panel == MessagePanel.Revoke)
    var sequences = 0
    fun explore(state: MessagePanelTransition, depth: Int) {
        sequences++
        check(!state.visible || state.nextPanel == null)
        if (depth == 0) return
        MessagePanel.values().forEach { target ->
            val requested = state.request(target)
            if (state.visible && state.panel == target) check(requested == state)
            else check(!requested.visible && requested.panel == state.panel && requested.nextPanel == target)
            val next = checkNotNull(requested.exited())
            check(next.visible && next.panel == target && next.nextPanel == null)
            check(requested.dismiss().exited() == null)
            explore(next, depth - 1)
        }
    }
    explore(initial, 5)
    val route = NavigationMotionKey(1, "apple", "chat", "chat-1", listOf("chat-1"), false)
    check(route == route.copy(paneIds = listOf("chat-1"))) // A new snapshot/list is not a new route.
    check(route != route.copy(chatId = "chat-2"))
    check(route != route.copy(epoch = 2))
    check(route != route.copy(theme = "miuix"))
    check(route != route.copy(view = "settings"))
    check(route != route.copy(split = true))
    println("Motion policy PASS: $sequences state sequences, exit/cancel/reopen invariants, stable route identity.")
}
