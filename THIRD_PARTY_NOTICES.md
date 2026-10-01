# Third-party notices

## Web TTYd Hub backend

This project reuses and modifies backend code from [Web TTYd Hub](https://github.com/sosopop/web-ttyd-hub), fixed source revision [`325822e0328da9bf8aa38394455805438a0f76d5`](https://github.com/sosopop/web-ttyd-hub/tree/325822e0328da9bf8aa38394455805438a0f76d5) (2026-02-09). The upstream `README.md` at that revision declares the project license as MIT. The reused source areas are the session and port managers, session routes, WebSocket handling, and server entry/application construction; they have been modified for this project.

That revision contains no separate `LICENSE`, `COPYING`, or `NOTICE` file and states no copyright holder. No copyright attribution has been inferred or invented here. The MIT permission and disclaimer terms declared by the upstream README are reproduced below; the repository's root `LICENSE` continues to apply to this project independently.

### MIT License terms declared by upstream

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## JetBrains Mono Nerd Font Mono

The bundled `JetBrainsMonoNerdFontMono-Regular.ttf` and `JetBrainsMonoNerdFontMono-Bold.ttf` are unmodified files from the fixed [Nerd Fonts v3.4.0 JetBrainsMono release archive](https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/JetBrainsMono.zip) (archive SHA-256 `76f05ff3ace48a464a6ca57977998784ff7bdbb65a6d915d7e401cd3927c493c`). The font patch is from [Nerd Fonts' JetBrainsMono source](https://github.com/ryanoasis/nerd-fonts/tree/v3.4.0/patched-fonts/JetBrainsMono).

The release's `OFL.txt` identifies the original JetBrains Mono font copyright as `Copyright 2020 The JetBrains Mono Project Authors` and licenses it under the SIL Open Font License 1.1. The Nerd Fonts v3.4.0 root [`LICENSE`](https://github.com/ryanoasis/nerd-fonts/blob/v3.4.0/LICENSE) separately states that source and patched fonts use the SIL Open Font License 1.1 and includes its font-patcher contribution notice for Ryan L McIntyre. Both upstream notice texts are included in `frontend/public/fonts/OFL.txt` and `frontend/public/fonts/NERD-FONTS-LICENSE.txt`; the latter also preserves Nerd Fonts' separate MIT terms for its source code. The patched font is not relicensed under this repository's root license.
