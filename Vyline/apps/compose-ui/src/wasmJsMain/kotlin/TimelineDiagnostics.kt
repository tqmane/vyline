@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import kotlinx.serialization.Serializable

@Serializable
private data class TimelineMeasurement(
    val epoch: Int,
    val chatId: String,
    val paneId: String,
    val generation: Int,
    val ownership: String,
    val expectedLastKey: String?,
    val messageCount: Int,
    val totalItemsCount: Int,
    val lastKey: String?,
    val lastIndex: Int,
    val lastOffset: Int,
    val lastSize: Int,
    val afterContentPadding: Int,
    val viewportStartOffset: Int,
    val viewportEndOffset: Int,
    val canScrollForward: Boolean,
    val isScrollInProgress: Boolean,
    val density: Float,
)

/** Numeric layout evidence only, never message bodies; absent outside the selftest entrypoint. */
@Composable
internal fun ObserveTimeline(state: SidebarSnapshot, list: LazyListState, ownership: () -> String, generation: () -> Int) {
    if (!selfChecksEnabled()) return
    val scope = rememberScopedAction()
    val chatId = state.chat?.id ?: return
    val paneId = scope.chatId ?: chatId
    val key = "${state.epoch}:$paneId"
    val owner = remember(key) { nextTimelineObserver() }
    val messages by rememberUpdatedState(state.messages)
    val currentGeneration by rememberUpdatedState(generation)
    val currentOwnership by rememberUpdatedState(ownership)
    val density = LocalDensity.current.density
    DisposableEffect(key, owner) { onDispose { removeTimelineMeasurement(key, owner) } }
    LaunchedEffect(key, owner, list, density) {
        snapshotFlow {
            val info = list.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()
            TimelineMeasurement(state.epoch, chatId, paneId, currentGeneration(), currentOwnership(), messages.lastOrNull()?.id,
                messages.size, info.totalItemsCount, last?.key as? String, last?.index ?: -1,
                last?.offset ?: 0, last?.size ?: 0, info.afterContentPadding,
                info.viewportStartOffset, info.viewportEndOffset, list.canScrollForward,
                list.isScrollInProgress, density)
        }.collect { publishTimelineMeasurement(key, owner, bridgeJson.encodeToString(it)) }
    }
}

private fun nextTimelineObserver(): Int = js("(window.__vylineTimelineObserver = (window.__vylineTimelineObserver || 0) + 1)")
private fun publishTimelineMeasurement(key: String, owner: Int, serialized: String): Unit = js("""{
    const measurements = window.__vylineTimelines ??= Object.create(null);
    measurements[key] = { ...JSON.parse(serialized), owner, measuredAt: performance.now() };
}""")
private fun removeTimelineMeasurement(key: String, owner: Int): Unit = js("""{
    if (window.__vylineTimelines?.[key]?.owner === owner) delete window.__vylineTimelines[key];
}""")
