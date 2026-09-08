# AndroidLiquidGlass interactive controls

Copyright 2025 Kyant. Licensed under Apache-2.0; see [the full license](AndroidLiquidGlass-LICENSE.txt).

`AppleMotion.kt` and `AppleLiquidTabs.kt` adapt the animation, deformation and highlight formulas from the following files in [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass), local revision `65ab177e90e5c1d8c62e70cf7755841982da65f6`:

- `app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/LiquidButton.kt`
- `app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/LiquidBottomTabs.kt`
- `app/src/commonMain/kotlin/com/kyant/backdrop/catalog/utils/InteractiveHighlight.kt`
- `app/src/commonMain/kotlin/com/kyant/backdrop/catalog/utils/DampedDragAnimation.kt`

The Vyline adaptations share Compose press interactions with the existing controls, preserve their actions and keyboard semantics, honor reduced motion, and restore the selected tab on cancelled drags. They use the published Backdrop 2.0.1 Skia/Wasm effects directly. The relevant Backdrop modifier, highlight, shadow and Skiko shader APIs were compared with the local `2.0.1` tag and have no differences.
