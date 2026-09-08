import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt
import io.github.composefluent.animation.FluentEasing
import top.yukonga.miuix.kmp.anim.folmeSpring

/**
 * One live route, not AnimatedContent<SidebarSnapshot>. In particular this must not mount
 * an outgoing composer/media portal a second time or duplicate account-scoped intents.
 * Native buttons/navigation retain their own interaction sources and animation specs.
 */
@Composable
internal fun RouteMotion(state: SidebarSnapshot, split: Boolean, content: @Composable BoxScope.() -> Unit) {
    val route = NavigationMotionKey(state.epoch, state.mode, state.view, state.chat?.id,
        state.panes.map { it.id }, split)
    // A phone mounts this pane only after opening a chat: animate that first entry too.
    val progress = remember { Animatable(if (state.reducedMotion) 1f else 0f) }
    val previousRoute = remember { mutableStateOf(route) }
    LaunchedEffect(route, state.reducedMotion) {
        if (state.reducedMotion) {
            progress.snapTo(1f)
        } else if (previousRoute.value != route) {
            progress.snapTo(0f)
            previousRoute.value = route
            progress.animateTo(1f, routeEnterSpec(state.mode))
        } else if (progress.value != 1f) {
            progress.animateTo(1f, routeEnterSpec(state.mode))
        }
        previousRoute.value = route
    }
    val distance = with(LocalDensity.current) { (if (state.mode == "apple") 24.dp else 18.dp).toPx() }
    Box(Modifier.fillMaxSize().offset {
        // Placement (not a canvas-only transform) also updates HtmlElement/media coordinates.
        // Do not fade just the canvas: HTML video/audio portals must not remain fully opaque
        // at the old position. This reads only during placement, not in the message/JSON tree.
        val value = if (state.reducedMotion) 1f else progress.value
        val offset = ((1f - value) * distance).roundToInt()
        if (state.mode == "apple") IntOffset(offset, 0) else IntOffset(0, offset)
    }, content = content)
}

private fun routeEnterSpec(mode: String): FiniteAnimationSpec<Float> = when (mode) {
    "fluent" -> tween(durationMillis = 200, easing = FluentEasing.FastInvokeEasing)
    "miuix" -> folmeSpring(damping = .9f, response = .38f)
    else -> spring(dampingRatio = .85f, stiffness = 500f)
}
