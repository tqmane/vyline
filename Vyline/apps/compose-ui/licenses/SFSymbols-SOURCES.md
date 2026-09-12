# SF Symbols 8 provenance

Vyline vendors Apple glyph SVGs copied byte-for-byte from the user-provided SF Symbols 8.0 all-weights export. No Apple font is included in this repository.

- Source artifact: `C:/Users/Tqmane/Downloads/sf-symbols-8.0-all-weights/sf-symbols-8.0-all-weights.zip` (zip)
- Source artifact SHA-256: `93e664d9286767b291486eaeb7f9186edf890ab59631b37add1c3fb24a388d36`
- Export metadata: SF Symbols 8.0, package 8.0.0-beta.123, commit `b795c1a41f4940635752dfa60ae6fd82068bda5f`
- Complete export: 64359 SVGs
- Import rule: regular weight is used byte-for-byte for every glyph. The React call hang-up asset uses regular `phone.down.fill`.
- SF Symbols 8 renamed several families used here: `doc` to `document`, `mic` to `microphone`, and `ipad.and.iphone` to `ipad.landscape.and.iphone`.
- The SF Symbols 6 `note / note.text / note.text.badge.plus` family corresponds to the current `pad.header / text.pad.header / text.pad.header.badge.plus` family; this action therefore uses `text.pad.header`. `arrow.triangle.2.circlepath.camera` is now `arrow.trianglehead.2.clockwise.rotate.90.camera`.

## Compose resources

| Resource | SF symbol | SF Symbols 8 source | Weight | SHA-256 |
| --- | --- | --- | --- | --- |
| `sf_arrow_clockwise.svg` | `arrow.clockwise` | `sf-symbols-8.0-svg/arrow.clockwise.svg` | regular | `f9668be547f826064cdb354b3d12ed4664aeb3c343e39829d7ee712ea592febd` |
| `sf_arrow_expand.svg` | `arrow.up.left.and.arrow.down.right` | `sf-symbols-8.0-svg/arrow.up.left.and.arrow.down.right.svg` | regular | `97c833719069531f5ac2be7326676f83fa8badf06fdedfde34bfe51984e6d297` |
| `sf_arrow_up.svg` | `arrow.up` | `sf-symbols-8.0-svg/arrow.up.svg` | regular | `dd9c6b86a9bc971e8e92ea5eaca3afc2bf30ff0bba2bf32f6f043e90d4b96ba8` |
| `sf_arrowshape_turn_up_left.svg` | `arrowshape.turn.up.left` | `sf-symbols-8.0-svg/arrowshape.turn.up.left.svg` | regular | `1677df81090d9162f84b4c6ee9161d5cc4347ec69378d684fd979bf6296f3081` |
| `sf_bell_slash.svg` | `bell.slash` | `sf-symbols-8.0-svg/bell.slash.svg` | regular | `a6db068a278a9b251ce7a43fa77d7bf7119fe0ced45734f7bfc47be255f73959` |
| `sf_bell.svg` | `bell` | `sf-symbols-8.0-svg/bell.svg` | regular | `d43f8ca4f4eed9c9c9b364c057a5501dc6351f9062b48bfa51709807f99d6c62` |
| `sf_calendar.svg` | `calendar` | `sf-symbols-8.0-svg/calendar.svg` | regular | `3472786475620675dc1e7cae75730d7946ff586f6e18c05c085f33e94d9af244` |
| `sf_camera_switch.svg` | `arrow.trianglehead.2.clockwise.rotate.90.camera` | `sf-symbols-8.0-svg/arrow.trianglehead.2.clockwise.rotate.90.camera.svg` | regular | `866e70867eca333610cfa7d80fc052001fde651de492daa5d79de385e572720e` |
| `sf_camera.svg` | `camera` | `sf-symbols-8.0-svg/camera.svg` | regular | `5b7876506d691e023bef285c674ea71ae7d6665f7467ee5cc0b25bc89d9d0d48` |
| `sf_chart.svg` | `chart.bar` | `sf-symbols-8.0-svg/chart.bar.svg` | regular | `781b0c90c6e990be670c7a71d47979070e828a182f5df27a4c7c0628e8222fe3` |
| `sf_checkmark.svg` | `checkmark` | `sf-symbols-8.0-svg/checkmark.svg` | regular | `b94857f50796d0684be25d0e736b619d3d29e92cd99f3266f21b483d0db698ca` |
| `sf_chevron_down.svg` | `chevron.down` | `sf-symbols-8.0-svg/chevron.down.svg` | regular | `cdea65c1152d3a3baedde89c2080d36779be119721bccfe2c48a7f6da2cf40cf` |
| `sf_chevron_left.svg` | `chevron.left` | `sf-symbols-8.0-svg/chevron.left.svg` | regular | `897537467205cfd0eee09d8156f4f9389d5514a6f25a21e4decb5304c00bbe33` |
| `sf_chevron_right.svg` | `chevron.right` | `sf-symbols-8.0-svg/chevron.right.svg` | regular | `6f5890d702e2b52895cccf2e36cc0a533d4c580f71183940bf42409e4235a907` |
| `sf_chevron_up.svg` | `chevron.up` | `sf-symbols-8.0-svg/chevron.up.svg` | regular | `925b50010578596050bf4436b633781681aa2ba99fa3858fda11d86eaeddb1fd` |
| `sf_crop.svg` | `crop` | `sf-symbols-8.0-svg/crop.svg` | regular | `9a03060003eb4cb7fcd889e3dba718bba7ba3dd89cdafc973b9af84614e5b440` |
| `sf_devices.svg` | `ipad.landscape.and.iphone` | `sf-symbols-8.0-svg/ipad.landscape.and.iphone.svg` | regular | `028960d19e8ee0692767722d9ca2dfa0e09c24a93f92c2bd0d2d3ac4fa161d19` |
| `sf_doc_on_doc.svg` | `document.on.document` | `sf-symbols-8.0-svg/document.on.document.svg` | regular | `52b26259005c059bedfada2a70665c87a622349881d35fab83ee9013ca622769` |
| `sf_doc.svg` | `document` | `sf-symbols-8.0-svg/document.svg` | regular | `6a06bb285a5fe1b2eb29b4d687b83c412ee45303f528253a1e512bd962aa56cf` |
| `sf_face_smiling.svg` | `face.smiling` | `sf-symbols-8.0-svg/face.smiling.svg` | regular | `54d0b6c12b48a556bce63597464c615a4fa9933ff658ed95f5f7f27d9d7b77c4` |
| `sf_gearshape.svg` | `gearshape` | `sf-symbols-8.0-svg/gearshape.svg` | regular | `8c15bb84f88ab7ed703d94ad1809c18b64d8dc81e7aa7848e3c5caf962855187` |
| `sf_heart.svg` | `heart` | `sf-symbols-8.0-svg/heart.svg` | regular | `b03cdd9459d3be1f37c1d39af9de1e07b35f7fe44396c3af0f4a004d2d85e2ca` |
| `sf_info.svg` | `info.circle` | `sf-symbols-8.0-svg/info.circle.svg` | regular | `d27bc2da24ae535e4db6f34dbe83021c9be2426d1741409319a0d666db03f041` |
| `sf_lock.svg` | `lock` | `sf-symbols-8.0-svg/lock.svg` | regular | `aa6aeb20ee80a99915dfa7c1906addbc90adf053e6453ad8f7db377a907c8b1b` |
| `sf_magnifyingglass.svg` | `magnifyingglass` | `sf-symbols-8.0-svg/magnifyingglass.svg` | regular | `8906ece93cd86c5c8dd67be602138a66ae91b1ddbab0b6051b98417eeff93a9d` |
| `sf_mic_slash.svg` | `microphone.slash` | `sf-symbols-8.0-svg/microphone.slash.svg` | regular | `cf1cf68c0ddf496cac910ba07134d35b01cd81ecd0982c96cd7bccf45c8d4f10` |
| `sf_mic.svg` | `microphone` | `sf-symbols-8.0-svg/microphone.svg` | regular | `13a751e53558cd34217c25d3486b09f6fc14f64003e6dd6db547f9b8b5a61e45` |
| `sf_palette.svg` | `paintpalette` | `sf-symbols-8.0-svg/paintpalette.svg` | regular | `bd494658426172a5bf37438e177edc9ac6867a83a451a7696cd272a5771fc9db` |
| `sf_paperclip.svg` | `paperclip` | `sf-symbols-8.0-svg/paperclip.svg` | regular | `f95a2223d28b6f0af6f370cc05ec161aa2330a332be65914727a0a79b4a3e4c2` |
| `sf_pencil.svg` | `pencil` | `sf-symbols-8.0-svg/pencil.svg` | regular | `72c2c78bce877e5fd6b6e163bd0a2a0a89ed5b2a61297308263f1071832bf45a` |
| `sf_person_crop_circle.svg` | `person.crop.circle` | `sf-symbols-8.0-svg/person.crop.circle.svg` | regular | `0d32e11e668bcb7259fdb4a646126ae0ff670d9fb401b01b83404b5e8cac02eb` |
| `sf_phone_down.svg` | `phone.down` | `sf-symbols-8.0-svg/phone.down.svg` | regular | `4a2591af27bc0dc18be5318e877302e270e8d253034150553baf69eac2cc536d` |
| `sf_phone.svg` | `phone` | `sf-symbols-8.0-svg/phone.svg` | regular | `091defc0c7490c77d7d1f735187f526a7c67e10b2b51ea2cf83b443840334823` |
| `sf_photo.svg` | `photo` | `sf-symbols-8.0-svg/photo.svg` | regular | `9306932240ebe6592edaf2d5b9bd9c4049d173b203199a6fbadaf4ecefcd3df8` |
| `sf_pin.svg` | `pin` | `sf-symbols-8.0-svg/pin.svg` | regular | `b9c6f6f5ac269effb220a8a5a8ee48fbe006f270a15983979e065a03dad75955` |
| `sf_plugins.svg` | `puzzlepiece` | `sf-symbols-8.0-svg/puzzlepiece.svg` | regular | `a4d968cccb9aeac30fde1950c4c08d2f6fd19e46887a0b351ddaf5b1fb7bf40e` |
| `sf_plus.svg` | `plus` | `sf-symbols-8.0-svg/plus.svg` | regular | `d52ee3d97c8603ced9e457b6a0de1953ac56a3a304b24b4af99fc18f52307ff7` |
| `sf_slider_horizontal_3.svg` | `slider.horizontal.3` | `sf-symbols-8.0-svg/slider.horizontal.3.svg` | regular | `1562d95473e9d44834118b1906bbeb722834712285762d9313420ce094c2e049` |
| `sf_square_and_pencil.svg` | `square.and.pencil` | `sf-symbols-8.0-svg/square.and.pencil.svg` | regular | `c179eda626e7a725b9f8734429d7349ce544f9c834dc60ae5c8a9bed26487a05` |
| `sf_storage.svg` | `externaldrive` | `sf-symbols-8.0-svg/externaldrive.svg` | regular | `11e020c6c771c7fa64ed5c0b3ea83b52baa46528c7961646b048bd0678a3c605` |
| `sf_trash.svg` | `trash` | `sf-symbols-8.0-svg/trash.svg` | regular | `6eb582bb1f55462e2d020eed8d0c27874d6b3ed78360cd7b0bd143d0c8755f9f` |
| `sf_video_slash.svg` | `video.slash` | `sf-symbols-8.0-svg/video.slash.svg` | regular | `9e7cff45422e1be229698b1ef9215dbe7af53aec94dcfa89784a0556363d0004` |
| `sf_video.svg` | `video` | `sf-symbols-8.0-svg/video.svg` | regular | `08972f0150f109b6f0b3e72387c95ebf4203a21616a02e37ce2907af2758e405` |
| `sf_waveform.svg` | `waveform` | `sf-symbols-8.0-svg/waveform.svg` | regular | `4e317f1c59a33e4a8743a88a6e3d1cccfee7278581441b716bf4c0562f0d4f78` |
| `sf_xmark.svg` | `xmark` | `sf-symbols-8.0-svg/xmark.svg` | regular | `1acd6c99ee07fed0cc5819ec25ab4e59277d93391d520dbae2517c2ccda8430d` |
| `sidebar_left.svg` | `sidebar.left` | `sf-symbols-8.0-svg/sidebar.left.svg` | regular | `bc5d6830003f36ed0812d6b9bc3a3955bc1bc29e3c3c2e6fdbb45fd3dda18885` |

## Desktop call resources

| Resource | SF symbol | SF Symbols 8 source | Weight | SHA-256 |
| --- | --- | --- | --- | --- |
| `video.svg` | `video` | `sf-symbols-8.0-svg/video.svg` | regular | `08972f0150f109b6f0b3e72387c95ebf4203a21616a02e37ce2907af2758e405` |
| `mic-slash.svg` | `microphone.slash` | `sf-symbols-8.0-svg/microphone.slash.svg` | regular | `cf1cf68c0ddf496cac910ba07134d35b01cd81ecd0982c96cd7bccf45c8d4f10` |
| `video-slash.svg` | `video.slash` | `sf-symbols-8.0-svg/video.slash.svg` | regular | `9e7cff45422e1be229698b1ef9215dbe7af53aec94dcfa89784a0556363d0004` |
| `mic.svg` | `microphone` | `sf-symbols-8.0-svg/microphone.svg` | regular | `13a751e53558cd34217c25d3486b09f6fc14f64003e6dd6db547f9b8b5a61e45` |
| `phone.svg` | `phone` | `sf-symbols-8.0-svg/phone.svg` | regular | `091defc0c7490c77d7d1f735187f526a7c67e10b2b51ea2cf83b443840334823` |
| `camera-switch.svg` | `arrow.trianglehead.2.clockwise.rotate.90.camera` | `sf-symbols-8.0-svg/arrow.trianglehead.2.clockwise.rotate.90.camera.svg` | regular | `866e70867eca333610cfa7d80fc052001fde651de492daa5d79de385e572720e` |
| `phone-down.svg` | `phone.down.fill` | `sf-symbols-8.0-svg/phone.down.fill.svg` | regular | `606ccd457477cf38eafa5649e7a6698a6b1737f571d8bd74b90bc6bd8c5f9283` |

## Desktop plus-menu resources

| Resource | SF symbol | SF Symbols 8 source | Weight | SHA-256 |
| --- | --- | --- | --- | --- |
| `calendar.svg` | `calendar` | `sf-symbols-8.0-svg/calendar.svg` | regular | `3472786475620675dc1e7cae75730d7946ff586f6e18c05c085f33e94d9af244` |
| `shuffle.svg` | `shuffle` | `sf-symbols-8.0-svg/shuffle.svg` | regular | `d542398ae1885f751becd04b533cf6be1ee7911930b84060c27dd02a7cf10ccd` |
| `checklist.svg` | `checklist` | `sf-symbols-8.0-svg/checklist.svg` | regular | `a84edadf2a4b3ec4c783061bd3dd52deb2a84478226cf180b7e546c009c2a360` |
| `note.svg` | `text.pad.header` | `sf-symbols-8.0-svg/text.pad.header.svg` | regular | `92626bcd9b35a21a511213aac3b852f169f64bf530139b5d3d137dd50a932d51` |
| `photos.svg` | `photo.on.rectangle` | `sf-symbols-8.0-svg/photo.on.rectangle.svg` | regular | `1688d0d04d087f5bafde01fd374bf63087748bdb576d68106700f56faaf7a650` |
