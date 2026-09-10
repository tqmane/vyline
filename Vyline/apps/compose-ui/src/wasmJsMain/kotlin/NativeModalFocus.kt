import androidx.compose.foundation.focusGroup
import androidx.compose.runtime.Composable
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalInputModeManager
import kotlinx.browser.window
import org.w3c.dom.events.Event

/** Restore only a saved child of the surface that actually owned focus, never its fallback. */
internal class NativeConfirmationFocus {
    val content = FocusRequester()
    val foreground = FocusRequester()
    private var origin: FocusRequester? = null
    private var pending: FocusRequester? = null

    fun surface(requester: FocusRequester, dialogVisible: Boolean): Modifier =
        Modifier.focusRequester(requester).focusRestorer()
            .onFocusChanged { if (it.hasFocus && !dialogVisible) origin = requester }.focusGroup()

    fun opened(hasForeground: Boolean) {
        // A foreground surface can remain mounted while the background has stale focus.
        pending = origin?.takeIf { !hasForeground || it === foreground }
    }

    fun restore() {
        val target = pending
        pending = null
        target?.restoreFocusedChild()
    }
}

/** Canvas modals share a focus owner with the page, so Tab must cycle their own controls. */
internal class NativeModalFocus(private val keys: List<String>) {
    private val requesters = keys.associateWith { FocusRequester() }
    private var focused by mutableStateOf(keys.first())
    var keyboardNavigation by mutableStateOf(false)
        private set

    fun control(key: String): Modifier = Modifier.focusRequester(requesters.getValue(key))
        .onFocusChanged { if (it.isFocused) focused = key }

    fun isHighlighted(key: String): Boolean = keyboardNavigation && focused == key

    fun requestInitial() = requesters.getValue(keys.first()).requestFocus()

    fun restore() = requesters.getValue(focused).requestFocus()

    fun cycle(event: KeyEvent, arrows: Boolean = false): Boolean {
        if (event.type != KeyEventType.KeyDown ||
            event.key != Key.Tab && !(arrows && event.key in listOf(Key.DirectionUp, Key.DirectionDown))) return false
        keyboardNavigation = true
        val delta = if (event.key == Key.DirectionUp || event.key == Key.Tab && event.isShiftPressed) -1 else 1
        focused = keys[(keys.indexOf(focused) + delta + keys.size) % keys.size]
        requesters.getValue(focused).requestFocus()
        return true
    }
}

@Composable
internal fun rememberNativeModalFocus(keys: List<String>, identity: Any? = null): NativeModalFocus {
    val focus = remember(keys, identity) { NativeModalFocus(keys) }
    val inputMode = LocalInputModeManager.current
    DisposableEffect(focus) {
        // A parent HTML dialog restores the iframe, but leaves its document body focused.
        // Compose 1.12 Web keeps WindowInfo.isWindowFocused=true, so listen to the actual window.
        val restore: (Event) -> Unit = {
            inputMode.requestInputMode(InputMode.Keyboard)
            focusComposeCanvas()
            focus.restore()
        }
        window.addEventListener("focus", restore)
        onDispose { window.removeEventListener("focus", restore) }
    }
    val mode = LocalRendererMode.current
    LaunchedEffect(focus, mode) {
        inputMode.requestInputMode(InputMode.Keyboard)
        withFrameNanos { }
        focusComposeCanvas()
        // Native buttons are replaced when their design system changes, even
        // though the modal stays mounted. Restore its last control after attach.
        focus.restore()
    }
    return focus
}
