@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.runtime.*
import androidx.compose.foundation.MutatePriority
import androidx.compose.foundation.gestures.ScrollableDefaults
import androidx.compose.foundation.lazy.LazyListState
import kotlinx.coroutines.launch
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

internal data class HtmlViewport(val bounds: Rect? = null, val visible: Boolean = true,
    val scroll: ((Float) -> Unit)? = null, val fling: ((Float) -> Unit)? = null)
internal val LocalHtmlViewport = staticCompositionLocalOf { HtmlViewport() }

@Composable
internal fun scrollingHtmlViewport(bounds: Rect?, visible: Boolean, list: LazyListState, onInteraction: () -> Unit = {}): HtmlViewport {
    val density = LocalDensity.current.density
    val scope = rememberCoroutineScope()
    val fling = ScrollableDefaults.flingBehavior()
    return HtmlViewport(bounds, visible,
        scroll = { delta -> onInteraction(); scope.launch { list.scroll(MutatePriority.UserInput) { scrollBy(delta * density) } } },
        fling = { velocity -> scope.launch { list.scroll { with(fling) { performFling(velocity * density) } } } })
}

/** Web interop lives above the canvas, so its clip must also exist in the DOM. */
@Composable
internal fun <T : HTMLElement> ClippedHtmlElementView(factory: () -> T, modifier: Modifier, interactive: Boolean = true, onRelease: (T) -> Unit = {}) {
    val viewport by rememberUpdatedState(LocalHtmlViewport.current)
    val density = LocalDensity.current.density
    val element = remember { arrayOfNulls<HTMLElement>(1) }
    val coordinates = remember { arrayOfNulls<LayoutCoordinates>(1) }
    fun applyClip(view: HTMLElement) {
        // The interop wrapper keeps the whole uncut box. Only its clipped child may take input.
        (view.parentElement as? HTMLElement)?.style?.setProperty("pointer-events", "none")
        view.style.setProperty("pointer-events", if (interactive) "auto" else "none")
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
    HtmlElementView(factory = { factory().also { view ->
        element[0] = view; applyClip(view)
        attachMediaScrolling(view,
            scroll = { delta -> if (viewport.visible && viewport.scroll != null) { viewport.scroll?.invoke(delta.toFloat()); true } else false },
            fling = { velocity -> if (viewport.visible) viewport.fling?.invoke(velocity.toFloat()) })
    } },
        modifier = modifier.onGloballyPositioned { coordinates[0] = it; element[0]?.let(::applyClip) },
        update = { applyClip(it) },
        onRelease = { detachMediaScrolling(it); element[0] = null; coordinates[0] = null; onRelease(it) })
}

/** Delegate only scrolling over this media widget; controls and horizontal/pinch gestures retain their input. */
private fun attachMediaScrolling(element: HTMLElement, scroll: (Double) -> Boolean, fling: (Double) -> Unit): Unit = js("""{
    const control = e => e.composedPath().some(n => n?.matches?.('button,input,select,textarea,[role="separator"],video[controls],audio[controls]'));
    const wheel = e => { if (!e.ctrlKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && scroll(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? element.clientHeight : 1))) e.preventDefault(); };
    let drag = null;
    const start = e => { drag = e.touches.length === 1 && !control(e) ? { x:e.touches[0].clientX, y:e.touches[0].clientY, last:e.touches[0].clientY, time:performance.now(), vertical:false, velocity:0 } : null; };
    const move = e => {
        if (!drag || e.touches.length !== 1) { drag = null; return; }
        const touch = e.touches[0], now = performance.now(), dy = drag.last - touch.clientY;
        if (!drag.vertical) {
            const x = Math.abs(touch.clientX-drag.x), y = Math.abs(touch.clientY-drag.y);
            if (x > 8 && x > y) { drag = null; return; }
            if (y < 8) return;
            drag.vertical = true;
        }
        if (scroll(dy)) { e.preventDefault(); drag.velocity = .5*drag.velocity + .5*dy/Math.max(1,now-drag.time)*1000; }
        drag.last = touch.clientY; drag.time = now;
    };
    const end = () => { if (drag?.vertical && performance.now()-drag.time < 100) fling(drag.velocity); drag=null; };
    const cancel = () => { drag=null; };
    element.addEventListener('wheel',wheel,{passive:false}); element.addEventListener('touchstart',start,{passive:true});
    element.addEventListener('touchmove',move,{passive:false}); element.addEventListener('touchend',end); element.addEventListener('touchcancel',cancel);
    element.__vylineScrollCleanup = () => { element.removeEventListener('wheel',wheel); element.removeEventListener('touchstart',start); element.removeEventListener('touchmove',move); element.removeEventListener('touchend',end); element.removeEventListener('touchcancel',cancel); };
}""")
private fun detachMediaScrolling(element: HTMLElement): Unit = js("{ element.__vylineScrollCleanup?.(); delete element.__vylineScrollCleanup; }")

internal fun htmlClipPath(bounds: Rect, region: Rect): String? {
    if (min(bounds.right, region.right) <= max(bounds.left, region.left) || min(bounds.bottom, region.bottom) <= max(bounds.top, region.top)) return null
    return "inset(${max(0f, region.top - bounds.top)}px ${max(0f, bounds.right - region.right)}px ${max(0f, bounds.bottom - region.bottom)}px ${max(0f, region.left - bounds.left)}px)"
}

internal fun checkHtmlClipPath() {
    check(htmlClipPath(Rect(10f, 10f, 110f, 110f), Rect(0f, 50f, 80f, 200f)) == "inset(40.0px 30.0px 0.0px 0.0px)")
    check(htmlClipPath(Rect(0f, 0f, 10f, 10f), Rect(0f, 20f, 10f, 30f)) == null)
}
