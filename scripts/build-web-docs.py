from pathlib import Path
from html import escape
import json, re, shutil, textwrap, os

ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'web'
SRC=WEB/'site-src'
DOCS=WEB/'docs'
for p in [WEB,SRC,DOCS]: p.mkdir(parents=True,exist_ok=True)

# preserve editable source bundle structure
(SRC/'README.md').write_text('''# Vyline Web Docs source\n\n公開物は依存ゼロの静的HTMLです。Vercelの Root Directory を `web/` にすればそのまま配信できます。\n\n## 再生成\n\n```bash\npython3 scripts/build-web-docs.py\n```\n\n- `scripts/build-web-docs.py`: ページ本文・ナビ・HTML生成の正本\n- `web/site-src/content.json`: 検索/一覧用ページメタデータ\n- `web/site-src/build.py`: 再生成エントリポイント\n- `web/assets/site.css`: LP / Docs共通デザイン\n- `web/assets/site.js`: Docs検索、テーマ、目次、コードコピー、モバイルメニュー\n- `web/docs/`: 生成済みWiki/Docs\n\nAndroid完全版の原稿は `docs/Vyline-Android-Docker-Complete-Guide-ja.md` を正本として、build時に内蔵のMarkdown変換器でWebページへ変換します（pandoc不要）。\n''',encoding='utf-8')

pages=[]
def page(slug,title,desc,group,body,keywords=''):
    pages.append(dict(slug=slug,title=title,desc=desc,group=group,body=textwrap.dedent(body).strip(),keywords=keywords))

# --- 自前 Markdown 変換器 (pandoc 依存の置き換え) ---------------------------
# Android 完全ガイドだけが Markdown ソース。CI や新規環境に pandoc を要求
# しないため、ガイドが使う GFM サブセット(見出し/フェンスコード/hr/引用/
# 順序・タスクリスト/インラインコード/強調)をレンダーする。

def _slugify(text):
    s=text.lower()
    s=re.sub(r'[:．.、，,;()（）\[\]「」『』!！?？/]','',s)
    s=re.sub(r'\s+','-',s)
    s=re.sub(r'[^\w\u3040-\u30ff\u4e00-\u9fff-]+','-',s)
    return re.sub(r'-+','-',s).strip('-')

def _inline_md(text):
    spans=[]
    def stash(m):
        spans.append('<code>'+escape(m.group(1))+'</code>')
        return '\x00%d\x00'%(len(spans)-1)
    text=re.sub(r'`([^`]*)`',stash,text)
    text=escape(text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',text)
    text=re.sub(r'\*([^*]+)\*',r'<em>\1</em>',text)
    text=re.sub(r'(https?://[^\s<>]+)',r'<a href="\1">\1</a>',text)
    for i,s in enumerate(spans):
        text=text.replace('\x00%d\x00'%i,s)
    return text

def md_to_html(md):
    lines=md.split('\n')
    blocks=[]; cur=[]; in_code=False
    for line in lines:
        if in_code:
            if line.strip()=='```':
                blocks.append(('code','\n'.join(cur))); cur=[]; in_code=False
            else:
                cur.append(line)
            continue
        if line.lstrip().startswith('```'):
            if cur: blocks.append(('text','\n'.join(cur))); cur=[]
            in_code=True
            continue
        cur.append(line)
    if in_code: blocks.append(('code','\n'.join(cur)))
    elif cur: blocks.append(('text','\n'.join(cur)))

    html=[]; list_buf=[]; p_buf=[]; list_kind=None
    def flush_list():
        nonlocal list_buf,list_kind
        if list_buf:
            task=any('<input' in x for x in list_buf)
            cls=' class="task-list"' if task else ''
            html.append('<ul%s>'%cls+''.join(list_buf)+'</ul>')
            list_buf=[]; list_kind=None
    def flush_para():
        nonlocal p_buf
        if p_buf:
            html.append('<p>'+' '.join(p_buf)+'</p>'); p_buf=[]
    def flush_all():
        flush_list(); flush_para()

    for kind,payload in blocks:
        if kind=='code':
            flush_all(); html.append('<pre class="text">'+escape(payload)+'</pre>')
            continue
        rest=payload.split('\n')
        for idx in range(len(rest)):
            line=rest[idx].rstrip()
            if not line: continue
            m=re.match(r"^(#{1,6})\s+(.*)\Z", line)
            if m:
                flush_all()
                lev=min(len(m.group(1))+1,6); text=_inline_md(m.group(2))
                html.append(f'<h{lev} id="{_slugify(m.group(2))}">{text}</h{lev}>')
                continue
            if re.match(r"^-{3,}\s*\Z", line):
                flush_all(); html.append('<hr />'); continue
            if line.startswith('> '):
                flush_all()
                q=[]
                while idx<len(rest) and rest[idx].lstrip().startswith('>'):
                    ql=rest[idx][2:].rstrip()
                    if ql.endswith('  '): ql=ql.rstrip()+'<br />'
                    q.append(ql)
                    idx+=1
                html.append('<blockquote><p>'+'<br />'.join(q)+'</p></blockquote>')
                continue
            m=re.match(r"^\s*[-*]\s+(?:\[( ?[xX]?)\]\s+)?(.*)\Z", line)
            if m:
                flush_para()
                if list_kind!='ul': flush_list(); list_kind='ul'
                box='<input type="checkbox" />' if m.group(1)==' ' else ('<input type="checkbox" checked="checked" />' if m.group(1) else '')
                list_buf.append('<li>'+box+_inline_md(m.group(2))+'</li>')
                continue
            m=re.match(r"^\s*(\d+)\.\s+(.*)\Z", line)
            if m:
                flush_para()
                if list_kind!='ol': flush_list(); list_kind='ol'
                list_buf.append('<li>'+_inline_md(m.group(2))+'</li>')
                continue
            flush_list()
            p_buf.append(_inline_md(line))
    flush_all()
    return '\n'.join(html)

page('','ドキュメント','Vylineの導入・運用・内部設計・開発者向け資料をまとめたWikiです。','はじめに',r'''
<h2 id="start">どこから読む？</h2>
<div class="cards three">
<a class="card" href="./quick-start/"><span class="eyebrow">5 MINUTES</span><h3>Quick Start</h3><p>Docker Composeで最短起動。初回ログインまで一気に進めます。</p></a>
<a class="card" href="./linux/"><span class="eyebrow">SELF-HOST</span><h3>Linux</h3><p>Ubuntuだけに寄せず、主要ディストリビューションごとの差を整理。</p></a>
<a class="card" href="./architecture/"><span class="eyebrow">DEEP DIVE</span><h3>仕組みを理解する</h3><p>Frontend、Backend、Protocol、永続化、LINEとの通信境界を俯瞰します。</p></a>
</div>
<h2 id="map">ドキュメントマップ</h2>
<p>「とにかく動かす」「端末ごとの構築」「仕組みを読む」「開発する」を分離しています。手順ページは再現性を優先し、仕組みページはソースコードとサブモジュールの責務を根拠に説明します。</p>
<div class="callout info"><strong>ソース優先</strong><p>Vyline本体だけでなく <code>Vyline/packages/protocol</code>、<code>plugin</code>、<code>themes</code>、<code>tools</code> も対象です。READMEと実装が食い違う場合は、現在の型・runtime実装を優先します。</p></div>
<h2 id="paths">主要ルート</h2>
<table><thead><tr><th>目的</th><th>入口</th></tr></thead><tbody>
<tr><td>初回導入</td><td><a href="./quick-start/">Quick Start</a></td></tr>
<tr><td>Linuxサーバー</td><td><a href="./linux/">Linux</a></td></tr>
<tr><td>Raspberry Pi</td><td><a href="./raspberry-pi/">Raspberry Pi</a></td></tr>
<tr><td>AndroidをDockerホスト化</td><td><a href="./android/">Android</a> → <a href="./android-kernel/">Kernel</a> → <a href="./android-network/">Network</a></td></tr>
<tr><td>仕組み</td><td><a href="./architecture/">Architecture</a> → <a href="./protocol/">Protocol</a> → <a href="./persistence/">Persistence</a></td></tr>
<tr><td>開発</td><td><a href="./developer/">Developer Guide</a> → <a href="./submodules/">Submodules</a></td></tr>
<tr><td>困った</td><td><a href="./troubleshooting/">Troubleshooting</a> / <a href="./index-a-z/">A–Z Index</a></td></tr>
</tbody></table>
''','overview wiki docs')

page('quick-start','Quick Start','Docker ComposeでVylineを最短起動する手順。永続化と安全な初期設定まで。','はじめに',r'''
<div class="callout warning"><strong>非公式クライアント</strong><p>VylineはLINE公式・承認済みクライアントではありません。アカウント停止、セッション破損、データ損失などのリスクを理解した上で利用してください。</p></div>
<h2 id="requirements">必要なもの</h2>
<ul><li>64-bit Linux（amd64 または arm64）</li><li>Docker Engine + Docker Compose v2</li><li>3000/tcpを利用できる環境</li><li>永続化用のストレージ</li></ul>
<h2 id="compose">1. Composeを取得</h2>
<pre><code class="language-bash">mkdir -p vyline && cd vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d</code></pre>
<p>既定イメージは <code>ghcr.io/tqmane/vyline:latest</code>。multi-arch manifestからホストに合う <code>linux/amd64</code> または <code>linux/arm64</code> が選ばれます。</p>
<h2 id="open">2. ブラウザで開く</h2>
<pre><code>http://&lt;server-ip&gt;:3000</code></pre>
<p>同一ホストからなら <code>http://127.0.0.1:3000</code>。LANの別端末から開く場合はホストのファイアウォールも確認します。</p>
<h2 id="data">3. データを守る</h2>
<p>Vylineで重要なのは <code>/app/data</code> と <code>/app/storage</code> です。標準Composeではホスト側の <code>./data</code> と <code>./storage</code> へ永続化されます。</p>
<div class="callout danger"><strong>更新時に削除しない</strong><p>ログイン状態、設定、チャットDB、復元履歴、キャッシュ、保存メディア等が含まれます。コンテナ再作成は問題ありませんが、bind mount先を消すと状態を失います。</p></div>
<h2 id="verify">4. 確認</h2>
<pre><code class="language-bash">docker compose ps
docker compose logs --tail=100</code></pre>
<p>更新は <code>docker compose pull &amp;&amp; docker compose up -d</code>。単なる <code>docker restart</code> は新しいimageへ切り替わらないため、recreateまで行います。</p>
<h2 id="next">次に読む</h2>
<ul><li>通常サーバー: <a href="../linux/">Linux</a></li><li>Raspberry Pi: <a href="../raspberry-pi/">Raspberry Pi</a></li><li>Android端末: <a href="../android/">Android</a></li><li>Portainer: <a href="../portainer/">Portainer</a></li><li>外部公開: <a href="../remote-access/">Remote Access</a></li></ul>
''','docker compose install')

page('linux','Linux','ディストリビューションごとの差を踏まえたVylineのLinux導入・運用ガイド。','インストール',r'''
<h2 id="principle">Linuxは一種類ではない</h2>
<p>Vyline自体の起動条件はDockerに吸収できますが、Dockerの導入方法、サービス管理、MAC（SELinux/AppArmor）、ファイアウォール、パッケージ名はディストリビューションごとに異なります。このページでは「共通層」と「ディストリ固有層」を分けます。</p>
<h2 id="matrix">対応の考え方</h2>
<table><thead><tr><th>系統</th><th>代表例</th><th>Docker導入</th><th>サービス</th><th>注意</th></tr></thead><tbody>
<tr><td>Debian系</td><td>Debian, Ubuntu, Mint系</td><td>Docker公式APT repo推奨</td><td>systemd</td><td>派生版は対応する親releaseを確認</td></tr>
<tr><td>RPM系</td><td>Fedora, RHEL, CentOS Stream, Rocky, Alma</td><td>Docker公式RPM repo</td><td>systemd</td><td>SELinux/firewalldを意識</td></tr>
<tr><td>Arch系</td><td>Arch, EndeavourOS等</td><td>distribution package</td><td>systemd</td><td>rolling release。Docker公式の検証対象外として扱う</td></tr>
<tr><td>openSUSE系</td><td>Tumbleweed, Leap</td><td>distribution package</td><td>systemd</td><td>zypper、firewalld等の差分</td></tr>
<tr><td>Alpine</td><td>Alpine Linux</td><td>apk repository</td><td>OpenRC</td><td>musl/OpenRC。systemctl手順を使わない</td></tr>
<tr><td>NAS/Appliance</td><td>Synology/QNAP等</td><td>製品固有</td><td>製品固有</td><td>通常Linux手順をそのまま適用しない</td></tr>
</tbody></table>
<div class="callout info"><strong>Docker公式サポート</strong><p>Docker Engineの公式Install一覧では、CentOS / Debian / Fedora / RHEL / Ubuntuがamd64・arm64をサポート対象として掲示されています。派生ディストリは親ディストリの手順が使える場合がありますが、Docker自身が検証しているとは限りません。</p></div>
<h2 id="common">共通: Dockerが動いた後</h2>
<pre><code class="language-bash">docker version
docker compose version
docker run --rm hello-world
mkdir -p ~/vyline && cd ~/vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d</code></pre>
<h2 id="debian">Debian / Ubuntu</h2>
<p>Docker公式APT repositoryを使う構成を推奨します。ディストリ標準の <code>docker.io</code> は簡単ですが、バージョン差やCompose pluginの扱いが異なるため、運用手順を混ぜないでください。</p>
<pre><code class="language-bash">sudo apt update
sudo apt install -y ca-certificates curl
# 以降は利用中の Debian/Ubuntu release に対応する Docker公式repositoryを設定
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker</code></pre>
<p>Linux Mint/Kali/LMDE等の派生版は、<code>/etc/os-release</code> の値をそのままDocker repositoryへ渡せないことがあります。対応するDebian/UbuntuのcodenameをDocker公式手順とディストリ資料で照合してください。</p>
<h2 id="rpm">Fedora / RHEL / CentOS Stream / Rocky / Alma</h2>
<p><code>dnf</code>系はDocker公式RPM repositoryが基準です。RPM系ではインストール後にDockerを明示起動する構成が一般的です。</p>
<pre><code class="language-bash">sudo dnf install -y dnf-plugins-core
# Docker公式 repository を追加後:
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker</code></pre>
<p>SELinuxを安易に無効化しないでください。通常のLinuxホストではDockerはSELinux環境を前提に動かせます。Android real-chrootの特殊ケースとは別物です。</p>
<h2 id="arch">Arch Linux系</h2>
<p>Archでは公式repositoryの <code>docker</code> / <code>docker-compose</code> など、Arch側が提供するパッケージを使うのが自然です。rolling releaseなので、Docker Engine・containerd・kernelの同時更新後は <code>hello-world</code> とVylineの再起動を確認してください。</p>
<pre><code class="language-bash">sudo pacman -Syu docker docker-compose
sudo systemctl enable --now docker</code></pre>
<h2 id="suse">openSUSE</h2>
<p>openSUSEでは <code>zypper</code> とディストリのDocker packageを使います。TumbleweedとLeapではpackageの鮮度・kernelの更新周期が異なるため、長期運用では自動更新後のコンテナ起動確認を入れると安全です。</p>
<pre><code class="language-bash">sudo zypper install docker docker-compose
sudo systemctl enable --now docker</code></pre>
<h2 id="alpine">Alpine Linux</h2>
<p>AlpineはsystemdではなくOpenRCが標準です。<code>systemctl</code> をコピーしないでください。</p>
<pre><code class="language-sh">sudo apk add docker docker-cli-compose
sudo rc-update add docker default
sudo service docker start</code></pre>
<p>Vylineコンテナ自身はBun runtimeをimage内に含むため、ホストがmuslであること自体は通常問題になりません。問題になるのはDocker daemonとホストkernel側です。</p>
<h2 id="firewall">Firewall / SELinux / AppArmor</h2>
<ul><li><strong>UFW:</strong> 3000/tcpをLANへ出すなら許可範囲を限定。</li><li><strong>firewalld:</strong> zoneとinterfaceを確認。単にportを開けるだけでなく、どのzoneにNICが入っているかを見る。</li><li><strong>SELinux:</strong> 通常Linuxでは無効化を前提にしない。</li><li><strong>AppArmor:</strong> Ubuntu/Debianで拒否ログが出た場合にのみprofileを確認。</li></ul>
<h2 id="rootless">Rootless Docker</h2>
<p>原理上はrootless Dockerでも動作可能な構成に近いですが、ポート、bind mount所有権、ネットワーク、ホスト再起動時のサービス管理が通常Dockerと異なります。まず標準DockerでVylineを安定動作させてから切り替えることを推奨します。</p>
''','ubuntu debian fedora rhel centos rocky alma arch opensuse alpine docker')

page('raspberry-pi','Raspberry Pi','Raspberry Pi OS 64-bitでのVyline構築。モデル選びの目安からメモリ・ストレージ対策まで。','インストール',r'''
<h2 id="support">64-bitを推奨</h2>
<p>VylineのGHCR imageは <code>linux/arm64</code> を提供しているため、Raspberry Piでは<strong>64-bit OS (aarch64)</strong>を前提にするのが最も素直です。Dockerの公式Install一覧でもRaspberry Pi OS 32-bitは別扱いで、arm64一般のサーバー構成とは分けて考えるべきです。</p>
<pre><code class="language-bash">uname -m
# 期待: aarch64</code></pre>
<h2 id="models">モデル選びの目安</h2>
<p>選定基準はモデル名ではなく<strong>RAM容量とストレージI/O</strong>です。下表はあくまで一例です。</p>
<table><thead><tr><th>区分</th><th>例</th><th>評価</th><th>メモ</th></tr></thead><tbody>
<tr><td>8GBクラス</td><td>Pi 5 / 8GB、Pi 4 / 8GB</td><td>推奨</td><td>DB復元・複数処理でも扱いやすい</td></tr>
<tr><td>4GB前後</td><td>Pi 4 / 4GB、Pi 5 / 4GB</td><td>実用的</td><td>SSD/USBストレージ推奨</td></tr>
<tr><td>1GBクラス</td><td>Pi 3B系、Zero 2 W等</td><td>非推奨</td><td>起動しても基本運用で余裕がなく、復元や同期で厳しい</td></tr>
</tbody></table>
<p>どのモデルでも、Vylineの状態・メディア量が膨らむと <code>storage/</code> の書き込みI/Oが支配的になります。モデル選びより先に、保存メディアの量とバックアップ方針を決めてください。</p>
<h2 id="install">Raspberry Pi OS 64-bit</h2>
<pre><code class="language-bash">sudo apt update && sudo apt full-upgrade -y
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker "$USER"
# 再ログイン後
docker run --rm hello-world</code></pre>
<p>Docker convenience scriptは手軽ですが、本番運用のupgrade方式として固定しないでください。長期運用ではDocker公式APT repositoryを管理する方式が明確です。</p>
<h2 id="storage">SDカードよりUSB SSD</h2>
<p>チャットDB、キャッシュ、メディア、Docker layerが継続的に書き込まれます。SDカードでも動きますが、耐久性とランダムI/Oの面からUSB SSD/高速USBストレージを推奨します。</p>
<pre><code class="language-bash">df -hT
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS,MODEL</code></pre>
<h2 id="memory">メモリ対策（1GBクラスを余儀なくされる場合）</h2>
<p>zramやswapfileはOOM回避には有効ですが、RAMそのものの代わりではありません。巨大な復元を行うと、swap I/OでUI/API応答が極端に遅くなることがあります。</p>
<ul><li>zram: 短いメモリ圧力の吸収に向く</li><li>USB上swapfile: SDカードよりましだが、RAMより桁違いに遅い</li><li>不要コンテナ停止: 最も確実</li><li>保存メディア/キャッシュを増やしすぎない</li></ul>
<h2 id="compose">Vyline起動</h2>
<pre><code class="language-bash">mkdir -p ~/vyline && cd ~/vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d
docker compose logs -f --tail=100</code></pre>
<h2 id="ops">常時稼働のポイント</h2>
<ul><li>電源品質を優先。低電圧ログを確認。</li><li>有線LAN推奨。Wi-Fiなら省電力・AP再接続挙動を確認。</li><li>Dockerログと <code>data/</code> / <code>storage/</code> の容量を監視。</li><li>OS更新後に <code>docker run --rm hello-world</code> とVylineを確認。</li><li>バックアップは同じSDカード内だけに置かない。</li></ul>
''','raspberry pi arm64 docker aarch64')

page('android','Android Docker Host','root済みarm64 AndroidをDockerホスト化してVylineを運用する全体ガイド。','インストール',r'''
<div class="callout danger"><strong>上級者向け</strong><p>Android上のDockerは通常のLinuxサーバーと違い、kernel config、SELinux、mount propagation、F2FS、Android netd/policy routingまで関係します。「Docker CLIが起動した」だけでは完成ではありません。</p></div>
<p><a class="card" href="../android-complete/"><span class="eyebrow">FULL GUIDE</span><strong>Android Docker 完全構築ガイドを読む →</strong></a></p>
<h2 id="architecture">推奨構成</h2>
<pre><code>Android arm64 device
├─ Android OS / vendor kernel
│  ├─ root (KernelSU / Magisk 等)
│  ├─ container向け kernel config
│  ├─ Android netd / policy routing
│  └─ SELinux
├─ Termux
│  ├─ BusyBox / SSH / tmux
│  └─ Ubuntu rootfs取得
├─ Ubuntu rootfs (real chroot)
│  ├─ Docker Engine / containerd / runc
│  └─ Compose
├─ ext4 loop image → /var/lib/docker
└─ containers
   ├─ vyline
   └─ cloudflared (任意)</code></pre>
<p>重要なのは <strong>proot上でDockerを動かし続けない</strong> ことです。rootfs取得にproot-distroを使い、実行時は本物の <code>chroot(2)</code> を使います。</p>
<h2 id="preflight">Preflight</h2>
<pre><code class="language-bash">uname -m
id
getenforce
cat /proc/cgroups
mount | grep -E 'cgroup|cgroup2'
ls -l /dev/block/loop* 2&gt;/dev/null</code></pre>
<p>最低でもarm64、root、namespaces/cgroups/seccomp/OverlayFS/veth/bridge/netfilter/ext4/loopが必要です。詳細は <a href="../android-kernel/">Android Kernel</a>。</p>
<h2 id="termux">Termux</h2>
<pre><code class="language-bash">pkg update -y
pkg install -y proot-distro busybox openssh tmux coreutils curl
termux-wake-lock
proot-distro install ubuntu</code></pre>
<p>Ubuntu rootfsの標準例:</p>
<pre><code>/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs</code></pre>
<h2 id="mounts">real chrootのmount</h2>
<pre><code class="language-bash">PREFIX=/data/data/com.termux/files/usr
ROOT="$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs"
BB="$PREFIX/bin/busybox"

su
$BB mount --bind "$ROOT" "$ROOT"
$BB mount --make-rslave "$ROOT"
$BB mount --rbind /dev "$ROOT/dev"
$BB mount --make-rslave "$ROOT/dev"
$BB mount -t proc proc "$ROOT/proc"
$BB mount --rbind /sys "$ROOT/sys"
$BB mount --make-rslave "$ROOT/sys"
$BB mount -t tmpfs -o mode=755,nosuid,nodev tmpfs "$ROOT/run"</code></pre>
<p>rootfs自体をself-bindしてmountpoint化し、rslaveへするのはruncのrecursive mount操作を成立させるためです。これを省くと <code>remount / ... invalid argument</code> 系で失敗することがあります。</p>
<h2 id="storage">Docker data-rootはext4へ</h2>
<p>Androidの <code>/data</code> はF2FS + casefold等のことがあり、そこへ直接 <code>overlay2</code> を置くと <code>EINVAL</code> になる実例があります。</p>
<pre><code class="language-bash">mkdir -p /data/local/docker-storage
truncate -s 64G /data/local/docker-storage/docker-ext4.img
/system/bin/mke2fs -t ext4 -F /data/local/docker-storage/docker-ext4.img
LOOP=$(/system/bin/losetup -f)
/system/bin/losetup "$LOOP" /data/local/docker-storage/docker-ext4.img
$BB mount -t ext4 -o rw,noatime "$LOOP" "$ROOT/var/lib/docker"</code></pre>
<h2 id="docker">chroot内のDocker</h2>
<pre><code class="language-json">{
  "storage-driver": "overlay2",
  "exec-opts": ["native.cgroupdriver=cgroupfs"],
  "log-driver": "local"
}</code></pre>
<pre><code class="language-bash">rm -f /var/run/docker.pid
nohup dockerd &gt;/var/log/dockerd.log 2&gt;&amp;1 &lt;/dev/null &amp;
docker run --rm hello-world
docker run --rm alpine uname -m
docker run --rm alpine ping -c 1 1.1.1.1</code></pre>
<h2 id="network">ネットワークは別問題</h2>
<p>Dockerが動いてもAndroid netdのpolicy routingやlegacy iptablesとの不一致で、container→Internet、LAN→published portが壊れることがあります。これは <a href="../android-network/">Android Network</a> で詳説します。</p>
<h2 id="compose">Vyline Compose</h2>
<pre><code class="language-yaml">services:
  vyline:
    image: ghcr.io/tqmane/vyline:latest
    pull_policy: always
    platform: linux/arm64
    ports:
      - "3000:3000"
    volumes:
      - /opt/vyline/data:/app/data
      - /opt/vyline/storage:/app/storage
    environment:
      VYLINE_HOST: 0.0.0.0
      PORT: 3000
      VYLINE_DATA_DIR: /app/data
      VYLINE_STORAGE_DIR: /app/storage
      VYLINE_LAN_ACCESS: "false"
      VYLINE_TRUST_REMOTE_OWNER: "false"
      TZ: Asia/Tokyo
    restart: unless-stopped
    healthcheck:
      disable: true</code></pre>
<p><code>docker exec</code> がmount namespaceを誤るAndroid/chroot実装では、コンテナ本体が正常でもhealthcheck経路だけ壊れることがあります。その場合に限りCompose側で無効化します。</p>
''','android termux chroot docker kernel f2fs overlay2')

page('android-kernel','Android Kernel Requirements','AndroidでDockerを成立させるkernel config・cgroup・SELinuxの深掘り。','インストール',r'''
<h2 id="why">ユーザーランドだけでは足りない</h2>
<p>Docker Engine、containerd、runcはnamespace、cgroup、mount、veth、netfilter等を直接使います。AndroidにDocker CLIを置くだけでは代替できません。</p>
<h2 id="minimum">重要なカテゴリ</h2>
<pre><code>1. namespaces
2. cgroups
3. seccomp
4. OverlayFS
5. bridge / veth
6. netfilter / conntrack / NAT
7. ext4
8. loop device
9. proc / sysfs / tmpfs / devpts
10. mount propagation</code></pre>
<h2 id="configs">代表的なCONFIG</h2>
<pre><code>CONFIG_NAMESPACES=y
CONFIG_UTS_NS=y
CONFIG_PID_NS=y
CONFIG_NET_NS=y
CONFIG_USER_NS=y
CONFIG_CGROUPS=y
CONFIG_MEMCG=y
CONFIG_CGROUP_PIDS=y
CONFIG_SECCOMP=y
CONFIG_SECCOMP_FILTER=y
CONFIG_OVERLAY_FS=y
CONFIG_VETH=y
CONFIG_BRIDGE=y
CONFIG_NETFILTER=y
CONFIG_NF_CONNTRACK=y
CONFIG_IP_NF_IPTABLES=y
CONFIG_IP_NF_NAT=y
CONFIG_IP_NF_TARGET_MASQUERADE=y
CONFIG_EXT4_FS=y
CONFIG_BLK_DEV_LOOP=y</code></pre>
<h2 id="inspect">実機確認</h2>
<pre><code class="language-bash">zcat /proc/config.gz | grep -E 'CONFIG_(NAMESPACES|UTS_NS|IPC_NS|PID_NS|NET_NS|USER_NS|CGROUPS|MEMCG|CGROUP_PIDS|SECCOMP|SECCOMP_FILTER|OVERLAY_FS|VETH|BRIDGE|NETFILTER|NF_CONNTRACK|IP_NF_NAT|EXT4_FS|BLK_DEV_LOOP)='
cat /proc/cgroups
findmnt -t cgroup,cgroup2</code></pre>
<p><code>/proc/config.gz</code> が無い場合はkernel imageのIKCONFIGを抽出するか、ビルド時configを確認します。自作kernelなら <code>CONFIG_IKCONFIG=y</code> / <code>CONFIG_IKCONFIG_PROC=y</code> は診断性が高い設定です。</p>
<h2 id="cgroup">cgroup driver</h2>
<p>AndroidはsystemdをPID 1としていないため、Android real-chroot内のDockerで <code>systemd</code> cgroup driverを前提にしない方が安全です。実証構成では <code>cgroupfs</code> を指定しています。</p>
<h2 id="selinux">SELinux</h2>
<p>通常のLinuxサーバーと違い、Android vendor policyがloop mountやdockerd操作を拒否することがあります。実証環境では <code>setenforce 0</code> を回避策として採用しましたが、Dockerの一般要件ではありません。</p>
<div class="callout danger"><strong>Permissiveは防御を下げる</strong><p>常用スマホで無条件に使う設定ではありません。本来は必要なsepolicyを追加する方が望ましく、サーバー専用端末での実験的運用として扱ってください。</p></div>
<h2 id="kvm">KVMは不要</h2>
<p>VylineをDockerで動かすだけなら <code>CONFIG_KVM</code>、<code>/dev/kvm</code>、virtio/vsock等は不要です。Docker containerとVMを混同しないでください。</p>
''','kernel config cgroup selinux kvm android')

page('android-network','Android Docker Networking','Android netd / policy routing / legacy iptablesとDocker bridgeの衝突を理解して直す。','インストール',r'''
<h2 id="symptoms">典型症状</h2>
<pre><code>container -> docker bridge ARP は成功
container -> Internet は失敗

または

container は正常
host :3000 は LISTEN
LANから接続すると reset / timeout</code></pre>
<h2 id="routing">Android policy routing</h2>
<p>Androidにはnetdが管理する多数の <code>ip rule</code> があり、通常Linuxのように自然にmain tableへ落ちないことがあります。Docker bridgeから来たpacketを明示的に <code>lookup main</code> へ送るruleが必要になるケースがあります。</p>
<pre><code class="language-bash">ip rule
ip route show table main
ip route get 1.1.1.1
echo 1 &gt; /proc/sys/net/ipv4/ip_forward</code></pre>
<p>実証構成では9800–9899を専用rule範囲にし、Android netd既存ruleはflushしません。</p>
<h2 id="iptables">legacy vs nft</h2>
<p>Ubuntu chroot内のDockerがnft系ruleを作っても、Android側の実packet pathがlegacy iptablesを通るとpublished portが機能しないことがあります。その場合はAndroid側legacy <code>PREROUTING</code> / <code>FORWARD</code> に専用chainを置いてDNATします。</p>
<pre><code class="language-bash">iptables --version
iptables -t nat -S
iptables -S FORWARD</code></pre>
<h2 id="chains">専用chain方式</h2>
<pre><code>filter: OP9DIN / OP9DOUT / OP9DFWD
nat:    OP9DPRE / OP9DPOST

INPUT       -> OP9DIN
OUTPUT      -> OP9DOUT
FORWARD     -> OP9DFWD
PREROUTING  -> OP9DPRE
POSTROUTING -> OP9DPOST</code></pre>
<p>名称は任意です。大事なのはAndroidのbuilt-in/netd chainを破壊せず、自分のruleだけを再生成できることです。</p>
<h2 id="masq">bridge→WAN</h2>
<pre><code class="language-bash">iptables -A OP9DFWD -i docker0 -o wlan0 -s 172.17.0.0/16 -j ACCEPT
iptables -A OP9DFWD -i wlan0 -o docker0 -d 172.17.0.0/16 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -t nat -A OP9DPOST -s 172.17.0.0/16 -o wlan0 -j MASQUERADE</code></pre>
<h2 id="dnat">LAN published port</h2>
<pre><code class="language-bash">iptables -t nat -A OP9DPRE -i wlan0 -p tcp --dport 3000 \
  -j DNAT --to-destination 172.30.50.2:3000
iptables -A OP9DFWD -i wlan0 -o br-XXXXXXXXXXXX \
  -p tcp -d 172.30.50.2 --dport 3000 -j ACCEPT</code></pre>
<h2 id="watcher">なぜwatcherが必要か</h2>
<p>Compose再作成でcontainer IPやbridgeが変わるため、固定ruleは腐ります。実証構成では3秒ごとにDocker network/container/WANを再列挙し、自前ruleだけを同期しました。</p>
<pre><code>loop
  docker network inspect -> bridge/subnet
  docker inspect -> container IP / published ports
  WAN interface/gatewayを再検出
  9800-9899 ip ruleを再構築
  専用iptables chainを再構築
  sleep 3</code></pre>
<h2 id="cloudflare">Cloudflare companionが楽な理由</h2>
<p>外部公開だけが目的なら、cloudflaredを同じDocker networkへ置きoriginを <code>http://vyline:3000</code> にすると、Androidホストのpublished port経路を避けられます。LANアクセスは別途必要ならnetwork fixを行います。</p>
''','android network netd iptables nft dnat policy routing')

page('portainer','Portainer','PortainerでVylineを管理・更新する方法。Android固有の注意も含む。','運用',r'''
<h2 id="normal">通常Linux</h2>
<p>PortainerのStacksから <code>docker-compose.portainer.yml</code> を貼り付けてDeployします。imageはGHCRからpullするため、ホスト上でBun buildは不要です。</p>
<h2 id="update">更新</h2>
<ol><li>Pull latest image</li><li>StackをUpdate / Redeploy</li><li>コンテナが新image IDでrecreateされたことを確認</li><li>ログイン状態・履歴・storageを確認</li></ol>
<h2 id="android">Android real-chroot</h2>
<p>AndroidではPortainer自身のbridge published portがresetした実例があるため、host networkが安定する場合があります。</p>
<pre><code class="language-bash">docker volume create portainer_data
docker run -d \
  --name portainer \
  --restart=always \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest \
  --http-disabled</code></pre>
<pre><code>https://&lt;host-ip&gt;:9443</code></pre>
<div class="callout warning"><strong>Docker socketはroot相当</strong><p><code>/var/run/docker.sock</code> を渡したPortainerはホスト上で非常に強い権限を持ちます。管理画面を認証なしで外部公開しないでください。</p></div>
''','portainer stack docker')

page('remote-access','外部アクセス','Cloudflare Tunnel / VPN / reverse proxyでVylineを安全に外部公開する。','運用',r'''
<h2 id="rule">生の:3000をInternetへ出さない</h2>
<p>ルーターで <code>Internet → Vyline:3000</code> を直接port forwardする構成は避けてください。TLSと認証された到達経路を前に置きます。</p>
<h2 id="options">選択肢</h2>
<table><thead><tr><th>方式</th><th>向く用途</th><th>特徴</th></tr></thead><tbody>
<tr><td>Cloudflare Tunnel + Access</td><td>Webブラウザから使う</td><td>Inbound port不要。Accessで認証を追加</td></tr>
<tr><td>Tailscale</td><td>自分の端末だけ</td><td>private overlay network。公開DNS不要</td></tr>
<tr><td>WireGuard</td><td>自前VPN</td><td>柔軟だがrouting/鍵管理を自分で行う</td></tr>
<tr><td>Reverse proxy</td><td>既存のNginx/Caddy環境</td><td>TLS/auth/header設定を自分で管理</td></tr>
</tbody></table>
<h2 id="companion">cloudflared companion</h2>
<pre><code class="language-yaml">services:
  vyline:
    image: ghcr.io/tqmane/vyline:latest
    networks: [vyline_net]
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: [tunnel, --no-autoupdate, run, --token, ${CLOUDFLARE_TUNNEL_TOKEN}]
    depends_on: [vyline]
    networks: [vyline_net]
networks:
  vyline_net:
    driver: bridge</code></pre>
<p>Cloudflare側originは <code>http://vyline:3000</code>。Docker内DNS名であり、PCブラウザに入力する名前ではありません。</p>
<div class="callout danger"><strong>Tokenをcommitしない</strong><p><code>CLOUDFLARE_TUNNEL_TOKEN</code>、LINE session/token、<code>data/</code>、<code>storage/</code>、backup ZIPをGitへ入れないでください。</p></div>
''','cloudflare tunnel tailscale wireguard reverse proxy security')

page('updates-backups','更新とバックアップ','GHCR更新、コンテナ再作成、バックアップと復元の安全な運用。','運用',r'''
<h2 id="update">更新フロー</h2>
<pre><code class="language-bash">docker compose pull
docker compose up -d
docker image prune</code></pre>
<p><code>restart</code> では既存containerが古いimageを参照し続けます。新imageをpullした後にrecreateします。</p>
<h2 id="what">バックアップ対象</h2>
<pre><code>data/     -> account/session/settings/chat DB/restore state
storage/  -> cache/icons/saved media</code></pre>
<p>最低限 <code>data/</code> は必須。メディアを再取得できない/残したい場合は <code>storage/</code> も含めます。</p>
<h2 id="safe">整合性を優先するバックアップ</h2>
<pre><code class="language-bash">docker compose stop
sudo tar -C . -czf vyline-backup-$(date +%F).tar.gz data storage
docker compose start</code></pre>
<p>短い停止を許容できるなら、DB書き込み中のコピーを避けられます。オンラインバックアップを自動化する場合はDB/atomic writeの挙動を理解した上でテストしてください。</p>
<h2 id="restore">復元後チェック</h2>
<ol><li>bind mount先が正しい</li><li>container起動ログにpermission errorがない</li><li>ログイン状態が残る</li><li>履歴をreloadしても消えない</li><li>container recreate後も残る</li></ol>
''','backup restore update ghcr persistence')

page('architecture','Architecture','Vyline本体とProtocol・Plugin・Themes・Toolsを含む全体アーキテクチャ。','仕組み',r'''
<h2 id="overview">全体像</h2>
<pre><code>Browser
  │ HTTP / WebSocket
  ▼
Desktop Web UI (Vyline/apps/desktop)
  │
  ▼
Backend (Vyline/backend)
  ├─ account/session orchestration
  ├─ API / storage / restore / media
  ├─ plugin runtime
  └─ profileBridge / lineService
       │
       ▼
@vyline/protocol  ← submodule: vyline-api
  ├─ login (QR / Email / Token)
  ├─ transport / headers / RPC
  ├─ E2EE / identity
  ├─ Talk / sync / domain facade
  └─ Desktop profile updater
       │
       ▼
LINE services

side modules:
@vyline/plugin-sdk ← submodule
@vyline/themes     ← submodule
Vyline-Search      ← submodule / reverse-engineering toolchain</code></pre>
<h2 id="boundary">責務境界</h2>
<table><thead><tr><th>層</th><th>責務</th><th>主な場所</th></tr></thead><tbody>
<tr><td>UI</td><td>会話、設定、アカウント、テーマ等の表示</td><td><code>Vyline/apps/desktop</code></td></tr>
<tr><td>Backend</td><td>HTTP API、アカウント状態、DB、メディア、restore、plugin runtime</td><td><code>Vyline/backend</code></td></tr>
<tr><td>Protocol</td><td>LINE RPC、login、transport、E2EE、Talk domain</td><td><code>Vyline/packages/protocol</code></td></tr>
<tr><td>Plugin</td><td>外部拡張の型・権限・lifecycle</td><td><code>Vyline/packages/plugin</code></td></tr>
<tr><td>Themes</td><td>VyTheme preset/token</td><td><code>Vyline/packages/themes</code></td></tr>
<tr><td>Tools</td><td>Desktop LINEのversion/unpack/xref/decompile補助</td><td><code>tools</code></td></tr>
</tbody></table>
<h2 id="request">WebからLINEまで</h2>
<ol><li>UIがBackend APIを呼ぶ。</li><li>Backendが対象accountのsessionを解決。</li><li><code>lineService</code> / domain facadeがProtocolへ委譲。</li><li>Protocolがdevice mode・headers・endpoint・E2EE状態を整えRPCを送信。</li><li>response/eventをBackend側の状態とDBへ反映。</li><li>UIへ更新を配信。</li></ol>
<h2 id="why-submodules">なぜサブモジュール分離か</h2>
<p>LINEプロトコル追従、plugin SDK、theme preset、Desktop解析ツールは更新周期と責務が異なります。モノレポ側から完全に切り離すことで、それぞれ単独の履歴・release・検証単位を持てます。一方でworkspace型依存があるため、protocol単体のbuildは兄弟packageを必要とします。</p>
<h2 id="source-map">Source Map</h2>
<p>詳細は <a href="../submodules/">Submodules</a>。LINE通信はProtocol、実アプリのデータ保存はBackend、見た目のpresetはThemes、Desktop仕様の追跡はTools、と読む場所を分けるのが最短です。</p>
''','architecture backend frontend submodule protocol plugin themes tools')

page('protocol','LINE Protocol & E2EE','@vyline/protocolサブモジュールのdevice mode、login、transport、E2EE、Talkを詳説。','仕組み',r'''
<h2 id="device">Device mode</h2>
<table><thead><tr><th>値</th><th>位置づけ</th></tr></thead><tbody>
<tr><td><code>IOSIPAD</code></td><td>既定。副端末として公式Desktop/スマホとの共存を狙う</td></tr>
<tr><td><code>ANDROIDSECONDARY</code></td><td>副端末代替</td></tr>
<tr><td><code>DESKTOPWIN</code></td><td>Desktop header/login patch。公式Windows Desktopと競合し得る</td></tr>
<tr><td><code>DESKTOPMAC</code></td><td>Mac Desktop相当</td></tr>
</tbody></table>
<h2 id="flow">Protocol内部</h2>
<pre><code>VylineUpdater
  └─ DesktopProfile (UA / X-Line-Application / hosts)
        ↓
VylineClient
  ├─ patchDesktopTransport
  ├─ patchDesktopLogin
  ├─ ensureValidE2EEIdentity
  └─ TalkService / domain facade</code></pre>
<h2 id="login">Login</h2>
<h3>QR</h3><p><code>loginWithQR</code> → protocol stack → secure QR login。Desktop mode時はsystemName/modelNameを実機identityに合わせるpatchが入ります。</p>
<h3>Email + E2EE</h3><ol><li>RSA key取得</li><li><code>loginV2</code> / E2EE confirm</li><li>keychain取得</li><li>自己鍵を保存</li><li>server最新鍵と整合</li></ol>
<h3>Token</h3><p><code>loginWithToken</code> でaccess tokenを復元した後も、transportとE2EE identityのensureを通します。</p>
<h2 id="transport">Transport</h2>
<p>Desktop実測情報から <code>user-agent</code>、<code>x-line-application</code>、locale、host、RPC pathを構成します。Profile解決の優先順位は、稼働中Desktopの抽出 → install/OS合成 → cache → fallbackです。</p>
<h2 id="e2ee">E2EE</h2>
<p>ログイン前の古い履歴は、当時と同じ自己鍵が揃わないと復号できない場合があります。また送信ではserver最新 <code>keyId</code> に対応する秘密鍵が必要で、欠落するとsender-key update系エラーになります。</p>
<h2 id="domain">Domain facade</h2>
<p><code>wrapSession(client)</code> でlogin済みClientを包み、Profile / Contacts / Chat / Talkを機能別APIとしてBackendへ提供します。Protocolの生RPCをBackend全体へ漏らさないための境界です。</p>
<h2 id="map">Modules Map</h2>
<p><code>src/modules.map.ts</code> は機能と関連ファイル・Desktop検索文字列を結び、Desktop LINE更新でどの領域を再調査すべきかを示す地図です。Toolsサブモジュールと合わせて、プロトコル追従を属人的な勘から反復可能な作業へ近づけています。</p>
''','protocol line e2ee login qr email token desktop rpc talk')

page('persistence','Persistence & Storage','/app/dataと/app/storage、DB、復元、atomic write、権限修復の考え方。','仕組み',r'''
<h2 id="paths">2つの永続化境界</h2>
<pre><code>/app/data
├─ account/session state
├─ settings
├─ chat DB
├─ restore state
└─ backup-related data

/app/storage
├─ cache/cdn-cache
├─ cache/icons
└─ saved-media/{images,videos,audio,files}</code></pre>
<h2 id="why">なぜ分けるか</h2>
<p><code>data</code> は「アプリ状態として失うと困るもの」、<code>storage</code> は「大容量のcache/media」を中心に分けています。バックアップ頻度、容量監視、削除UIの責務を分離できます。</p>
<h2 id="entrypoint">Bind mount ownership</h2>
<p>image内で <code>/app/data</code> をbunユーザー所有にしていても、ホストbind mountを重ねればホスト側ownershipが優先されます。entrypointは起動初期だけrootでownershipを補正し、書き込み確認後にunprivileged userへ落とします。</p>
<h2 id="restore">「復元できたように見えて消える」問題</h2>
<pre><code>restore -> memoryには履歴あり
        -> DB書き込み失敗
        -> UIでは一時的に見える
        -> reload/restart
        -> 消える</code></pre>
<p>このパターンではProtocolより先にbind mountとpermissionを疑います。</p>
<pre><code class="language-bash">docker inspect vyline
docker logs vyline
du -sh data storage</code></pre>
<h2 id="capacity">Storage表示</h2>
<p>Linux/Dockerではfilesystem容量を <code>statfs</code> で取得し、Vyline全体の使用量としてdata + storageを集計する設計です。一方、ユーザーが簡単に削除できる対象はcache/mediaに限定し、チャット履歴そのものを「掃除」ボタンで消す設計にはしません。</p>
''','persistence storage data database restore atomic permission')

page('access-model','Access Model & Security','LAN access、remote owner、reverse proxy、秘密情報などのアクセス制御。','仕組み',r'''
<h2 id="defaults">安全側の既定</h2>
<pre><code>VYLINE_LAN_ACCESS=false
VYLINE_TRUST_REMOTE_OWNER=false</code></pre>
<p><code>VYLINE_LAN_ACCESS</code> は単なるlisten addressの意味ではなく、subdevice pairing/remote requestの扱いに関わります。外部公開したいからと無条件にtrueへしないでください。</p>
<h2 id="listen">listenアドレスと公開の関係</h2>
<p><code>VYLINE_HOST</code> を <code>0.0.0.0</code> など非ループバックへbindすると、<code>VYLINE_LAN_ACCESS=false</code> のままでもbackendは「リモート配置」として扱います。この場合、リモートからのsubdevice認証は強制され、ownerの認証・ペアリング操作はループバック専用のままです（起動ログに警告が出ます）。「外からアクセスできる」=「安全な公開」ではありません。bindアドレスと各フラグはセットで設計してください。</p>
<h2 id="remote-owner">TRUST_REMOTE_OWNER</h2>
<p>Cloudflare Access、Tailscale ACL、強い認証付きreverse proxy等で到達経路自体を制限し、remote browserをownerとして信頼する設計を明示的に採る場合だけ検討します。</p>
<div class="callout danger"><strong>生LAN/生Internetでtrueにしない</strong><p>remote requestの信頼境界を広げる設定です。ネットワーク境界と認証境界を先に設計してください。</p></div>
<h2 id="secrets">秘密情報</h2>
<ul><li><code>.env</code></li><li>Cloudflare tunnel token</li><li>LINE token/session</li><li><code>data/</code>, <code>storage/</code></li><li>backup ZIP / account DB</li><li>Desktop E2EE key dump</li></ul>
<h2 id="plugins">Plugin trust</h2>
<p>プラグインは権限宣言とaccount scopeを持ちますが、第三者pluginはコードです。権限名だけで安全性が保証されるわけではありません。install前にsourceを確認し、不要な権限を持つpluginを有効化しないでください。</p>
''','security lan access remote owner secrets')

page('configuration','Configuration Reference','Compose設定と実在する環境変数のリファレンス。既定値はリポジトリの実装に基づく。','リファレンス',r'''
<h2 id="compose">Compose側の設定</h2>
<table><thead><tr><th>項目</th><th>用途</th><th>推奨 / 既定</th></tr></thead><tbody>
<tr><td><code>image</code></td><td>GHCR image（<code>${VYLINE_IMAGE:-ghcr.io/tqmane/vyline:latest}</code>）</td><td><code>ghcr.io/tqmane/vyline:latest</code></td></tr>
<tr><td><code>pull_policy</code></td><td>毎回pullして最新imageへ</td><td><code>always</code></td></tr>
<tr><td><code>ports</code></td><td>Web port（<code>${VYLINE_BIND_ADDRESS:-0.0.0.0}:${VYLINE_PORT:-3000}:3000</code>）</td><td><code>3000:3000</code>、ローカル専用なら <code>127.0.0.1:3000:3000</code></td></tr>
<tr><td><code>volumes</code></td><td><code>/app/data</code>・<code>/app/storage</code> の永続化</td><td><code>${VYLINE_DATA_PATH:-./data}</code> / <code>${VYLINE_STORAGE_PATH:-./storage}</code></td></tr>
<tr><td><code>restart</code></td><td>daemon/再起動時の挙動</td><td><code>unless-stopped</code></td></tr>
<tr><td><code>init</code> / <code>stop_grace_period</code></td><td>シグナル処理 / 終了猶予</td><td><code>true</code> / <code>30s</code></td></tr>
</tbody></table>
<h2 id="core">コア環境変数</h2>
<table><thead><tr><th>変数</th><th>意味</th><th>既定値</th></tr></thead><tbody>
<tr><td><code>VYLINE_HOST</code></td><td>listenアドレス。非ループバックbindはリモート配置として扱われる（後述）</td><td>devでは <code>127.0.0.1</code>、Composeは <code>0.0.0.0</code></td></tr>
<tr><td><code>PORT</code></td><td>listenポート</td><td>dev: <code>3001</code>、Compose: <code>3000</code></td></tr>
<tr><td><code>VYLINE_DATA_DIR</code></td><td>アカウント/DB/設定/ログ等のroot</td><td>dev: <code>backend/data</code>、Compose: <code>/app/data</code></td></tr>
<tr><td><code>VYLINE_STORAGE_DIR</code></td><td>cache/media等のroot</td><td>dev: <code>backend/storage</code>、Compose: <code>/app/storage</code></td></tr>
<tr><td><code>VYLINE_DEVICE</code></td><td>Protocol device mode（<code>IOSIPAD</code> / <code>ANDROIDSECONDARY</code> / <code>DESKTOPWIN</code> / <code>DESKTOPMAC</code>）</td><td><code>IOSIPAD</code>（共存 + 安定認証）</td></tr>
<tr><td><code>VYLINE_LAN_ACCESS</code></td><td>LAN内スマホ等からの接続・subdeviceペアリングの扱い。単なるbind設定ではない</td><td><code>false</code></td></tr>
<tr><td><code>VYLINE_TRUST_REMOTE_OWNER</code></td><td>リモートブラウザをownerとして信頼（到達経路が保護されている場合のみ）</td><td><code>false</code></td></tr>
<tr><td><code>VYLINE_PUBLIC_HOST</code></td><td>外部公開URLやsubdeviceで使う公開ホスト名</td><td>未設定（自動検出）</td></tr>
<tr><td><code>VYLINE_CORS_ORIGIN</code></td><td>CORS許可オリジン（カンマ区切りで複数可）</td><td><code>http://localhost:5173</code></td></tr>
<tr><td><code>VYLINE_STATIC_DIR</code></td><td>配信するフロントエンドビルドの場所</td><td>dev: <code>Vyline/apps/desktop/dist</code></td></tr>
<tr><td><code>TZ</code></td><td>コンテナ内タイムゾーン</td><td>Compose: <code>Asia/Tokyo</code></td></tr>
</tbody></table>
<h2 id="dirs">ディレクトリ系</h2>
<p>以下は「どこに何を置くか」を変える変数です。既定値は実装（<code>Vyline/backend/src/storage/</code> ほか）の値を記載します。</p>
<table><thead><tr><th>変数</th><th>内容</th><th>既定値</th></tr></thead><tbody>
	<tr><td><code>VYLINE_CACHE_DIR</code></td><td>cache root（派生パスの基準。envで直接変更しない）</td><td><code>storage/cache</code></td></tr>
<tr><td><code>VYLINE_CDN_CACHE_DIR</code></td><td>スタンプ/sticonキャッシュ</td><td><code>storage/cache/cdn-cache</code></td></tr>
<tr><td><code>VYLINE_ICON_CACHE_DIR</code></td><td>アイコンキャッシュ</td><td><code>storage/cache/icons</code></td></tr>
<tr><td><code>VYLINE_MEDIA_STORAGE_DIR</code></td><td>保存メディアの配置先（優先）</td><td>未設定時: <code>storage/saved-media</code></td></tr>
<tr><td><code>VYLINE_MEDIA_CACHE_DIR</code></td><td>旧構成のメディア配置先（MEDIA_STORAGE_DIR未設定時のみ参照）</td><td>未設定時: <code>storage/saved-media</code></td></tr>
<tr><td><code>VYLINE_SAVED_MEDIA_DIR</code></td><td>上記から解決された保存メディアの所在（読み取り専用）</td><td>—</td></tr>
<tr><td><code>VYLINE_MEDIA_INDEX_PATH</code></td><td>メディア索引SQLite</td><td><code>storage/media-index.sqlite</code></td></tr>
<tr><td><code>VYLINE_LOG_DIR</code></td><td>診断ログ・チャット詳細ログ（JSONL）</td><td><code>data/logs</code></td></tr>
<tr><td><code>VYLINE_BACKUP_DIR</code></td><td>VylineBackupスナップショット</td><td><code>data/backups</code></td></tr>
<tr><td><code>VYLINE_PLUGIN_DIR</code></td><td>pluginの配置先</td><td><code>data/plugins</code></td></tr>
<tr><td><code>VYLINE_LEGACY_MEDIA_DIR</code></td><td>旧構成メディアの移行元</td><td><code>data/media-cache</code></td></tr>
<tr><td><code>VYLINE_MEDIA_STORAGE_MAX_OBJECT_BYTES</code></td><td>保存メディア1件の上限</td><td>実装既定</td></tr>
<tr><td><code>VYLINE_MEDIA_STORAGE_MIN_FREE_BYTES</code></td><td>保存時の空き容量確保</td><td>実装既定</td></tr>
</tbody></table>
<h2 id="tuning">調整・上級向け</h2>
<table><thead><tr><th>変数</th><th>内容</th><th>既定値</th></tr></thead><tbody>
<tr><td><code>VYLINE_API_ADMIN_SECRET</code></td><td>管理API（例: token操作）の認証。未設定なら管理APIは無効</td><td>未設定</td></tr>
<tr><td><code>VYLINE_OPENAPI_PATH</code></td><td>OpenAPIドキュメント配信パス</td><td>実装既定</td></tr>
<tr><td><code>VYLINE_MAX_REQUEST_BODY_BYTES</code></td><td>HTTP body上限</td><td>実装既定</td></tr>
<tr><td><code>VYLINE_SQLITE_BUSY_TIMEOUT_MS</code></td><td>SQLiteロック待ち</td><td>実装既定</td></tr>
<tr><td><code>VYLINE_SQLITE_CACHE_KIB</code></td><td>SQLiteページキャッシュ</td><td><code>4096</code>（1024–65536で制限）</td></tr>
<tr><td><code>VYLINE_BACKUP_MIN_FREE_BYTES</code></td><td>バックアップ時の空き容量下限</td><td>実装既定</td></tr>
<tr><td><code>VYLINE_BACKUP_HEAVY_MAX_ITEMS</code> / <code>..._MAX_RESERVED_BYTES</code></td><td>大規模バックアップ/復元の上限（アカウント単位は <code>_PER_ACCOUNT</code> 接尾）</td><td>実装既定</td></tr>
<tr><td><code>VYLINE_DPAPI_INPUT</code></td><td>Windows向け: DPAPIで保護された入力の利用</td><td>未設定</td></tr>
<tr><td><code>VYLINE_DISABLE_WATCH</code></td><td>ファイル監視系処理の無効化</td><td><code>0</code></td></tr>
<tr><td><code>VYLINE_BUILD_NUMBER</code></td><td>表示用ビルド番号の上書き</td><td>未設定</td></tr>
</tbody></table>
<div class="callout info"><strong>この表の正本</strong><p>環境変数の正本はリポジトリの <code>.env.example</code> と <code>Vyline/backend/src</code> の各実装です。テスト専用の <code>VYLINE_*_TEST_*</code> やRPCタイムアウト（<code>VYLINE_CONTACT_RPC_TIMEOUT_MS</code> 等の <code>*_TIMEOUT_MS</code> 群）はこの表では省略します。変更はコンテナのrecreate後に反映されます。</p></div>
''','environment variables config compose env reference')

page('submodules','Submodules & Source Map','Git submoduleとモノレポworkspaceの役割、仕様の読み分け方。','開発',r'''
<h2 id="list">Git submodule（4つ）</h2>
<p>外部リポジトリを参照するのは次の4つです。いずれも <code>git clone --recurse-submodules</code> で取得できます。</p>
<table><thead><tr><th>Path</th><th>Repository</th><th>責務</th></tr></thead><tbody>
<tr><td><code>Vyline/packages/protocol</code></td><td>tqmane/vyline-api</td><td>LINE protocol, login, E2EE, RPC, domain facade</td></tr>
<tr><td><code>Vyline/packages/plugin</code></td><td>tqmane/vyline-plugin</td><td>plugin SDK / examples / permission model</td></tr>
<tr><td><code>Vyline/packages/themes</code></td><td>tqmane/vyline-theme</td><td>VyTheme型とpreset</td></tr>
<tr><td><code>tools</code></td><td>tqmane/vyline-search</td><td>Desktop LINE version追跡、unpack、xref、decompile補助</td></tr>
</tbody></table>
<div class="callout info"><strong>サブモジュールとworkspaceの区別</strong><p><code>Vyline/packages/</code> 配下は全部がサブモジュールというわけではなく、<code>line-types</code>（Thrift型のvendored定義）、<code>types</code> / <code>loose-types</code>、<code>cli</code> / <code>vyl</code> / <code>create-plugin</code>、<code>ios-backup</code> など、モノレポ本体で管理するworkspace packageも並んでいます。「4 submodules」という表現は外部リポジトリを指すものだけを数えたものです。</p></div>
<h2 id="protocol">Protocol</h2>
<p>通信仕様を調べるなら最優先。公開APIは <code>src/index.ts</code>、機能→調査地図は <code>src/modules.map.ts</code>、login/E2EE/desktop updater/domain facadeを持ちます。Backendはworkspace経由で利用します。</p>
<h2 id="plugin">Plugin</h2>
<p><code>@vyline/plugin-sdk</code> は <code>definePlugin</code> と型を提供します。README例だけでなく、SDKの現行型とBackend runtime実装を合わせて確認してください。permission文字列が存在することと、すべてのcapabilityがruntimeで実装済みであることは同義ではありません。</p>
<h2 id="themes">Themes</h2>
<p><code>THEME_PRESETS</code> と <code>VyTheme</code> 型を提供。色だけでなくsurface/sidebar/message/radius/chat background/pattern等をtokenとして一式持ちます。</p>
<h2 id="tools">Tools</h2>
<p>Desktop LINEの更新でProtocol仮定が壊れた時の調査支援です。version check/update、Themida unpack、文字列+xref、Ghidra decompileなどを行います。教育・研究用途の免責を守り、取得物や秘密情報を再配布しないでください。</p>
<h2 id="clone">Clone</h2>
<pre><code class="language-bash">git clone --recurse-submodules https://github.com/tqmane/vyline.git
cd vyline
git submodule status</code></pre>
<p>既存cloneで空なら:</p>
<pre><code class="language-bash">git submodule update --init --recursive</code></pre>
''','git submodule protocol plugin themes tools source map')

page('developer','Developer Guide','モノレポ+サブモジュール環境のセットアップ、検証、Docs更新。','開発',r'''
<h2 id="setup">Setup</h2>
<pre><code class="language-bash">git clone --recurse-submodules https://github.com/tqmane/vyline.git
cd vyline
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build</code></pre>
<p>Bun 1.4+。workspaceは <code>Vyline/packages/*</code>、desktop app、backend等を含み、Protocol/Plugin/Themesはsubmoduleです。</p>
<h2 id="where">変更箇所の見つけ方</h2>
<table><thead><tr><th>変更したいもの</th><th>まず見る場所</th></tr></thead><tbody>
<tr><td>Web UI</td><td><code>Vyline/apps/desktop</code></td></tr>
<tr><td>HTTP API / DB / restore</td><td><code>Vyline/backend</code></td></tr>
<tr><td>LINE RPC / E2EE / login</td><td><code>Vyline/packages/protocol</code></td></tr>
<tr><td>Plugin contract</td><td><code>Vyline/packages/plugin</code> + Backend plugin runtime</td></tr>
<tr><td>Theme preset</td><td><code>Vyline/packages/themes</code></td></tr>
<tr><td>Desktop LINE reverse research</td><td><code>tools</code></td></tr>
</tbody></table>
<h2 id="protocol-change">Protocol変更</h2>
<p>まずmodules mapへfeatureと関連ファイル/検索文字列を記録し、小さなmoduleに実装、<code>src/index.ts</code> から明示exportします。Desktop更新起因ならdelta/report toolsで影響範囲を先に絞ります。</p>
<h2 id="docs">Docsサイト更新</h2>
<p>サイトの正本は <code>scripts/build-web-docs.py</code> です。実行すると <code>web/</code> 配下の静的サイト（ランディング + ドキュメント + 検索索引）を再生成します。<code>web/site-src/build.py</code> は同じスクリプトを呼ぶだけのエントリポイントで、依存はPython標準ライブラリのみです（pandoc不要）。</p>
<pre><code class="language-bash">python3 scripts/build-web-docs.py</code></pre>
<p><code>web/</code> は生成物です。直接手編集した変更は次の再生成で失われます。</p>
<h2 id="readme">README</h2>
<p><code>README.md</code> は生成物です。<code>README.src.md</code> を編集して <code>bun run docs:readme</code> を使います。</p>
''','developer bun monorepo source setup')

page('plugins-themes','Plugins & Themes','Plugin SDKとテーマpresetの現行構造・拡張ポイント。','開発',r'''
<h2 id="plugin">Plugin SDK</h2>
<pre><code class="language-ts">import { definePlugin } from "@vyline/plugin-sdk";

export default definePlugin({
  id: "my-plugin",
  name: "My Plugin",
  version: "0.1.0",
  permissions: ["messages:read"],
  activate(ctx) {
    ctx.messages.on("message", (message) =&gt; {
      ctx.logger.info(`received: ${message.id}`);
    });
  },
  deactivate() {},
});</code></pre>
<p>plugin folderとmanifestをBackendのplugin data directoryへ配置し、設定/APIから有効化します。クラッシュ隔離、account scope、明示permissionが設計上の要点です。</p>
<div class="callout warning"><strong>型とRuntimeを両方確認</strong><p>READMEのsampleが古くなることがあります。新しいplugin機能を書く際はSDK型、Backend plugin manager、実際にctxへinjectされるcapabilityを同時に確認してください。</p></div>
<h2 id="themes">Themes</h2>
<p>Themeは単なるaccent colorではありません。代表token:</p>
<pre><code>id, name, accent, accentContrast,
bg, surface, surface2, sidebar,
text, textDim, border,
msgIn, msgOut, msgInText, msgOutText,
radius, chatBg, pattern</code></pre>
<p>presetは <code>THEME_PRESETS</code> に追加し、本体はpackageから読み込みます。theme packageを分離しているため、コア機能変更なしで見た目を増やせます。</p>
''','plugin theme sdk vytheme')

page('troubleshooting','Troubleshooting','症状から原因候補と切り分け順へ進む実践トラブルシューティング。','リファレンス',r'''
<h2 id="start">最初の4コマンド</h2>
<pre><code class="language-bash">docker compose ps
docker compose logs --tail=200
docker inspect vyline
df -hT</code></pre>
<h2 id="restore-disappears">復元履歴がreload後に消える</h2>
<p><strong>優先:</strong> <code>/app/data</code> bind mountとwrite permission。Protocolを疑う前に永続化を確認。</p>
<pre><code class="language-bash">docker inspect vyline
docker logs vyline
du -sh data storage</code></pre>
<h2 id="capacity-zero">容量が0 B</h2>
<p>古いimageのLinux storage reporting不備の可能性。最新imageへpull + recreateし、<code>statfs</code> が対象filesystemで動くか確認。</p>
<h2 id="pi-slow">Raspberry Pi / 小型arm64ホストが極端に遅い</h2>
<p>低メモリ（1GB前後）の機種ではRAM不足→zram/swap thrashの可能性。<code>free -h</code>、<code>vmstat 1</code>、<code>docker stats</code> でswap in/outとmemoryを確認。DB側の問題と決めつけない。メモリが足りない場合は保存メディア量を減らすか、よりRAMの多いモデルへの移行を検討します。</p>
<h2 id="android-overlay">Android: overlay2 EINVAL</h2>
<p><code>/var/lib/docker</code> がAndroid F2FS上に直接ある可能性。ext4 sparse image → loop → mountへ移す。</p>
<h2 id="android-remount">Android: runc remount / invalid argument</h2>
<p>chroot rootfsがself-bind mount/rslaveになっているか確認。</p>
<h2 id="android-internet">Android: containerからInternetへ出ない</h2>
<p><code>ip rule</code>、main route、FORWARD、MASQUERADE。Android netd policy routingを確認。</p>
<h2 id="android-port">Android: -p 3000:3000がLANからreset</h2>
<p>Docker nft publish ruleとAndroid legacy iptables pathの不一致を疑い、legacy PREROUTING DNAT + FORWARDを検証。</p>
<h2 id="exec">Android: docker execで/appが無い</h2>
<pre><code class="language-bash">PID=$(docker inspect -f '{{.State.Pid}}' vyline)
ls -la /proc/$PID/root/app</code></pre>
<p>コンテナPID rootが正常なら <code>docker exec</code> のnamespaceだけ壊れている可能性があります。</p>
<h2 id="external">外部からログイン/復元が変</h2>
<p><code>VYLINE_LAN_ACCESS</code> / <code>VYLINE_TRUST_REMOTE_OWNER</code> とreverse proxy経路を確認。LAN accessを「外から開くためのbind設定」と誤解しない。</p>
''','errors troubleshooting restore android pi storage network')

page('index-a-z','A–Z Index','用語・設定・機能から関連ページへ飛べる索引。','リファレンス',r'''
<h2 id="a">A</h2><dl><dt>Android Docker</dt><dd><a href="../android/">Android</a> / <a href="../android-kernel/">Kernel</a> / <a href="../android-network/">Network</a></dd><dt>App data</dt><dd><a href="../persistence/">Persistence</a></dd></dl>
<h2 id="b">B</h2><dl><dt>Backup</dt><dd><a href="../updates-backups/">更新とバックアップ</a></dd><dt>Bind mount</dt><dd><a href="../persistence/">Persistence</a></dd></dl>
<h2 id="c">C</h2><dl><dt>cgroup</dt><dd><a href="../android-kernel/">Android Kernel</a></dd><dt>Cloudflare Tunnel</dt><dd><a href="../remote-access/">外部アクセス</a></dd></dl>
<h2 id="d">D</h2><dl><dt>Device mode</dt><dd><a href="../protocol/">Protocol</a></dd><dt>Docker Compose</dt><dd><a href="../quick-start/">Quick Start</a> / <a href="../configuration/">Configuration</a></dd></dl>
<h2 id="e">E</h2><dl><dt>E2EE</dt><dd><a href="../protocol/">LINE Protocol & E2EE</a></dd><dt>ext4 loop image</dt><dd><a href="../android/">Android</a></dd><dt>Environment variables</dt><dd><a href="../configuration/">Configuration Reference</a></dd></dl>
<h2 id="f">F</h2><dl><dt>F2FS</dt><dd><a href="../android/">Android</a></dd><dt>firewalld</dt><dd><a href="../linux/">Linux</a></dd></dl>
<h2 id="g">G</h2><dl><dt>GHCR</dt><dd><a href="../quick-start/">Quick Start</a></dd></dl>
<h2 id="i">I</h2><dl><dt>iptables</dt><dd><a href="../android-network/">Android Network</a></dd></dl>
<h2 id="l">L</h2><dl><dt>LAN access</dt><dd><a href="../access-model/">Access Model</a></dd><dt>Linux distributions</dt><dd><a href="../linux/">Linux</a></dd></dl>
<h2 id="p">P</h2><dl><dt>Plugin SDK</dt><dd><a href="../plugins-themes/">Plugins & Themes</a></dd><dt>Portainer</dt><dd><a href="../portainer/">Portainer</a></dd><dt>Protocol</dt><dd><a href="../protocol/">LINE Protocol & E2EE</a></dd></dl>
<h2 id="r">R</h2><dl><dt>Raspberry Pi</dt><dd><a href="../raspberry-pi/">Raspberry Pi</a></dd><dt>Restore</dt><dd><a href="../persistence/">Persistence</a> / <a href="../troubleshooting/">Troubleshooting</a></dd></dl>
<h2 id="s">S</h2><dl><dt>SELinux</dt><dd><a href="../android-kernel/">Android Kernel</a> / <a href="../linux/">Linux</a></dd><dt>Storage</dt><dd><a href="../persistence/">Persistence</a></dd><dt>Submodules</dt><dd><a href="../submodules/">Submodules</a></dd></dl>
<h2 id="t">T</h2><dl><dt>Termux</dt><dd><a href="../android/">Android</a></dd><dt>Themes</dt><dd><a href="../plugins-themes/">Plugins & Themes</a></dd><dt>Troubleshooting</dt><dd><a href="../troubleshooting/">Troubleshooting</a></dd></dl>
<h2 id="v">V</h2><dl><dt>VYLINE_DEVICE</dt><dd><a href="../protocol/">Protocol</a></dd><dt>VYLINE_LAN_ACCESS</dt><dd><a href="../access-model/">Access Model</a></dd><dt>VYLINE_* 全変数</dt><dd><a href="../configuration/">Configuration Reference</a></dd></dl>
<h2 id="w">W</h2><dl><dt>WireGuard</dt><dd><a href="../remote-access/">外部アクセス</a></dd></dl>
''','index glossary a-z')

# Detailed Android source page imported from provided user guide as escaped text snippets/sections.
android_guide=((ROOT/'docs'/'Vyline-Android-Docker-Complete-Guide-ja.md').read_text(encoding='utf-8') if (ROOT/'docs'/'Vyline-Android-Docker-Complete-Guide-ja.md').exists() else '')
# copy as source artifact under repository docs
if android_guide:
    (ROOT/'docs'/'Vyline-Android-Docker-Complete-Guide-ja.md').write_text(android_guide,encoding='utf-8')
    full_html=md_to_html(android_guide)
    page('android-complete','Android 完全構築ガイド','root済みAndroidを実用的なVyline Dockerホストへ仕上げる、カーネルからネットワークまでの完全版。','インストール',full_html,'android complete guide termux kernel docker network troubleshooting')

nav_groups=[]
for g in ['はじめに','インストール','運用','仕組み','開発','リファレンス']:
    items=[p for p in pages if p['group']==g]
    if items: nav_groups.append((g,items))

# Build data JSON so future edits are inspectable.
(SRC/'content.json').write_text(json.dumps([{k:v for k,v in p.items() if k!='body'} for p in pages],ensure_ascii=False,indent=2),encoding='utf-8')

ASSETS=WEB/'assets'; ASSETS.mkdir(exist_ok=True)
css=r'''
:root{--bg:#fff;--surface:#f7f7f8;--surface2:#f0f1f3;--text:#17181a;--muted:#60646c;--border:#e2e3e7;--accent:#0a7cff;--accent2:#00b7ff;--sidebar:280px;--toc:220px;--header:64px;--radius:10px;color-scheme:light dark;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
[data-theme=dark]{--bg:#101113;--surface:#15171a;--surface2:#1d2024;--text:#f5f6f7;--muted:#a4a8b0;--border:#2b2f35;--accent:#58a6ff;--accent2:#4bd2ff}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:84px}body{margin:0;background:var(--bg);color:var(--text);font-size:16px;line-height:1.72}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}button,input{font:inherit}.skip{position:absolute;left:-9999px}.skip:focus{left:12px;top:12px;z-index:999;background:var(--bg);padding:8px 12px;border:1px solid var(--border)}
.docs-header{position:sticky;top:0;height:var(--header);z-index:50;display:flex;align-items:center;gap:18px;padding:0 20px;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:760;letter-spacing:-.02em;white-space:nowrap}.brand:hover{text-decoration:none}.brand-mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(145deg,#00d47b,#00a9ff);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}.docs-badge{font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted)}.search-btn{margin-left:auto;display:flex;align-items:center;gap:12px;width:min(390px,34vw);padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--muted);cursor:pointer;text-align:left}.kbd{margin-left:auto;border:1px solid var(--border);border-bottom-width:2px;border-radius:5px;padding:0 6px;font-size:11px}.icon-btn{border:0;background:transparent;color:var(--muted);cursor:pointer;padding:8px;border-radius:7px}.icon-btn:hover{background:var(--surface2);color:var(--text)}.menu-btn{display:none}
.docs-layout{display:grid;grid-template-columns:var(--sidebar) minmax(0,780px) var(--toc);gap:42px;max-width:1360px;margin:0 auto;padding:0 24px}.sidebar{position:sticky;top:var(--header);height:calc(100vh - var(--header));overflow:auto;padding:28px 10px 60px 0}.nav-group{margin:0 0 24px}.nav-title{font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px 12px}.nav-link{display:block;color:var(--muted);font-size:14px;padding:6px 12px;border-radius:7px}.nav-link:hover{background:var(--surface);color:var(--text);text-decoration:none}.nav-link.active{background:var(--surface2);color:var(--text);font-weight:650}.content{padding:54px 0 100px;min-width:0}.breadcrumbs{font-size:13px;color:var(--muted);margin-bottom:12px}.content h1{font-size:40px;line-height:1.15;letter-spacing:-.035em;margin:0 0 12px}.lead{font-size:18px;color:var(--muted);margin:0 0 38px;max-width:700px}.content h2{font-size:25px;line-height:1.25;letter-spacing:-.02em;margin:52px 0 16px;padding-top:4px}.content h3{font-size:19px;margin:30px 0 10px}.content h2 a.anchor,.content h3 a.anchor{opacity:0;color:var(--muted);margin-left:8px;font-weight:400}.content h2:hover a.anchor,.content h3:hover a.anchor{opacity:1}.content p{margin:0 0 16px}.content ul,.content ol{padding-left:24px}.content li{margin:5px 0}.content code{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:.89em;background:var(--surface2);padding:.14em .35em;border-radius:4px}.content pre{position:relative;overflow:auto;background:#0d1117;color:#e6edf3;border:1px solid #272b33;border-radius:9px;padding:18px 20px;margin:18px 0 24px;line-height:1.55}.content pre code{background:none;color:inherit;padding:0;font-size:13px}.copy{position:absolute;right:8px;top:8px;border:1px solid #30363d;background:#161b22;color:#aeb6c2;padding:4px 8px;border-radius:6px;font-size:12px;cursor:pointer}.copy:hover{color:#fff}.content table{width:100%;border-collapse:collapse;margin:18px 0 28px;font-size:14px}.content th,.content td{border-bottom:1px solid var(--border);padding:10px 12px;text-align:left;vertical-align:top}.content th{background:var(--surface);font-weight:700}.callout{border-left:3px solid var(--accent);background:var(--surface);padding:14px 16px;margin:20px 0;border-radius:0 8px 8px 0}.callout strong{display:block;margin-bottom:4px}.callout p{margin:0;color:var(--muted)}.callout.warning{border-left-color:#e3a008}.callout.danger{border-left-color:#e5484d}.cards{display:grid;gap:12px;margin:20px 0 30px}.cards.three{grid-template-columns:repeat(3,1fr)}.card{display:block;padding:18px;border:1px solid var(--border);border-radius:10px;color:var(--text);background:var(--bg)}.card:hover{text-decoration:none;border-color:color-mix(in srgb,var(--accent) 45%,var(--border));background:var(--surface)}.card h3{margin:6px 0 6px}.card p{margin:0;color:var(--muted);font-size:14px}.eyebrow{font-size:10px;letter-spacing:.1em;font-weight:800;color:var(--accent)}.toc{position:sticky;top:var(--header);height:calc(100vh - var(--header));padding:32px 0;overflow:auto}.toc-title{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px}.toc a{display:block;font-size:12px;color:var(--muted);padding:4px 0 4px 10px;border-left:1px solid var(--border)}.toc a.active{color:var(--text);border-left:2px solid var(--accent)}.page-nav{display:flex;gap:12px;margin-top:64px;padding-top:24px;border-top:1px solid var(--border)}.page-nav a{flex:1;border:1px solid var(--border);padding:13px 15px;border-radius:8px;color:var(--text)}.page-nav a:hover{background:var(--surface);text-decoration:none}.page-nav .next{text-align:right}.page-nav small{display:block;color:var(--muted)}dl{display:grid;grid-template-columns:160px 1fr;border-top:1px solid var(--border)}dt,dd{margin:0;padding:10px;border-bottom:1px solid var(--border)}dt{font-weight:700}
.search-modal{border:1px solid var(--border);border-radius:12px;width:min(680px,92vw);padding:0;background:var(--bg);color:var(--text);box-shadow:0 24px 80px rgba(0,0,0,.28)}.search-modal::backdrop{background:rgba(0,0,0,.45)}.search-top{padding:12px;border-bottom:1px solid var(--border)}.search-input{width:100%;border:0;outline:0;background:transparent;color:var(--text);font-size:17px;padding:7px}.results{max-height:55vh;overflow:auto;padding:8px}.result{display:block;color:var(--text);padding:11px 12px;border-radius:8px}.result:hover,.result.sel{background:var(--surface);text-decoration:none}.result b{display:block}.result span{font-size:13px;color:var(--muted)}.search-empty{padding:24px;text-align:center;color:var(--muted)}
/* Landing only */.landing{min-height:100vh;background:#07110d;color:#f3fff8;overflow:hidden}.landing a{color:inherit}.lp-nav{height:74px;display:flex;align-items:center;max-width:1180px;margin:auto;padding:0 24px;position:relative;z-index:5}.lp-nav .spacer{flex:1}.lp-nav a{margin-left:24px;font-size:14px;color:#cce4d7}.lp-nav .cta{padding:10px 15px;border:1px solid #3a6651;border-radius:8px;background:#102219}.lp-badge{font-size:11px;padding:2px 8px;border:1px solid #2f4f40;border-radius:999px;color:#67f6b6;margin-left:8px;letter-spacing:.02em;font-weight:600}.hero{position:relative;max-width:1180px;margin:0 auto;padding:92px 24px 108px}.hero:before{content:"";position:absolute;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,rgba(0,235,141,.18),rgba(0,168,255,.08) 42%,transparent 68%);top:-260px;right:-220px;filter:blur(10px);pointer-events:none}.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:72px;align-items:center}.hero h1{font-size:clamp(58px,8vw,108px);line-height:.88;letter-spacing:-.065em;margin:18px 0 28px;max-width:820px}.hero .kicker{font-size:13px;letter-spacing:.14em;color:#67f6b6;font-weight:800}.hero .sub{font-size:20px;line-height:1.65;color:#bcd3c6;max-width:680px}.hero-actions{display:flex;gap:12px;margin-top:32px}.hero-actions a{padding:13px 18px;border-radius:8px;border:1px solid #315446;text-decoration:none;font-weight:650}.hero-actions .primary{background:#e9fff4;color:#06140d;border-color:#e9fff4}.terminal{background:#0b0f0d;border:1px solid #294036;border-radius:12px;box-shadow:0 36px 80px rgba(0,0,0,.35);overflow:hidden}.term-head{height:40px;border-bottom:1px solid #24342d;display:flex;align-items:center;gap:7px;padding:0 13px}.term-title{margin-left:8px;font-size:12px;color:#5d7c6c}.dot{width:9px;height:9px;border-radius:50%;background:#456354}.term-body{padding:22px;font:13px/1.9 "SFMono-Regular",Consolas,monospace;color:#cfe7da}.term-body .green{color:#55e6a6}.term-muted{color:#5d7c6c;margin-top:8px}.hero-note{margin-top:14px;font-size:13.5px;color:#7da08f}.lp-docs{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#214033;border:1px solid #214033;margin-top:46px}.lp-docs a{background:#0a1812;padding:22px 24px;display:block;color:#e4f4ec;font-size:15px}.lp-docs a:hover{background:#0e2419;text-decoration:none}.lp-docs span{display:block;color:#85a697;font-size:13px;font-weight:400;margin-top:6px}.lp-strip{border-top:1px solid #173126;border-bottom:1px solid #173126;background:#091710}.strip-inner{max-width:1180px;margin:auto;display:grid;grid-template-columns:repeat(4,1fr)}.stat{padding:24px;border-right:1px solid #173126}.stat:last-child{border-right:0}.stat strong{display:block;font-size:22px}.stat span{color:#85a697;font-size:12px}.lp-section{max-width:1180px;margin:auto;padding:100px 24px}.lp-section h2{font-size:48px;line-height:1.05;letter-spacing:-.04em;max-width:720px}.lp-section .intro{font-size:18px;color:#9ebaae;max-width:720px}.feature-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#214033;border:1px solid #214033;margin-top:46px}.feature{background:#0a1812;padding:28px}.feature small{color:#58e8a7}.feature h3{font-size:23px;margin:18px 0 9px}.feature p{color:#91ad9f}.arch-flow{font:14px/2 "SFMono-Regular",Consolas,monospace;color:#b8d7c7;border-top:1px solid #204234;border-bottom:1px solid #204234;padding:28px 0;white-space:pre-wrap}.lp-footer{border-top:1px solid #173126;padding:34px 24px;color:#7d9d8d;text-align:center;font-size:13px}
@media(max-width:1080px){.docs-layout{grid-template-columns:240px minmax(0,1fr);gap:28px}.toc{display:none}.hero-grid{grid-template-columns:1fr}.terminal{max-width:720px}.feature-grid{grid-template-columns:1fr 1fr}.lp-docs{grid-template-columns:1fr 1fr}}
@media(max-width:760px){.docs-header{padding:0 12px}.menu-btn{display:block}.search-btn{width:auto;flex:1}.search-btn .search-label{display:none}.docs-layout{display:block;padding:0 18px}.sidebar{display:none;position:fixed;z-index:45;left:0;top:var(--header);bottom:0;width:min(86vw,310px);height:auto;background:var(--bg);border-right:1px solid var(--border);padding:22px;box-shadow:20px 0 50px rgba(0,0,0,.14)}.sidebar.open{display:block}.content{padding-top:34px}.content h1{font-size:34px}.lead{font-size:16px}.cards.three{grid-template-columns:1fr}.page-nav{flex-direction:column}.lp-nav a:not(.cta){display:none}.hero{padding-top:58px}.hero h1{font-size:60px}.hero .sub{font-size:17px}.hero-actions{flex-direction:column;align-items:flex-start}.strip-inner{grid-template-columns:1fr 1fr}.stat:nth-child(2){border-right:0}.feature-grid{grid-template-columns:1fr}.lp-docs{grid-template-columns:1fr}.lp-section{padding:72px 20px}.lp-section h2{font-size:38px}dl{grid-template-columns:1fr}dd{padding-top:0;color:var(--muted)}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
'''
(ASSETS/'site.css').write_text(css,encoding='utf-8')

# Search index all pages with stripped content
strip=lambda s: re.sub(r'\s+',' ',re.sub('<[^>]+>',' ',s)).strip()
search=[dict(title=p['title'],url=('/docs/' + (p['slug']+'/' if p['slug'] else '')),desc=p['desc'],text=(p['keywords']+' '+strip(p['body']))[:12000]) for p in pages]
js=r'''
(()=>{const root=document.documentElement;const saved=localStorage.getItem('vy-theme');if(saved)root.dataset.theme=saved;else if(matchMedia('(prefers-color-scheme:dark)').matches)root.dataset.theme='dark';
const theme=document.querySelector('[data-theme-toggle]');theme?.addEventListener('click',()=>{const n=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=n;localStorage.setItem('vy-theme',n)});
const menu=document.querySelector('[data-menu]'),sidebar=document.querySelector('.sidebar');menu?.addEventListener('click',()=>sidebar?.classList.toggle('open'));
document.querySelectorAll('pre').forEach(pre=>{const b=document.createElement('button');b.className='copy';b.textContent='Copy';b.addEventListener('click',async()=>{await navigator.clipboard.writeText(pre.innerText.replace(/^Copy\n?/,''));b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1200)});pre.appendChild(b)});
document.querySelectorAll('.content h2[id],.content h3[id]').forEach(h=>{const a=document.createElement('a');a.href='#'+h.id;a.className='anchor';a.setAttribute('aria-label','この見出しへのリンク');a.textContent='#';h.appendChild(a)});
const tocLinks=[...document.querySelectorAll('.toc a')];if(tocLinks.length){const obs=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){tocLinks.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id))}})},{rootMargin:'-80px 0px -70% 0px'});document.querySelectorAll('.content h2[id]').forEach(h=>obs.observe(h))}
const dlg=document.querySelector('.search-modal'),inp=document.querySelector('.search-input'),res=document.querySelector('.results');let idx=[];fetch('/assets/search.json').then(r=>r.json()).then(x=>idx=x).catch(()=>{});function open(){dlg?.showModal();setTimeout(()=>inp?.focus(),0)};document.querySelector('[data-search]')?.addEventListener('click',open);addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open()}if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();open()}});inp?.addEventListener('input',()=>{const q=inp.value.trim().toLowerCase();if(!q){res.innerHTML='<div class="search-empty">ページ名・設定名・エラー名で検索</div>';return}const terms=q.split(/\s+/);const rows=idx.map(x=>{const hay=(x.title+' '+x.desc+' '+x.text).toLowerCase();const score=terms.reduce((s,t)=>s+(x.title.toLowerCase().includes(t)?8:0)+(x.desc.toLowerCase().includes(t)?4:0)+(hay.includes(t)?1:0),0);return [score,x]}).filter(x=>x[0]>=terms.length).sort((a,b)=>b[0]-a[0]).slice(0,12);res.innerHTML=rows.length?rows.map(([,x])=>`<a class="result" href="${x.url}"><b>${x.title}</b><span>${x.desc}</span></a>`).join(''):'<div class="search-empty">一致するページがありません</div>'});
})();
'''
(ASSETS/'site.js').write_text(js,encoding='utf-8')
(ASSETS/'search.json').write_text(json.dumps(search,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

# Source build script simply reruns top-level copy; embed a self-contained pointer rather than duplicating generator.
(SRC/'build.py').write_text('''#!/usr/bin/env python3\n# The generated site in this bundle is intentionally dependency-free.\n# This file is a stable regeneration entrypoint; full page source metadata lives in content.json.\n# For a full rebuild from repository docs, run scripts/build-web-docs.py at repository root.\nfrom pathlib import Path\nimport subprocess, sys\nroot=Path(__file__).resolve().parents[2]\nscript=root/'scripts'/'build-web-docs.py'\nif not script.exists():\n    raise SystemExit(f"missing {script}")\nraise SystemExit(subprocess.call([sys.executable,str(script)]))\n''',encoding='utf-8')

# templating

def nav_for_group(g, items):
    links=[]
    for item in items:
        key=item['slug'] or 'home'
        href='/docs/' + ((item['slug'] + '/') if item['slug'] else '')
        links.append(f'<a class="nav-link {{active_{key}}}" href="{href}">{escape(item["title"])}</a>')
    return f'<div class="nav-group"><div class="nav-title">{escape(g)}</div>' + ''.join(links) + '</div>'
nav_html=''.join(nav_for_group(g,items) for g,items in nav_groups)

def toc(body):
    out=[]
    for m in re.finditer(r'<h2 id="([^"]+)">([^<]+)</h2>',body):out.append((m.group(1),m.group(2)))
    return ''.join(f'<a href="#{escape(i)}">{escape(t)}</a>' for i,t in out)

def docs_html(p,i):
    nav=nav_html
    for q in pages: nav=nav.replace('{active_'+(q['slug'] or 'home')+'}', 'active' if q is p else '')
    prev=pages[i-1] if i>0 else None; nxt=pages[i+1] if i+1<len(pages) else None
    navprev=(f'<a href="/docs/{prev["slug"]+"/" if prev["slug"] else ""}"><small>← 前へ</small>{escape(prev["title"])}</a>' if prev else '<span></span>')
    navnext=(f'<a class="next" href="/docs/{nxt["slug"]+"/" if nxt["slug"] else ""}"><small>次へ →</small>{escape(nxt["title"])}</a>' if nxt else '<span></span>')
    return f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="{escape(p['desc'])}"><title>{escape(p['title'])} · Vyline Docs</title><link rel="stylesheet" href="/assets/site.css"><script defer src="/assets/site.js"></script></head><body><a class="skip" href="#main">本文へスキップ</a><header class="docs-header"><button class="icon-btn menu-btn" data-menu aria-label="メニュー">☰</button><a class="brand" href="/"><span class="brand-mark"></span>Vyline <span class="docs-badge">DOCS</span></a><button class="search-btn" data-search><span>⌕</span><span class="search-label">ドキュメントを検索</span><span class="kbd">⌘K</span></button><a class="icon-btn" href="https://github.com/tqmane/vyline" aria-label="GitHub">↗</a><button class="icon-btn" data-theme-toggle aria-label="テーマ切替">◐</button></header><div class="docs-layout"><aside class="sidebar">{nav}</aside><main class="content" id="main"><div class="breadcrumbs">Docs / {escape(p['group'])}</div><h1>{escape(p['title'])}</h1><p class="lead">{escape(p['desc'])}</p>{p['body']}<nav class="page-nav">{navprev}{navnext}</nav></main><aside class="toc"><div class="toc-title">このページ</div>{toc(p['body'])}</aside></div><dialog class="search-modal"><div class="search-top"><input class="search-input" type="search" placeholder="検索..." aria-label="ドキュメント検索"></div><div class="results"><div class="search-empty">ページ名・設定名・エラー名で検索</div></div></dialog></body></html>'''

# clean docs output only (not source)
for child in DOCS.iterdir():
    if child.is_dir(): shutil.rmtree(child)
    else: child.unlink()
for i,p in enumerate(pages):
    dest=DOCS if not p['slug'] else DOCS/p['slug'];dest.mkdir(parents=True,exist_ok=True)
    (dest/'index.html').write_text(docs_html(p,i),encoding='utf-8')

version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
n_pages=len(pages)
landing=f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Vyline — セルフホストで動くLINEの非公式クライアント。トーク・履歴・メディアを自分のサーバーで管理します。"><title>Vyline — セルフホストのLINEクライアント</title><link rel="stylesheet" href="/assets/site.css"><link rel="icon" href="/assets/mark.svg" type="image/svg+xml"></head><body class="landing"><nav class="lp-nav"><a class="brand" href="/"><span class="brand-mark"></span>Vyline <span class="lp-badge">v{version}</span></a><span class="spacer"></span><a href="/docs/">Docs</a><a href="https://github.com/tqmane/vyline">GitHub ↗</a><a class="cta" href="/docs/quick-start/">Quick Start</a></nav><main><section class="hero"><div class="hero-grid"><div><p class="kicker">非公式 · セルフホスト · オープンソース (MIT)</p><h1>LINE を、<br>自分のサーバーで。</h1><p class="sub">Vyline は LINE のサードパーティクライアントです。トーク、履歴、メディア、拡張機能が、あなたの Docker コンテナの中だけで動きます。アカウントデータを預ける先は、自分で選べます。</p><div class="hero-actions"><a class="primary" href="/docs/quick-start/">Quick Start →</a><a href="/docs/architecture/">仕組みを見る</a></div><p class="hero-note">起動に必要なのは Docker Compose だけ。イメージは ghcr.io に公開済みで、ビルドやコード生成は不要です。</p></div><div class="terminal" aria-label="起動コマンドの例"><div class="term-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="term-title">~/vyline</span></div><div class="term-body"><div><span class="green">$</span> curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml</div><div><span class="green">$</span> docker compose up -d</div><div><span class="green">$</span> docker compose logs -f --tail=100</div><div class="term-muted"># あとはブラウザで http://&lt;host&gt;:3000 を開くだけ</div></div></div></div></section><section class="lp-strip"><div class="strip-inner"><div class="stat"><strong>v{version}</strong><span>現在のリリース</span></div><div class="stat"><strong>amd64 + arm64</strong><span>GHCR マルチアーキテクチャ</span></div><div class="stat"><strong>{n_pages} ページ</strong><span>Docs / Wiki</span></div><div class="stat"><strong>4 submodules</strong><span>protocol · plugin · themes · tools</span></div></div></section><section class="lp-section"><p class="kicker">ONE STACK, MANY LAYERS</p><h2>機能ではなく、責務で分ける。</h2><p class="intro">UI から LINE サーバーまで、潰すべき範囲が層ごとに決まっています。Desktop 版 LINE の仕様変更で壊れるのは、原則 protocol 層だけです。</p><div class="feature-grid"><div class="feature"><small>01 · PROTOCOL</small><h3>LINE 通信を独立パッケージへ</h3><p>login（QR / Email / Token）、transport、E2EE、Talk を <code>@vyline/protocol</code> に分離。Desktop 互換ヘッダは実機から抽出したプロファイルで構成します。</p></div><div class="feature"><small>02 · PERSISTENCE</small><h3>データをコンテナの外へ</h3><p>状態は <code>/app/data</code>、キャッシュと保存メディアは <code>/app/storage</code> に永続化します。コンテナを再作成しても、ログイン状態と履歴は残ります。</p></div><div class="feature"><small>03 · EXTENSIBILITY</small><h3>Plugin と Themes</h3><p>権限宣言付きの Plugin SDK と VyTheme preset。コアを直接変更しなくても、機能と見た目を増やせます。</p></div><div class="feature"><small>04 · DESKTOP TRACKING</small><h3>Desktop 更新を追跡</h3><p>公式 Desktop の version 追跡、Themida unpack、xref、decompile 補助を <code>tools</code> に集約し、protocol の前提が崩れる兆候を早期に検出します。</p></div></div></section><section class="lp-section" id="architecture"><p class="kicker">ARCHITECTURE</p><h2>Web の先に、もう一段。</h2><div class="arch-flow">Browser
  │
  ▼
Desktop UI (Vyline/apps/desktop)
  │
  ▼
Backend (Vyline/backend) ── API / DB / restore / media / plugin runtime
  │
  ▼
@vyline/protocol ── login / transport / E2EE / Talk
  │
  ▼
LINE services

+ @vyline/plugin-sdk ── 権限付き拡張
+ @vyline/themes     ── テーマ preset
+ Vyline-Search      ── Desktop 解析ツール</div><div class="hero-actions"><a class="primary" href="/docs/">Docs / Wiki を読む →</a><a href="/docs/submodules/">Submodules &amp; Source Map</a></div></section><section class="lp-section" id="docs"><p class="kicker">DOCS</p><h2>セットアップから内部設計まで。</h2><p class="intro">実装と突き合わせた Wiki を公開しています。導入、環境変数リファレンス、トラブルシューティング、Android 完全ガイドまで。</p><div class="lp-docs"><a href="/docs/quick-start/"><b>Quick Start</b><span>Docker Compose で最短起動</span></a><a href="/docs/linux/"><b>Linux</b><span>ディストリごとの導入差</span></a><a href="/docs/raspberry-pi/"><b>Raspberry Pi</b><span>Pi での常時稼働</span></a><a href="/docs/android/"><b>Android</b><span>実機を Docker ホスト化</span></a><a href="/docs/configuration/"><b>Configuration</b><span>環境変数リファレンス</span></a><a href="/docs/troubleshooting/"><b>Troubleshooting</b><span>症状から切り分ける</span></a></div></section></main><footer class="lp-footer"><p>Vyline は LINE 公式・承認済みのクライアントではありません。利用は自己責任です。</p><p>MIT License · 現在はベータ版（v{version}）</p></footer></body></html>'''
(WEB/'index.html').write_text(landing,encoding='utf-8')

# Copy favicon-ish SVG; no image generation needed.
(WEB/'assets'/'mark.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#00df87"/><stop offset="1" stop-color="#00a5ff"/></linearGradient></defs><rect width="64" height="64" rx="17" fill="url(#g)"/><path d="M16 19h10l6 17 6-17h10L36 47h-8z" fill="#06130d"/></svg>''',encoding='utf-8')

# Add a small repository-root builder wrapper retaining this generated source as executable script.
script_dir=ROOT/'scripts';script_dir.mkdir(exist_ok=True)
# Copy this script itself into repo as canonical generator, normalizing paths to repository-relative.
self_text=Path(__file__).read_text(encoding='utf-8')
# avoid embedding absolute work path in checked script; builder discovers repo root.
self_text=self_text.replace("ROOT=Path(__file__).resolve().parents[1]","ROOT=Path(__file__).resolve().parents[1]")
self_text=self_text.replace("android_guide=((ROOT/'docs'/'Vyline-Android-Docker-Complete-Guide-ja.md').read_text(encoding='utf-8') if (ROOT/'docs'/'Vyline-Android-Docker-Complete-Guide-ja.md').exists() else '')","android_guide=((ROOT/'docs'/'Vyline-Android-Docker-Complete-Guide-ja.md').read_text(encoding='utf-8') if (ROOT/'docs'/'Vyline-Android-Docker-Complete-Guide-ja.md').exists() else '')")
# prevent recursive script rewriting itself on future builds by replacing block after marker isn't trivial; it's safe (writes itself) but use temp text then same path.
(script_dir/'build-web-docs.py').write_text(self_text,encoding='utf-8')
print(f'Built {len(pages)} docs pages + landing')
