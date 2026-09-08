/** Static wiring checks only. This does NOT compile Kotlin or render/test animations. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const kt = name => read(`src/wasmJsMain/kotlin/${name}.kt`);
const [app, sidebar, chat, surfaces, menu, apple, route, blur, build] = await Promise.all([
  kt('App'), kt('Sidebar'), kt('ChatScreen'), kt('MessageActionSurface'), kt('ThemedHostMenu'),
  kt('AppleMessageMenu'), kt('ThemeMotion'), kt('MiuixChrome'), read('build.gradle.kts'),
]);
const checks = [
  ['native Fluent acrylic enabled', sidebar.includes('useAcrylicPopup = true')],
  ['native Miuix popup host', sidebar.includes('MiuixScaffold(')],
  ['native Miuix press feedback enabled', (sidebar.match(/PressFeedbackType\.Sink/g) || []).length >= 2],
  ['native Miuix blur module pinned', build.includes('miuix-blur:0.9.3')],
  ['native Miuix texture blur used', blur.includes('return textureBlur(')],
  ['native Miuix spring used', route.includes('folmeSpring(')],
  ['native Fluent easing used', route.includes('FluentEasing.FastInvokeEasing')],
  ['navigation uses one live tree', !route.includes('AnimatedContent(') && route.includes('offset {')],
  ['native Fluent menu used', menu.includes('MenuFlyout(visible = visible')],
  ['native Fluent dialog used', surfaces.includes('FluentDialog(visible = visible')],
  ['native Miuix sheet/dialog used', surfaces.includes('OverlayBottomSheet(show = visible') && surfaces.includes('OverlayDialog(show = visible')],
  ['exit completion retained', app.includes('retainedMenu') && surfaces.includes('onDismissFinished') && chat.includes('transition.exited()')],
  ['Apple menu optical interaction connected', apple.includes('.appleLiquidBackdrop(') && apple.includes('motion.pointerModifier')],
  ['existing message commands retained', ['edit','revoke','reply','react','readers','retry','view-rich'].every(a => chat.includes(`action("${a}"`))],
];
for (const [name, passed] of checks) assert(passed, name);
console.log(`Static motion wiring PASS: ${checks.length} checks. Not a Compose build, browser test, or feature-parity proof.`);
