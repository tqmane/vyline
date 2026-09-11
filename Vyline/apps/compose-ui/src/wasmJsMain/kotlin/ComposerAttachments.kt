@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.*

@Composable
internal fun PendingFiles(state: SidebarSnapshot) {
    val action = rememberScopedAction()
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Label("${state.composer.pending.size} 件のメディアを待機中", 11, color = LocalSecondaryInk.current, modifier = Modifier.weight(1f))
            NativeButton(state.mode, "添付をすべてクリア", enabled = !state.composer.sending) { action("clear-attachments") }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            state.composer.pending.forEach { file ->
                Column(Modifier.width(108.dp).clip(RoundedCornerShape(14.dp)).background(LocalSecondaryInk.current.copy(alpha = .07f)).padding(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Label(file.name, 11, modifier = Modifier.weight(1f))
                        LocalIconButton(Icons.Regular.Dismiss, "${file.name}を削除", state.mode) { action("remove-attachment", id = file.id) }
                    }
                    val image = rememberRemoteImage(if (file.kind == "image") file.url else null, 200).bitmap
                    if (image != null) Image(image, contentDescription = file.name, modifier = Modifier.size(90.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
                    else Box(Modifier.size(90.dp), contentAlignment = Alignment.Center) { Glyph(if (file.kind == "video") Icons.Regular.Play else Icons.Regular.Document, LocalSecondaryInk.current, 30) }
                }
            }
        }
        if (!state.composer.canSendMedia) Label("ログイン後に添付ファイルを送信できます", 11, color = LocalSecondaryInk.current, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
    }
}

@Composable
internal fun MentionPicker(state: SidebarSnapshot, selectedIndex: Int, choose: (Int) -> Unit) {
    val list = rememberLazyListState()
    LaunchedEffect(selectedIndex, state.composer.mentionOptions.size) {
        val visible = list.layoutInfo.visibleItemsInfo
        val selected = visible.firstOrNull { it.index == selectedIndex }
        if (selected == null || selected.offset < list.layoutInfo.viewportStartOffset || selected.offset + selected.size > list.layoutInfo.viewportEndOffset)
            list.scrollToItem(selectedIndex.coerceIn(0, (state.composer.mentionOptions.size - 1).coerceAtLeast(0)))
    }
    LazyColumn(state = list, modifier = Modifier.fillMaxWidth().heightIn(max = 196.dp).padding(6.dp).clip(RoundedCornerShape(14.dp))) {
        itemsIndexed(state.composer.mentionOptions) { index, option ->
            Row(Modifier.fillMaxWidth().background(if (index == selectedIndex) LocalAccent.current.copy(alpha = .12f) else LocalSecondaryInk.current.copy(alpha = .03f))
                .combinedClickable(onClick = { choose(index) }).semantics { role = Role.Button; selected = index == selectedIndex; contentDescription = "${option.name}をメンション" }
                .padding(horizontal = 12.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Glyph(if (option.all) Icons.Regular.Mail else Icons.Regular.Person, LocalAccent.current, 20)
                Label(option.name, 14, FontWeight.Medium)
            }
        }
    }
}
