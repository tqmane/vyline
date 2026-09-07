@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.HtmlElementView
import org.w3c.dom.HTMLElement
import kotlin.math.max
import kotlin.math.min

internal data class HtmlViewport(val bounds: Rect? = null, val visible: Boolean = true)
internal val LocalHtmlViewport = staticCompositionLocalOf { HtmlViewport() }

/** Web interop lives above the canvas, so its clip must also exist in the DOM. */
@Composable
internal fun <T : HTMLElement> ClippedHtmlElementView(factory: () -> T, modifier: Modifier, onRelease: (T) -> Unit = {}) {
    val viewport by rememberUpdatedState(LocalHtmlViewport.current)
    val density = LocalDensity.current.density
    val element = remember { arrayOfNulls<HTMLElement>(1) }
    val coordinates = remember { arrayOfNulls<LayoutCoordinates>(1) }
    fun applyClip(view: HTMLElement) {
        // The interop wrapper keeps the whole uncut box. Only its clipped child may take input.
        (view.parentElement as? HTMLElement)?.style?.setProperty("pointer-events", "none")
        view.style.setProperty("pointer-events", "auto")
        val layout = coordinates[0]
        val region = viewport.bounds
        if (!viewport.visible) { view.style.visibility = "hidden"; return }
        if (region == null) { view.style.visibility = "visible"; view.style.removeProperty("clip-path"); return }
        if (layout == null || !layout.isAttached) { view.style.visibility = "hidden"; return }
        val position = layout.positionInWindow()
        val bounds = Rect(position.x / density, position.y / density,
            (position.x + layout.size.width) / density, (position.y + layout.size.height) / density)
        val clip = htmlClipPath(bounds, region)
        view.style.visibility = if (clip == null) "hidden" else "visible"
        if (clip != null) view.style.setProperty("clip-path", clip)
    }
    HtmlElementView(factory = { factory().also { element[0] = it; applyClip(it) } },
        modifier = modifier.onGloballyPositioned { coordinates[0] = it; element[0]?.let(::applyClip) },
        update = { applyClip(it) },
        onRelease = { element[0] = null; coordinates[0] = null; onRelease(it) })
}

internal fun htmlClipPath(bounds: Rect, region: Rect): String? {
    if (min(bounds.right, region.right) <= max(bounds.left, region.left) || min(bounds.bottom, region.bottom) <= max(bounds.top, region.top)) return null
    return "inset(${max(0f, region.top - bounds.top)}px ${max(0f, bounds.right - region.right)}px ${max(0f, bounds.bottom - region.bottom)}px ${max(0f, region.left - bounds.left)}px)"
}

internal fun checkHtmlClipPath() {
    check(htmlClipPath(Rect(10f, 10f, 110f, 110f), Rect(0f, 50f, 80f, 200f)) == "inset(40.0px 30.0px 0.0px 0.0px)")
    check(htmlClipPath(Rect(0f, 0f, 10f, 10f), Rect(0f, 20f, 10f, 30f)) == null)
}
