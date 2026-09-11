@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity

/** Browser autoscroll cannot see a canvas LazyColumn. Route its middle-button gesture to the real list. */
@Composable
internal fun MiddleAutoScroll(viewport: HtmlViewport) {
    val current by rememberUpdatedState(viewport)
    DisposableEffect(Unit) {
        val handle = installMiddleAutoScroll(
            hit = { x, y -> current.visible && current.bounds?.let { x >= it.left && x < it.right && y >= it.top && y < it.bottom } == true },
            enabled = { current.visible },
            scroll = { current.scroll?.invoke(it.toFloat()) },
        )
        onDispose { removeMiddleAutoScroll(handle) }
    }
}

@Composable
internal fun autoScrollListModifier(list: LazyListState, enabled: Boolean): Modifier {
    var bounds by remember { mutableStateOf(Rect.Zero) }
    val density = LocalDensity.current.density
    scrollingHtmlViewport(bounds, enabled, list)
    return Modifier.onGloballyPositioned {
        val rect = it.boundsInWindow()
        bounds = Rect(rect.left / density, rect.top / density, rect.right / density, rect.bottom / density)
    }
}

private fun installMiddleAutoScroll(hit: (Double, Double) -> Boolean, enabled: () -> Boolean, scroll: (Double) -> Unit): JsAny = js("""{
    let active = false, originY = 0, pointerY = 0, moved = false, frame = 0, previous = 0, marker = null, cursor = '';
    const stop = () => {
        if (!active) return;
        active = false; cancelAnimationFrame(frame); marker?.remove(); marker = null;
        document.documentElement.style.cursor = cursor;
        if (window.__vylineAutoScrollStop === stop) delete window.__vylineAutoScrollStop;
    };
    const tick = now => {
        if (!active || !enabled()) { stop(); return; }
        const distance = pointerY - originY, amount = Math.max(0, Math.abs(distance) - 12);
        if (amount) scroll(Math.sign(distance) * Math.min(1800, Math.pow(amount, 1.35) * 3) * Math.min(32, now - previous) / 1000);
        previous = now; frame = requestAnimationFrame(tick);
    };
    const down = event => {
        if (event.defaultPrevented) return;
        if (active) { event.preventDefault(); event.stopImmediatePropagation(); stop(); return; }
        if (event.button !== 1 || !hit(event.clientX, event.clientY) || event.composedPath().some(node => node?.matches?.('a[href],input,textarea,select'))) return;
        event.preventDefault(); event.stopImmediatePropagation(); window.__vylineAutoScrollStop?.();
        active = true; moved = false; originY = pointerY = event.clientY; previous = performance.now();
        cursor = document.documentElement.style.cursor; document.documentElement.style.cursor = 'ns-resize';
        marker = document.createElement('div'); marker.setAttribute('role', 'img'); marker.setAttribute('aria-label', '自動スクロール'); marker.textContent = '↕';
        Object.assign(marker.style, {position:'fixed',left:(event.clientX-12)+'px',top:(event.clientY-12)+'px',width:'24px',height:'24px',border:'1px solid white',borderRadius:'50%',color:'white',background:'#222d',textAlign:'center',font:'20px/22px sans-serif',pointerEvents:'none',zIndex:'2147483647'});
        document.body.append(marker); window.__vylineAutoScrollStop = stop; frame = requestAnimationFrame(tick);
    };
    const move = event => { if (active) { pointerY = event.clientY; moved ||= Math.abs(pointerY-originY) > 12; } };
    const up = event => { if (active && event.button === 1 && moved) stop(); };
    const key = event => { if (active) { stop(); if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); } } };
    const aux = event => { if (active && event.button === 1) event.preventDefault(); };
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key, true); window.addEventListener('auxclick', aux, true); window.addEventListener('blur', stop); window.addEventListener('wheel', stop, true);
    return () => {
        stop(); window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
        window.removeEventListener('keydown', key, true); window.removeEventListener('auxclick', aux, true); window.removeEventListener('blur', stop); window.removeEventListener('wheel', stop, true);
    };
}""")

private fun removeMiddleAutoScroll(handle: JsAny): Unit = js("handle()")
