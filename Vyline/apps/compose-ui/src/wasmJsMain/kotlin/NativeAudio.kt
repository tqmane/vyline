@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.ui.input.key.*
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.Play
import io.github.composefluent.icons.regular.Pause
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import kotlinx.browser.document
import org.w3c.dom.HTMLAudioElement

@Composable
internal fun NativeAudio(message: ChatMessage, source: String, mode: String) {
    val audio = remember(source) { (document.createElement("audio") as HTMLAudioElement).apply { src = source; preload = "metadata" } }
    var playing by remember(source) { mutableStateOf(false) }
    var failed by remember(source) { mutableStateOf(false) }
    var current by remember(source) { mutableDoubleStateOf(0.0) }
    var duration by remember(source) { mutableDoubleStateOf(message.audioSeconds ?: 0.0) }
    LaunchedEffect(message.audioSeconds) { message.audioSeconds?.takeIf { it > 0 && it.isFinite() }?.let { duration = it } }
    DisposableEffect(audio) {
        var probing = false
        audio.onloadedmetadata = {
            if (audio.duration.isFinite() && audio.duration > 0) duration = audio.duration
            else if (duration <= 0 && audio.duration == Double.POSITIVE_INFINITY) { probing = true; audio.currentTime = 1e10 }
        }
        audio.ondurationchange = { if (audio.duration.isFinite() && audio.duration > 0) duration = audio.duration }
        audio.ontimeupdate = {
            if (probing) { probing = false; audio.currentTime = 0.0 }
            else current = audio.currentTime
        }
        audio.onplay = { playing = true }
        audio.onpause = { playing = false }
        audio.onended = { playing = false; current = 0.0 }
        audio.onerror = { _, _, _, _, _ -> failed = true; null }
        onDispose { audio.pause(); audio.onloadedmetadata = null; audio.ondurationchange = null; audio.ontimeupdate = null; audio.onplay = null; audio.onpause = null; audio.onended = null; audio.onerror = null; audio.removeAttribute("src"); audio.load() }
    }
    val seek: (Float) -> Boolean = { value -> if (duration > 0) { audio.currentTime = value.coerceIn(0f, 1f) * duration; true } else false }
    Row(Modifier.width(260.dp).padding(4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(if (mode == "fluent") 6.dp else 22.dp))
            .background(LocalInk.current.copy(alpha = .15f))
            .clickable(enabled = !failed, role = Role.Button) { if (playing) audio.pause() else audio.play().catch { failed = true; null } }
            .semantics { contentDescription = if (playing) "一時停止" else "再生" }, contentAlignment = Alignment.Center) {
            Glyph(if (playing) Icons.Regular.Pause else Icons.Regular.Play, LocalInk.current, 22)
        }
        Column(Modifier.weight(1f)) {
            Box(Modifier.fillMaxWidth().height(32.dp).semantics {
                contentDescription = "音声の再生位置"
                progressBarRangeInfo = ProgressBarRangeInfo(if (duration > 0) (current / duration).toFloat().coerceIn(0f, 1f) else 0f, 0f..1f)
                setProgress(action = seek)
            }.onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown && event.key in listOf(Key.DirectionLeft, Key.DirectionRight) && duration > 0) { seek(((current + if (event.key == Key.DirectionRight) 5 else -5) / duration).toFloat()); true } else false
            }.focusable().pointerInput(duration) { detectTapGestures { seek(it.x / size.width) } }, contentAlignment = Alignment.CenterStart) {
                Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)).background(LocalInk.current.copy(alpha = .25f)))
                Box(Modifier.fillMaxWidth(if (duration > 0) (current / duration).toFloat().coerceIn(0f, 1f) else 0f).height(5.dp).clip(RoundedCornerShape(3.dp)).background(LocalInk.current))
            }
            Label(if (failed) "再生できません" else "${audioTime(current)} / ${if (duration > 0) audioTime(duration) else "—:—"}", 12, color = LocalInk.current.copy(alpha = .85f))
        }
    }
}

private fun audioTime(seconds: Double): String {
    val value = if (seconds.isFinite()) seconds.toInt().coerceAtLeast(0) else 0
    return "${value / 60}:${(value % 60).toString().padStart(2, '0')}"
}
