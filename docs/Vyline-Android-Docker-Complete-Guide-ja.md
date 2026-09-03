# Vyline を Android 上の Docker で動かすための完全構築ガイド

> 対象リポジトリ: https://github.com/tqmane/vyline  
> 文書作成日: 2026-09-01  
> 対象アーキテクチャ: Android / arm64 (aarch64)  
> 主な検証実績: OnePlus 9 Pro / Snapdragon 888 / カスタム Linux 5.4.254 QGKI 系カーネル / root / Termux / Ubuntu real chroot / Docker / Portainer / Vyline

---

## 0. この文書の目的

この文書は、普通の Linux サーバーではなく **Android 端末を Docker ホストとして使い、その上で Vyline を安定運用する**ために必要な要件・構築手順・Android 固有の回避策・既知の不具合・運用方法を、カーネルから Vyline の Stack 定義まで一通りまとめたものです。

単に `docker run` が実行できる状態では不十分です。Android は通常の Ubuntu / Debian サーバーと異なり、次の点が問題になります。

- Android 標準カーネルは Docker に必要な namespace / cgroup / bridge / OverlayFS 等が不足していることがある。
- Android の `/data` は F2FS + casefold 等の構成になっており、Docker の `overlay2` を直接置くと `EINVAL` になることがある。
- Android の SELinux が loop device、mount、dockerd、ネットワーク操作を止めることがある。
- Android の policy routing / netd は普通の Linux と違い、Docker bridge から外へ出る通信や published port がそのままでは通らないことがある。
- Ubuntu rootfs を単純に `chroot` しただけでは mount propagation の都合で runc/containerd が失敗することがある。
- systemd が PID 1 ではないため、普通の Linux 向け Docker / Cockpit / libvirt の説明をそのまま使えない。
- 一部の Android + chroot 環境では `docker exec` が壊れ、コンテナ本体と異なる mount namespace が見えることがある。

このガイドでは、これらを前提に **Android ホストを実用的な Vyline サーバーとして完成させる**ところまで扱います。

---

# 1. まず理解するべき全体構成

推奨構成は次です。

```text
Android arm64 device
├─ Android OS / vendor kernel
│  ├─ root (KernelSU / Magisk 等)
│  ├─ Docker に必要な kernel config
│  ├─ Android netd / policy routing
│  └─ SELinux
│
├─ Termux
│  ├─ busybox
│  ├─ proot-distro  ※ rootfs の取得だけに利用
│  ├─ openssh
│  ├─ tmux
│  └─ 起動スクリプト
│
├─ Ubuntu rootfs
│  └─ 「proot」ではなく real chroot として使用
│      ├─ dockerd
│      ├─ containerd
│      ├─ runc
│      ├─ docker compose
│      └─ Portainer (任意)
│
├─ ext4 loop image
│  └─ /var/lib/docker
│      └─ overlay2
│
└─ Docker containers
   ├─ vyline
   │  ├─ /app/data    -> 永続化
   │  └─ /app/storage -> 永続化
   └─ cloudflared     -> 外部公開する場合のみ
```

重要なのは、**Termux の proot-distro で Ubuntu を起動し続けるのではなく、rootfs だけ用意して、その後は本物の `chroot(2)` で使う**ことです。

Docker / runc は namespace、mount propagation、cgroup、device などカーネル機能を直接使うため、proot の syscall エミュレーションの上ではなく real root の chroot で動かします。

---

# 2. 検証済みリファレンス環境

以下は過去に実際に動作確認した構成です。これは「この値でなければ動かない」という意味ではなく、問題切り分け時の基準です。

```text
Device           : OnePlus 9 Pro
SoC              : Snapdragon 888 / SM8350
Architecture     : aarch64 / arm64
Kernel example   : Linux 5.4.254-qgki-tqmane-...
Root             : 有効
Ubuntu           : Ubuntu 26.04 LTS (Resolute Raccoon)
Runtime          : real chroot
Docker Engine    : 29.7.2 を動作確認
containerd       : 2.3.3 を動作確認
runc             : 1.4.3 を動作確認
Docker storage   : overlay2
Docker data-root : ext4 loop image 上の /var/lib/docker
Cgroup driver    : cgroupfs
RAM              : 約 11 GiB の端末で動作確認
CPU              : Docker から 6 CPU を認識した構成で動作確認
Termux SSH       : 8022
```

KVM は Vyline には不要です。過去の OnePlus 9 Pro では `CONFIG_KVM=y` 等を入れていても `/dev/kvm` が存在しない状態がありましたが、Docker と Vyline の動作には関係ありません。

---

# 3. Vyline リポジトリ側の現行 Docker 仕様

現在の `tqmane/vyline` は Docker 利用を前提に整備されています。

リポジトリ:

- https://github.com/tqmane/vyline

主要ファイル:

- `Dockerfile`
- `docker-entrypoint.sh`
- `docker-compose.yml`
- `docker-compose.portainer.yml`
- `.github/workflows/container.yml`

## 3.1 GHCR は arm64 対応

現行 GitHub Actions は Buildx で次を同時に生成します。

```text
linux/amd64
linux/arm64
```

したがって Android arm64 では、基本的に端末内で Vyline をビルドする必要はありません。

```bash
docker pull ghcr.io/tqmane/vyline:latest
```

で使えます。

推奨:

```text
ghcr.io/tqmane/vyline:latest
```

必要なら Compose に明示できます。

```yaml
platform: linux/arm64
```

ただし multi-arch manifest のため、通常は Docker が自動で arm64 を選択します。

## 3.2 Vyline の永続化パス

コンテナ内部では次の2つが重要です。

```text
/app/data
/app/storage
```

用途は概ね次の通りです。

```text
/app/data
├─ アカウント状態
├─ セッション / 認証関連状態
├─ chat DB
├─ 設定
├─ 復元済み履歴
└─ バックアップ関連データ

/app/storage
├─ cache
│  ├─ cdn-cache
│  └─ icons
└─ saved-media
   ├─ images
   ├─ videos
   ├─ audio
   └─ files
```

この2つを消すと、更新時に Vyline の状態を失う可能性があります。

## 3.3 現行 Docker image の権限処理

現行 image は entrypoint の最初だけ root として起動し、bind mount の所有権を `bun:bun` に修正します。

理由は、Docker image 内で `/app/data` を `bun` 所有にしても、ホストの bind mount を載せるとホスト側所有権で上書きされるためです。

過去にはここが root-owned のままになり、

```text
復元処理は成功したように見える
↓
メモリには履歴がある
↓
chat DB / settings を保存できない
↓
再読込・再起動後に復元履歴が消える
```

という問題が発生しました。

現行 `docker-entrypoint.sh` はこの問題を防ぐため、起動時に `/app/data` と `/app/storage` を `chown -R bun:bun` し、書き込み可能か確認してから unprivileged user に落とします。

---

# 4. Android カーネル要件

ここが最重要です。

Android で Docker を本当に動かすには、ユーザーランドに Docker CLI を入れるだけでは足りません。カーネルに container runtime が必要とする機能が入っている必要があります。

## 4.1 最低限チェックすべきカテゴリ

```text
1. namespaces
2. cgroups
3. seccomp
4. OverlayFS
5. bridge / veth
6. netfilter / conntrack / NAT
7. ext4
8. loop device
9. proc/sysfs/tmpfs/devpts
10. mount propagation
```

## 4.2 実機で確認済みだった主な CONFIG

過去に OnePlus 9 Pro の実 kernel image から IKCONFIG を抽出した際、以下は有効でした。

```text
CONFIG_NAMESPACES=y
CONFIG_UTS_NS=y
CONFIG_PID_NS=y
CONFIG_NET_NS=y
CONFIG_USER_NS=y

CONFIG_CGROUPS=y
CONFIG_CGROUP_CPUACCT=y
CONFIG_CGROUP_FREEZER=y
CONFIG_CGROUP_SCHED=y
CONFIG_CPUSETS=y
CONFIG_MEMCG=y
CONFIG_MEMCG_SWAP=y
CONFIG_MEMCG_SWAP_ENABLED=y
CONFIG_CGROUP_BPF=y

CONFIG_BPF_SYSCALL=y
CONFIG_SECCOMP=y
CONFIG_SECCOMP_FILTER=y

CONFIG_NETFILTER=y
CONFIG_NF_CONNTRACK=y
CONFIG_NETFILTER_XTABLES=y
CONFIG_NETFILTER_XT_MATCH_CONNTRACK=y
CONFIG_IP_NF_IPTABLES=y
CONFIG_IP_NF_FILTER=y
CONFIG_IP_NF_NAT=y
CONFIG_IP_NF_TARGET_MASQUERADE=y

CONFIG_BRIDGE=y
CONFIG_VETH=y
CONFIG_OVERLAY_FS=y
```

Vyline を Docker で動かす用途では、このあたりが基礎になります。

## 4.3 追加推奨 CONFIG

過去の reference kernel では以下が不足しており、Docker/LXC 向けの補助 config で追加対象として扱いました。

```text
CONFIG_POSIX_MQUEUE=y
CONFIG_IPC_NS=y
CONFIG_CGROUP_PIDS=y
CONFIG_CGROUP_DEVICE=y       # 古い cgroup v1 / LXC 等で特に有用
CONFIG_FHANDLE=y
CONFIG_NETFILTER_XT_MATCH_ADDRTYPE=y
CONFIG_BRIDGE_NETFILTER=y
```

注意点:

- これらが全部無いと `docker run hello-world` が絶対に失敗する、という意味ではありません。
- 過去の実機では一部が無い状態でも Docker 自体は起動しました。
- ただし一般的な Docker / Compose / LXC との互換性、警告削減、コンテナ機能の欠落回避のため、カスタムカーネルを作るなら入れておく方が良いです。

## 4.4 ストレージ用に重要な CONFIG

このガイドでは `/var/lib/docker` を ext4 loop image に載せます。そのため少なくとも次が必要です。

```text
CONFIG_EXT4_FS=y または m
CONFIG_BLK_DEV_LOOP=y または m
CONFIG_OVERLAY_FS=y または m
```

さらに通常は次も必要です。

```text
CONFIG_PROC_FS=y
CONFIG_SYSFS=y
CONFIG_TMPFS=y
CONFIG_DEVPTS_FS=y
```

## 4.5 ネットワーク用に重要な CONFIG

最低限、Docker bridge が作れる必要があります。

```text
CONFIG_NET_NS=y
CONFIG_VETH=y
CONFIG_BRIDGE=y
CONFIG_NETFILTER=y
CONFIG_NF_CONNTRACK=y
CONFIG_IP_NF_IPTABLES=y
CONFIG_IP_NF_FILTER=y
CONFIG_IP_NF_NAT=y
CONFIG_IP_NF_TARGET_MASQUERADE=y
```

Android の legacy iptables 経路を手動で修正する構成では特に NAT / conntrack が重要です。

## 4.6 TUN は Vyline 本体には必須ではない

```text
CONFIG_TUN=y
```

は VPN、Tailscale、WireGuard 周辺、特殊なコンテナ用途では便利ですが、**Vyline コンテナそのものには必須ではありません**。

Cloudflare Tunnel の通常の userspace `cloudflared` も TUN デバイスを必須としません。

## 4.7 KVM は不要

次は Vyline だけなら不要です。

```text
CONFIG_KVM
CONFIG_KVM_ARM_HOST
CONFIG_ARM64_VHE
vhost
virtio
vsock
```

これらは Android 端末で VM まで動かしたい場合の話です。

過去の環境では KVM config は有効でも `/dev/kvm` が生成されていませんでした。EL2 の利用可否や vendor boot chain は kernel config だけでは決まりません。

したがって Vyline 構築時に `/dev/kvm` が無くても無視して構いません。

## 4.8 Vendor/WALT カーネルで無闇に scheduler を変えない

OnePlus / Qualcomm vendor kernel では WALT 等の vendor scheduler が使われています。

過去の kernel 検証では、少なくとも次を無闇に有効化しない方針でした。

```text
# CONFIG_FAIR_GROUP_SCHED is not set
# CONFIG_RT_GROUP_SCHED is not set
# CONFIG_SCHED_AUTOGROUP is not set
```

「Docker 向け一般 Linux config」を丸ごと vendor Android kernel に投入すると、起動不能や scheduler 競合の原因になります。

必要な container 機能だけを追加する方が安全です。

---

# 5. カーネルの事前診断

root shell で確認します。

## 5.1 基本情報

```bash
uname -a
uname -m
id
getenforce
```

期待:

```text
aarch64
uid=0 を取得可能
```

## 5.2 `/proc/config.gz` がある場合

```bash
zcat /proc/config.gz | grep -E \
'CONFIG_(NAMESPACES|UTS_NS|IPC_NS|PID_NS|NET_NS|USER_NS|CGROUPS|MEMCG|CGROUP_PIDS|CGROUP_DEVICE|SECCOMP|SECCOMP_FILTER|OVERLAY_FS|VETH|BRIDGE|NETFILTER|NF_CONNTRACK|IP_NF_NAT|EXT4_FS|BLK_DEV_LOOP|TUN)='
```

## 5.3 `/proc/config.gz` が無い場合

`CONFIG_IKCONFIG=y` / `CONFIG_IKCONFIG_PROC=y` が無い kernel では、boot image の `Image` から IKCONFIG を抽出して確認する必要があります。

カスタム kernel を自分で build するなら、診断性のために次を有効にする価値があります。

```text
CONFIG_IKCONFIG=y
CONFIG_IKCONFIG_PROC=y
```

## 5.4 cgroup を見る

```bash
cat /proc/cgroups
findmnt -t cgroup,cgroup2
mount | grep -E 'cgroup|cgroup2'
```

Android は普通の systemd Linux と違い、cgroup v1 と v2 が混在することがあります。

過去の Android 環境では Android 固有の v1 mount と cgroup2 が同居していました。

そのためこのガイドでは Docker daemon に systemd cgroup driver を使わせず、`cgroupfs` を指定します。

---

# 6. root / SELinux 要件

## 6.1 root は実質必須

この構成では次の操作が必要です。

- real chroot
- bind mount / rbind
- mount propagation 変更
- loop device attach
- ext4 mount
- iptables
- ip rule
- `ip_forward`
- dockerd

よって一般アプリ権限や Shizuku だけでは足りません。

KernelSU / Magisk 等で root shell を取得できることを前提とします。

## 6.2 SELinux

過去の OnePlus 9 Pro 構成では SELinux enforcing のままでは loop image の R/W や関連操作が止まり、ユーザーの明示的な選択として次を使用しました。

```bash
setenforce 0
```

確認:

```bash
getenforce
```

```text
Permissive
```

であれば permissive です。

### セキュリティ上の注意

SELinux permissive は Android 全体の防御を弱めます。

本来は必要な sepolicy を作る方が望ましいです。ただし過去の検証環境では Vyline/Docker 専用 sepolicy までは構築せず、server host として permissive を選択しました。

この文書でも **「permissive が Docker の仕様上必須」ではなく、「この Android server 構成で採用した実証済み回避策」** として扱います。

---

# 7. Termux の準備

## 7.1 Termux は入口として使う

Termux 自体の proot 上で Docker を動かすのではなく、以下の役割にします。

- SSH の入口
- Ubuntu rootfs の取得
- BusyBox mount/chroot の実行
- server startup script の配置
- wake lock
- root shell 呼び出し

## 7.2 必要パッケージ

Termux で:

```bash
pkg update -y
pkg install -y \
  proot-distro \
  busybox \
  openssh \
  tmux \
  coreutils \
  curl
```

## 7.3 wake lock

```bash
termux-wake-lock
```

Android の Doze whitelist も設定できるなら:

```bash
su -c 'cmd deviceidle whitelist +com.termux'
```

## 7.4 SSH

Termux の `sshd` は通常 8022 を使います。

```bash
sshd
ss -lnt | grep 8022
```

別端末から:

```bash
ssh -p 8022 <termux-user>@<PHONE_IP>
```

長時間作業は `tmux` 推奨です。

```bash
tmux new -s server
```

---

# 8. Ubuntu rootfs を用意する

## 8.1 rootfs の取得

```bash
proot-distro install ubuntu
```

標準パス例:

```text
/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs
```

以後、この文書では:

```bash
PREFIX=/data/data/com.termux/files/usr
ROOT="$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs"
BB="$PREFIX/bin/busybox"
```

とします。

## 8.2 重要: 実行時には proot-distro login を使わない

Docker host として利用する時は:

```bash
busybox chroot "$ROOT" /bin/bash
```

のような real chroot を使います。

---

# 9. Ubuntu rootfs の mount 構成

ここを適当にすると runc が壊れます。

## 9.1 過去に発生したエラー

単純な chroot のまま Docker を起動すると、container layer 展開時に次のようなエラーが発生しました。

```text
remount /, flags: 0x84000: invalid argument
```

原因は、chroot の `/` が mountpoint として適切でなく、runc が必要とする recursive mount propagation 操作に失敗していたことでした。

## 9.2 rootfs 自身を self-bind する

Android の toybox `mount` より Termux BusyBox の mount を使った方が安定しました。

```bash
su

ROOT=/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs
BB=/data/data/com.termux/files/usr/bin/busybox

$BB mount --bind "$ROOT" "$ROOT"
$BB mount --make-rslave "$ROOT"
```

## 9.3 `nosuid` 問題

Android `/data` は `nosuid` のことがあります。

Vyline + Docker だけなら Cockpit ほど setuid を多用しませんが、一般的な Ubuntu 管理や sudo を使うなら chroot の self-bind だけ `suid` に戻します。

```bash
$BB mount -o remount,bind,suid "$ROOT" "$ROOT"
```

Android の `/data` 全体を remount するのではなく、**chroot rootfs の self-bind mount だけ**を対象にします。

## 9.4 `/dev`

```bash
mkdir -p "$ROOT/dev"
$BB mount --rbind /dev "$ROOT/dev"
$BB mount --make-rslave "$ROOT/dev"
```

## 9.5 `/proc`

```bash
mkdir -p "$ROOT/proc"
$BB mount -t proc proc "$ROOT/proc"
```

## 9.6 `/sys`

```bash
mkdir -p "$ROOT/sys"
$BB mount --rbind /sys "$ROOT/sys"
$BB mount --make-rslave "$ROOT/sys"
```

## 9.7 `/run`

systemd が PID 1 ではないため `/run` も用意します。

```bash
mkdir -p "$ROOT/run"
$BB mount -t tmpfs -o mode=755,nosuid,nodev tmpfs "$ROOT/run"
```

## 9.8 DNS

real chroot では Android/proot が生成した `resolv.conf` が使えないケースがありました。

```bash
rm -f "$ROOT/etc/resolv.conf"
cat > "$ROOT/etc/resolv.conf" <<'EOF2'
nameserver 1.1.1.1
nameserver 8.8.8.8
EOF2
```

必要なら家庭内 DNS や NextDNS 等に変更してください。

## 9.9 chroot helper

```bash
chroot_exec() {
  "$BB" chroot "$ROOT" /usr/bin/env -i \
    HOME=/root \
    USER=root \
    LOGNAME=root \
    TERM="${TERM:-xterm-256color}" \
    LANG=C.UTF-8 \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    /bin/bash -lc "$1"
}
```

---

# 10. Docker の `/var/lib/docker` を Android `/data` に直接置かない

これはかなり重要です。

## 10.1 実際に失敗した構成

Android の `/data` は端末によって F2FS で、casefold 等が有効です。

過去の OnePlus 9 Pro では `/var/lib/docker` をそのまま Android `/data` 上に置いて `overlay2` を使うと OverlayFS が `EINVAL` を返しました。

つまり:

```text
Android F2FS
└─ Ubuntu rootfs
   └─ /var/lib/docker
      └─ overlay2
```

を直接やるのは避けます。

## 10.2 解決策: ext4 sparse image

過去の構成では 64 GB の sparse ext4 image を使いました。

```text
/data/local/docker-storage/docker-ext4.img
```

作成:

```bash
su
mkdir -p /data/local/docker-storage

truncate -s 64G /data/local/docker-storage/docker-ext4.img
/system/bin/mke2fs -t ext4 -F /data/local/docker-storage/docker-ext4.img
```

`sparse` なので、64 GB を作った瞬間に物理 64 GB を消費するわけではありません。

## 10.3 loop device へ attach

```bash
IMG=/data/local/docker-storage/docker-ext4.img
LOOP=$(/system/bin/losetup -f)
/system/bin/losetup "$LOOP" "$IMG"
echo "$LOOP"
```

過去には `/dev/block/loop52` などが割り当てられましたが、番号は固定しないでください。

既存 attach を探すなら:

```bash
/system/bin/losetup -a
```

## 10.4 Ubuntu `/var/lib/docker` へ mount

```bash
mkdir -p "$ROOT/var/lib/docker"
$BB mount -t ext4 -o rw,noatime "$LOOP" "$ROOT/var/lib/docker"
```

確認:

```bash
$BB chroot "$ROOT" findmnt -T /var/lib/docker
```

期待:

```text
/dev/block/loopXX ext4 rw,noatime,...
```

**FSTYPE が ext4 であることを必ず確認してください。**

---

# 11. Ubuntu 内へ Docker Engine を入れる

## 11.1 基本パッケージ

Ubuntu chroot 内:

```bash
apt-get update
apt-get install -y \
  ca-certificates curl gnupg \
  iproute2 iptables procps kmod util-linux coreutils \
  python3
```

SSH や管理用ツールが必要なら追加:

```bash
apt-get install -y openssh-server tmux nano vim tcpdump
```

## 11.2 Docker official repository

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
cat > /etc/apt/sources.list.d/docker.sources <<EOF2
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: arm64
Signed-By: /etc/apt/keyrings/docker.asc
EOF2

apt-get update
apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
```

## 11.3 daemon.json

Android では systemd cgroup driver を前提にしない方が良いです。

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF2'
{
  "storage-driver": "overlay2",
  "exec-opts": ["native.cgroupdriver=cgroupfs"],
  "log-driver": "local"
}
EOF2
```

---

# 12. systemd なしで dockerd を起動する

Android の init が PID 1 であり、Ubuntu chroot の systemd は PID 1 ではありません。

したがって:

```bash
systemctl start docker
```

を前提にしません。

Ubuntu chroot 内で:

```bash
rm -f /var/run/docker.pid
nohup dockerd >/var/log/dockerd.log 2>&1 </dev/null &
```

起動待ち:

```bash
for i in $(seq 1 40); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done
```

確認:

```bash
docker info
```

重要項目:

```text
Storage Driver: overlay2
Cgroup Driver: cgroupfs
Architecture: aarch64
```

---

# 13. Docker 最小テスト

まず Vyline を起動する前に Docker 自体を通します。

```bash
docker run --rm hello-world
```

次に arm64 image が正常か確認:

```bash
docker run --rm alpine uname -m
```

期待:

```text
aarch64
```

次に network:

```bash
docker run --rm alpine ping -c 1 1.1.1.1
```

DNS:

```bash
docker run --rm alpine ping -c 1 google.com
```

ここまで通らない状態で Vyline をデバッグしないでください。

---

# 14. Android 固有の Docker ネットワーク問題

Docker が起動しても、Android の netd / policy routing のせいでネットワークだけ壊れる場合があります。

過去の実機では次の症状がありました。

```text
container -> Docker bridge の ARP は成功
container -> gateway / Internet は通らない

または

container 自体は動く
host の -p 3000:3000 は LISTEN している
接続すると reset / timeout
```

## 14.1 Android policy routing

普通の Linux では最終的に `main` table が自然に参照されます。

Android では大量の netd rule があり、最後に `unreachable` rule が来ることがあります。

そのため Docker bridge から来た packet を明示的に `lookup main` へ送る必要がありました。

過去の script では preference `9800-9899` の範囲を専用領域として使いました。

例:

```text
9800: iif docker0 lookup main
9801: to 172.17.0.0/16 lookup main
9802: iif br-XXXXXXXXXXXX lookup main
9803: to 172.18.0.0/16 lookup main
```

## 14.2 ip_forward

```bash
echo 1 > /proc/sys/net/ipv4/ip_forward
```

## 14.3 WAN route を main table に確保

```bash
ip route get 1.1.1.1
```

から `dev`, `via`, `src` を抽出し、必要なら:

```bash
ip route replace default via <GW> dev <WAN_IF> table main
```

Wi-Fi なら `wlan0` になるケースが多いですが、固定しないでください。

## 14.4 Android は legacy iptables を使う場合がある

過去の OnePlus 環境では Android 側:

```text
iptables v1.8.11 (legacy)
```

一方 Ubuntu/Docker 側ツールは nft 系になることがありました。

Docker が nft table に port publish rule を作っても、Android の実 packet path が legacy iptables 側を通るため host port が機能しないケースがありました。

これが Android で `-p 3000:3000` が普通の Linux のように動かない主因の1つです。

---

# 15. Android 用ネットワーク補正の設計

過去の実証済み server script は Android の built-in chain を flush せず、専用 chain だけを管理しました。

専用 chain:

```text
filter:
  OP9DIN
  OP9DOUT
  OP9DFWD

nat:
  OP9DPRE
  OP9DPOST
```

hook:

```text
INPUT       -> OP9DIN
OUTPUT      -> OP9DOUT
FORWARD     -> OP9DFWD
PREROUTING  -> OP9DPRE
POSTROUTING -> OP9DPOST
```

Android/netd の既存 rule を全部 flush するのは危険なのでやめてください。

## 15.1 各 Docker bridge に対する処理

Docker network を列挙し、bridge driver のネットワークごとに:

```bash
ip rule add pref <9800+> iif <bridge> lookup main
ip rule add pref <9801+> to <subnet> lookup main
```

さらに:

```text
bridge -> bridge : ACCEPT
bridge -> WAN    : ACCEPT
WAN -> bridge RELATED,ESTABLISHED : ACCEPT
subnet -> WAN : MASQUERADE
```

を追加します。

概念例:

```bash
iptables -A OP9DFWD \
  -i docker0 -o wlan0 -s 172.17.0.0/16 \
  -j ACCEPT

iptables -A OP9DFWD \
  -i wlan0 -o docker0 -d 172.17.0.0/16 \
  -m conntrack --ctstate RELATED,ESTABLISHED \
  -j ACCEPT

iptables -t nat -A OP9DPOST \
  -s 172.17.0.0/16 -o wlan0 \
  -j MASQUERADE
```

## 15.2 published port の DNAT

Docker inspect から published port を取得して、たとえば:

```text
host 0.0.0.0:3000
container 172.30.50.2:3000
```

なら Android legacy PREROUTING に:

```bash
iptables -t nat -A OP9DPRE \
  -i wlan0 -p tcp --dport 3000 \
  -j DNAT --to-destination 172.30.50.2:3000
```

FORWARD:

```bash
iptables -A OP9DFWD \
  -i wlan0 -o <docker-bridge> \
  -p tcp -d 172.30.50.2 --dport 3000 \
  -j ACCEPT
```

を入れます。

## 15.3 3秒 watcher

Docker network / container / Wi-Fi は変化するため、過去の構成では 3 秒ごとに再同期する watcher を使いました。

```text
NETWATCH_INTERVAL=3
```

ロジック:

```text
loop forever
  Docker が起動済みか確認
  docker network inspect
  docker inspect running containers
  WAN interface/gateway を再検出
  専用 ip rule 9800-9899 を再構築
  OP9D* chain を再構築
  bridge NAT/FORWARD を再生成
  published ports の DNAT を再生成
  sleep 3
```

これにより Compose で network が増えたり Vyline を再作成して container IP が変わっても追従できます。

---

# 16. Android Docker networking の診断コマンド

root Android shell:

```bash
ip rule
ip route show table main
iptables --version
iptables -t nat -S
iptables -S FORWARD
```

Docker network:

```bash
docker network ls
docker network inspect bridge
```

Vyline:

```bash
docker inspect vyline
```

専用 rule がある場合:

```bash
ip rule | awk '$1+0 >= 9800 && $1+0 <= 9899 {print}'
iptables -t nat -S OP9DPRE
iptables -S OP9DFWD
```

---

# 17. Portainer を Android Docker に入れる

Android では Portainer の bridge published port が reset したことがあったため、過去の実証済み構成では **Portainer 自体は host network** にしました。

```bash
docker volume create portainer_data

docker run -d \
  --name portainer \
  --restart=always \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest \
  --http-disabled
```

アクセス:

```text
https://<PHONE_IP>:9443
```

Portainer が正常に開くなら Vyline Stack の管理は GUI で行えます。

---

# 18. Android 用 Vyline Stack

現在は GHCR arm64 image を使うのが推奨です。

Android の Portainer では次をベースにします。

```yaml
services:
  vyline:
    image: ghcr.io/tqmane/vyline:latest
    pull_policy: always
    platform: linux/arm64

    container_name: vyline

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

    # Android/chroot で docker exec namespace bug が発生するホストでは
    # image 標準 healthcheck を無効化する。
    healthcheck:
      disable: true
```

## 18.1 `platform: linux/arm64`

必須ではありませんが、Android arm64 server であることを明示するために付けても構いません。

## 18.2 `VYLINE_LAN_ACCESS`

現行リポジトリでは、単に port bind を LAN にする設定ではありません。

README / `.env.example` 上では、LAN 内スマホ等から subdevice QR pairing を使う場合にのみ `true` にする設定です。

通常の owner/browser 用ならまず:

```yaml
VYLINE_LAN_ACCESS: "false"
```

で開始するのが安全です。

過去には `true` のまま Cloudflare 経由でアクセスすると、非 loopback request に対して subdevice authentication を要求し、ログイン/復元系が正常に使えない問題がありました。

## 18.3 `VYLINE_TRUST_REMOTE_OWNER`

通常は:

```yaml
VYLINE_TRUST_REMOTE_OWNER: "false"
```

です。

Cloudflare Access / Tailscale ACL / 認証済み reverse proxy 等で到達経路そのものを強く制御しており、remote browser を owner 権限として明示的に扱う場合のみ `true` を検討します。

生の LAN / 生 Internet で `true` にしないでください。

---

# 19. Vyline host path の作成

Ubuntu chroot 内:

```bash
mkdir -p /opt/vyline/data
mkdir -p /opt/vyline/storage
```

現行 image の entrypoint が bind mount を `bun:bun` に修正するため、通常は UID を手作業で決め打ちしなくて構いません。

起動:

```bash
docker compose up -d
```

または Portainer Stack Deploy。

確認:

```bash
docker ps
```

---

# 20. LAN から Vyline を開く

普通の Linux なら:

```text
http://<PHONE_IP>:3000
```

ですが、Android では前述の policy routing / legacy iptables 修正が必要になることがあります。

ホスト自身から:

```bash
curl -I http://127.0.0.1:3000
```

LAN PC から:

```text
http://<PHONE_IP>:3000
```

が両方通ることを確認します。

---

# 21. Cloudflare Tunnel を使う場合

Vyline を認証なしで直接 Internet に出さないでください。

Cloudflare Access + Tunnel は相性が良いです。

## 21.1 推奨: cloudflared を companion container にする

Android host published port の特殊経路をできるだけ避けるため、Cloudflare Tunnel は同じ Docker network の companion container にできます。

```yaml
services:
  vyline:
    image: ghcr.io/tqmane/vyline:latest
    pull_policy: always
    platform: linux/arm64
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
    restart: unless-stopped
    networks:
      - vyline_net

  cloudflared:
    image: cloudflare/cloudflared:latest
    platform: linux/arm64
    command:
      - tunnel
      - --no-autoupdate
      - run
      - --token
      - ${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
    depends_on:
      - vyline
    networks:
      - vyline_net

networks:
  vyline_net:
    driver: bridge
```

Cloudflare 側 Origin:

```text
http://vyline:3000
```

この `vyline` は Docker 内 DNS 名です。PC のブラウザに `http://vyline:3000` と入れてはいけません。

## 21.2 Tunnel token

Portainer Environment variables に:

```text
CLOUDFLARE_TUNNEL_TOKEN=<token>
```

として渡します。

YAML に token を直接 commit しないでください。

## 21.3 過去の Android host cloudflared 構成

以前は `cloudflared` を Ubuntu chroot 自体で動かし、origin を Docker container 固定 IP に向けていました。

理由は Android で:

```text
127.0.0.1:3000
```

の Docker published port が TCP accept 後 reset するケースがあったためです。

その場合:

```text
http://172.30.50.2:3000
```

のように container IP へ直接向ける必要がありました。

現在は companion container 方式なら:

```text
http://vyline:3000
```

で済むため、こちらの方がシンプルです。

---

# 22. `docker exec` が壊れる Android/chroot 環境への注意

過去の OnePlus 9 Pro real chroot 構成では、**コンテナ本体は正常なのに `docker exec` だけ mount namespace を正しく掴まない**現象を確認しました。

症状:

```bash
docker exec vyline ls /
```

を実行すると、本来のコンテナ rootfs ではなく Android / Ubuntu 側の `/system`, `/vendor` 等が見える、あるいは `/app` が存在しない。

一方でコンテナ PID の root は正常:

```bash
PID=$(docker inspect -f '{{.State.Pid}}' vyline)
ls -la "/proc/$PID/root/app"
```

では `/app` が存在する。

この状態では:

- `docker exec` の結果をコンテナ本体の証拠として信用しない。
- `docker exec` を使う healthcheck も失敗する可能性がある。
- Android 用 Compose では必要なら healthcheck を無効化する。
- file inspection は `/proc/<container-pid>/root/...` を使う。

現行 image の標準 healthcheck は HTTP fetch をコンテナ内で実行します。普通の Linux では問題ありませんが、この Android 固有 `docker exec`/namespace 系問題に近い runtime failure が出るホストでは Compose 側で `healthcheck: disable: true` にする方が安全です。

---

# 23. 復元履歴が再読込後に消える場合

最初に疑うのは `/app/data` の永続化と書き込み権限です。

## 23.1 mount を確認

```bash
docker inspect vyline
```

少なくとも:

```text
/opt/vyline/data    -> /app/data
/opt/vyline/storage -> /app/storage
```

になっている必要があります。

## 23.2 host の容量を見る

```bash
du -sh /opt/vyline/data /opt/vyline/storage
find /opt/vyline/data -type f -printf '%s %p\n' | sort -nr | head -20
```

## 23.3 entrypoint error

```bash
docker logs vyline
```

現行 image は `/app/data` または `/app/storage` を `bun` が書けない場合、起動時にエラーで止まる設計です。

過去の古い image のように「復元は見えるが DB 保存失敗を握りつぶす」状態になりにくくなっています。

---

# 24. Vyline のストレージ表示について

現行 tqmane fork は Linux/Docker でも `statfs` を使って filesystem 容量を取得します。

さらに Vyline 全体の使用量は cache/media だけではなく `/app/data` と `/app/storage` を含めて集計するよう修正されています。

したがって上部の Vyline 使用量には:

```text
トーク履歴
設定
バックアップ
認証・アカウント状態
キャッシュ
メディア
```

が含まれます。

一方「削除可能なデータ」は cache / media のみです。

トーク履歴をストレージ画面の削除ボタンから消す設計にはしていません。

---

# 25. Portainer での更新方法

現行 tqmane fork は GHCR の multi-arch image を使うため、Android host 内で Git clone / Bun build / Docker build をする必要は基本的にありません。

更新:

```text
GitHub main に push
↓
GitHub Actions が ghcr.io/tqmane/vyline:latest を build
↓
Portainer
↓
Pull latest image
↓
Update the stack / Redeploy
```

Compose:

```yaml
image: ghcr.io/tqmane/vyline:latest
pull_policy: always
```

を使います。

`docker restart vyline` だけでは、既存 container が古い image ID を参照したままになることがあります。

**新 image を pull した後、container を recreate してください。**

---

# 26. ローカル build が必要な場合の fallback

GHCR を使えない場合のみ Android host 上で build します。

過去には BuildKit から npm registry への DNS が壊れ、通常 build が失敗しました。

回避:

```bash
docker build --network=host -t vyline-local:latest .
```

ただし現在は GHCR arm64 image があるため、これは fallback です。

---

# 27. Android の自動起動

## 27.1 wake lock

```bash
termux-wake-lock
```

## 27.2 Doze whitelist

```bash
su -c 'cmd deviceidle whitelist +com.termux'
```

## 27.3 Termux:Boot

例:

```text
~/.termux/boot/00-oneplus-server
```

```sh
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
sleep 15
'/data/data/com.termux/files/home/start-oneplus-server.sh' \
  >> '/data/data/com.termux/files/home/.op9-server/boot.log' 2>&1
```

実行権限:

```bash
chmod +x ~/.termux/boot/00-oneplus-server
```

## 27.4 注意: 過去には Termux:Boot が確実ではなかった

実機再起動後に Termux SSH 8022 が `Connection refused` となり、端末上で手動 `sshd` を実行すると即座に復旧したケースがありました。

つまり:

```text
Termux:Boot script を置いた
=
実機再起動後も必ず起動する
```

とは限りません。

OnePlus/OxygenOS/ColorOS の autostart / battery optimization / background restriction を確認し、**必ず実機 reboot test を行ってください。**

---

# 28. 最小限の Android Vyline server と、全部入り server の違い

## 28.1 Vyline だけなら不要

以下は過去の「Android を Proxmox/ESXi 的 server にする」構成で入れたものですが、Vyline だけなら不要です。

```text
Cockpit
libvirt
qemu-system-arm
virtinst
LXC
LXCFS
KVM
/dev/kvm
Cockpit admin user
```

## 28.2 Vyline 最小構成

必要なのは概ね:

```text
root
container-capable kernel
Termux
BusyBox
Ubuntu real chroot
ext4 loop Docker root
Docker Engine / Compose
Android Docker network workaround
Vyline GHCR arm64 image
persistent /app/data + /app/storage
```

Portainer と Cloudflare は任意です。

---

# 29. セキュリティ

## 29.1 生 Internet に :3000 を公開しない

ルーター port forwarding で直接:

```text
Internet -> PHONE_IP:3000
```

にしないでください。

推奨:

```text
Cloudflare Access + Tunnel
```

または:

```text
Tailscale / WireGuard / VPN
```

## 29.2 Vyline 自体が非公式 LINE client

リポジトリ README にもある通り、非公式・未承認クライアントです。

アカウント停止・セッション破損・データ損失等のリスクがあります。

## 29.3 秘密情報を commit しない

少なくとも:

```text
.env
Cloudflare Tunnel token
LINE token/session
/app/data
/app/storage
backup ZIP
account DB
```

を Git に入れないでください。

## 29.4 SELinux permissive のリスク

この Android server 方式では実用上 permissive を選んだ実績がありますが、通常の phone としての防御は低下します。

常用端末ではなく server 専用端末に寄せる方が安全です。

---

# 30. 完全 preflight checklist

以下が全部通ってから Vyline のバグを疑います。

## A. Android/root

```bash
uname -m
id
getenforce
```

チェック:

- [ ] `aarch64`
- [ ] root を取得可能
- [ ] mount / losetup / iptables が root で実行可能

## B. Kernel

- [ ] namespaces
- [ ] cgroups
- [ ] seccomp
- [ ] OverlayFS
- [ ] ext4
- [ ] loop
- [ ] veth
- [ ] bridge
- [ ] netfilter
- [ ] conntrack
- [ ] IPv4 NAT / MASQUERADE

## C. Ubuntu chroot

```bash
mount | grep "$ROOT"
```

- [ ] rootfs が self-bind mount
- [ ] rootfs propagation が rslave
- [ ] `/dev` rbind
- [ ] `/proc` mounted
- [ ] `/sys` rbind
- [ ] `/run` tmpfs

## D. Docker storage

```bash
findmnt -T /var/lib/docker
```

- [ ] exact ext4 mount
- [ ] underlying raw Android F2FS ではない

## E. Docker

```bash
docker info
docker run --rm hello-world
```

- [ ] `overlay2`
- [ ] `cgroupfs`
- [ ] hello-world success

## F. Container Internet

```bash
docker run --rm alpine ping -c 1 1.1.1.1
docker run --rm alpine ping -c 1 google.com
```

- [ ] IP 通信 OK
- [ ] DNS OK

## G. Published port

```bash
docker run -d --name nginx-test -p 8080:80 nginx:alpine
```

LAN PC:

```text
http://PHONE_IP:8080
```

- [ ] Android policy routing fix が有効
- [ ] legacy iptables DNAT が有効

終了:

```bash
docker rm -f nginx-test
```

## H. Vyline

```bash
docker pull ghcr.io/tqmane/vyline:latest
```

- [ ] arm64 image pull OK
- [ ] `/opt/vyline/data` bind mount
- [ ] `/opt/vyline/storage` bind mount
- [ ] container starts

## I. Persistence

- [ ] login 後 reload しても state が残る
- [ ] restore 後 reload しても chat が残る
- [ ] container recreate 後も残る

## J. External access

- [ ] Cloudflare Tunnel healthy
- [ ] Access policy 有効
- [ ] origin が `http://vyline:3000` など正しい
- [ ] Internet へ生 :3000 公開していない

---

# 31. トラブルシューティング一覧

## 症状: `overlay2` で invalid argument / EINVAL

原因候補:

```text
/var/lib/docker が Android F2FS 上
casefold 等と OverlayFS の相性
```

対処:

```text
ext4 sparse image -> loop -> /var/lib/docker
```

---

## 症状: runc が `remount /, flags: 0x84000: invalid argument`

原因:

```text
chroot root が正しい mountpoint / propagation 状態でない
```

対処:

```bash
busybox mount --bind "$ROOT" "$ROOT"
busybox mount --make-rslave "$ROOT"
```

---

## 症状: Docker は動くが container から Internet が出ない

原因候補:

```text
Android policy routing
main table 未参照
FORWARD block
MASQUERADE 不足
```

確認:

```bash
ip rule
ip route show table main
iptables -S FORWARD
iptables -t nat -S
```

対処:

```text
bridge iif -> lookup main rule
subnet -> lookup main rule
FORWARD ACCEPT
MASQUERADE
```

---

## 症状: `-p 3000:3000` しているのに LAN から reset

原因候補:

```text
Docker nft publish rule と Android legacy iptables packet path の不一致
```

対処:

```text
Android legacy PREROUTING に DNAT
Android legacy FORWARD に ACCEPT
```

---

## 症状: Portainer bridge publish が reset

対処実績:

```text
Portainer を --network host で起動
```

---

## 症状: Vyline の復元トークが数回 reload 後に消える

原因候補:

```text
/app/data 非永続
/app/data 書き込み不可
古い image で DB flush error を握りつぶしている
```

対処:

- 現行 `ghcr.io/tqmane/vyline:latest` を使う。
- `/app/data` を bind mount。
- container recreate。
- logs を確認。

---

## 症状: 設定画面で容量が 0 B

古い image では Linux storage reporting が不完全でした。

現行 tqmane fork は Linux `statfs` と `/app/data` + `/app/storage` 集計に対応しています。

最新版へ更新してください。

---

## 症状: `docker exec` で `/app` が無い

Android/chroot の既知現象の可能性があります。

```bash
PID=$(docker inspect -f '{{.State.Pid}}' vyline)
ls /proc/$PID/root/app
```

を確認してください。

コンテナ本体が正常なら `docker exec` だけ壊れている場合があります。

---

## 症状: healthcheck unhealthy だがサイトは動く

`docker exec`/runtime namespace 問題がある Android host では healthcheck 実行経路だけ失敗する場合があります。

Android 用 Compose で:

```yaml
healthcheck:
  disable: true
```

を検討します。

---

## 症状: 再起動後 SSH が 8022 で開かない

Termux:Boot が vendor battery/autostart 制御で起動していない可能性があります。

端末上で:

```bash
sshd
```

を手動実行して直るなら Docker ではなく Termux autostart 側の問題です。

---

# 32. 推奨 server 起動順序

毎回の startup はこの順序にすると整理しやすいです。

```text
1. root 取得
2. SELinux 方針を適用
3. Termux wake lock
4. Ubuntu rootfs self-bind / rslave
5. /dev /proc /sys /run mount
6. Docker ext4 image を loop attach
7. /var/lib/docker に ext4 mount
8. dockerd 起動
9. Docker network watcher 起動
10. Portainer / Vyline / cloudflared 起動
```

Docker network watcher は container 起動後にも再同期してください。

---

# 33. 最小起動スクリプトの骨格

以下は構造を理解するための簡略版です。実運用では error handling / exact mount 判定 / network watcher を加えてください。

```bash
#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

PREFIX=/data/data/com.termux/files/usr
ROOT="$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs"
BB="$PREFIX/bin/busybox"
IMG=/data/local/docker-storage/docker-ext4.img

termux-wake-lock || true
su -c 'cmd deviceidle whitelist +com.termux >/dev/null 2>&1 || true' || true

su -c "
setenforce 0 2>/dev/null || true

$BB mount --bind '$ROOT' '$ROOT' 2>/dev/null || true
$BB mount --make-rslave '$ROOT'
$BB mount -o remount,bind,suid '$ROOT' '$ROOT' 2>/dev/null || true

$BB mount --rbind /dev '$ROOT/dev' 2>/dev/null || true
$BB mount --make-rslave '$ROOT/dev' 2>/dev/null || true
$BB mount -t proc proc '$ROOT/proc' 2>/dev/null || true
$BB mount --rbind /sys '$ROOT/sys' 2>/dev/null || true
$BB mount --make-rslave '$ROOT/sys' 2>/dev/null || true
$BB mount -t tmpfs -o mode=755,nosuid,nodev tmpfs '$ROOT/run' 2>/dev/null || true

LOOP=\$(/system/bin/losetup -a | awk -v img='$IMG' 'index(\$0,img){gsub(/:$/,\"\",\$1);print \$1;exit}')
if [ -z \"\$LOOP\" ]; then
    LOOP=\$(/system/bin/losetup -f)
    /system/bin/losetup \"\$LOOP\" '$IMG'
fi

mkdir -p '$ROOT/var/lib/docker'
$BB mount -t ext4 -o rw,noatime \"\$LOOP\" '$ROOT/var/lib/docker' 2>/dev/null || true

$BB chroot '$ROOT' /bin/bash -lc '
  rm -f /var/run/docker.pid
  docker info >/dev/null 2>&1 || nohup dockerd >>/var/log/dockerd.log 2>&1 </dev/null &
'
"
```

これだけでは Android policy routing / published-port DNAT の完全対策を含みません。

---

# 34. ネットワーク watcher の実装方針

実運用では Docker API / CLI から次を抽出します。

```text
docker network ls -q
  -> docker network inspect
     -> Driver=bridge
     -> bridge interface
     -> IPv4 subnet

docker ps -q
  -> docker inspect
     -> container IP
     -> exposed/published port
```

標準 bridge の interface:

```text
docker0
```

custom network の interface は通常:

```text
br-<network-id先頭12文字>
```

policy rule preference は専用範囲を決めます。

過去の構成:

```text
9800 - 9899
```

これ以外の Android netd rule を削除しないでください。

---

# 35. Vyline の推奨 Android 運用形態

2026-09 時点の tqmane fork を Android で動かす場合、最も管理しやすいのは次です。

```text
Android custom kernel + root
        ↓
Termux
        ↓
Ubuntu real chroot
        ↓
Docker Engine
        ↓
Portainer
        ↓
GHCR multi-arch Vyline image
        ↓
/app/data + /app/storage bind mount
        ↓
Cloudflare Access/Tunnel (必要なら companion container)
```

以前のように Android 本体で毎回 `git pull` と `docker build` を行う方式より、GHCR から pull する方式を推奨します。

---

# 36. 「何が必須で、何が任意か」最終まとめ

## 絶対に近い要件

```text
arm64 Android
root
Docker-capable kernel
namespace
cgroup
seccomp
OverlayFS
veth/bridge
netfilter/NAT
ext4 + loop
real chroot
Docker Engine
Android network routing workaround
Vyline persistent volumes
```

## この実証済み構成で強く推奨

```text
Termux BusyBox mount
rootfs self-bind + rslave
/var/lib/docker ext4 loop image
cgroupfs driver
Portainer host network
3-second Docker network rule watcher
GHCR arm64 image
Cloudflare Access
```

## 任意

```text
Cockpit
LXC
KVM
libvirt
QEMU
TUN
Cloudflare Tunnel
Portainer
```

---

# 37. リポジトリの現行設定との対応

`tqmane/vyline` の現行 Docker 関連仕様はこの Android 構成と整合します。

## Dockerfile

- Bun 1.4 系 runtime
- `/app/data`
- `/app/storage`
- `VYLINE_CDN_CACHE_DIR=/app/storage/cache/cdn-cache`
- `VYLINE_ICON_CACHE_DIR=/app/storage/cache/icons`
- `VYLINE_MEDIA_STORAGE_DIR=/app/storage/saved-media`
- entrypoint で bind mount ownership repair
- unprivileged `bun` user で本体実行

## docker-compose.yml / docker-compose.portainer.yml

- `ghcr.io/tqmane/vyline:latest`
- `pull_policy: always`
- `/app/data` 永続化
- `/app/storage` 永続化
- `VYLINE_HOST=0.0.0.0`
- `PORT=3000`
- `restart: unless-stopped`

## GitHub Actions

- `linux/amd64`
- `linux/arm64`
- `latest`
- branch/tag/sha tags
- provenance
- SBOM

---

# 38. 参考リンク

## Vyline

- Repository: https://github.com/tqmane/vyline
- README: https://github.com/tqmane/vyline/blob/main/README.md
- Dockerfile: https://github.com/tqmane/vyline/blob/main/Dockerfile
- Docker Compose: https://github.com/tqmane/vyline/blob/main/docker-compose.yml
- Portainer Compose: https://github.com/tqmane/vyline/blob/main/docker-compose.portainer.yml
- Docker entrypoint: https://github.com/tqmane/vyline/blob/main/docker-entrypoint.sh
- Container workflow: https://github.com/tqmane/vyline/blob/main/.github/workflows/container.yml

---

# 39. この文書の情報源と適用範囲

この文書には2種類の情報が含まれます。

### A. 現行 `tqmane/vyline` リポジトリで確認した仕様

- GHCR multi-arch
- Dockerfile
- Compose
- persistent paths
- environment variables
- bind-mount ownership repair
- image update flow

### B. Android / OnePlus 9 Pro 実機で過去に検証した構築情報

- custom kernel の container config
- Termux + Ubuntu real chroot
- rootfs self-bind + rslave
- `nosuid` 対策
- ext4 loop image
- `overlay2`
- `cgroupfs`
- SELinux permissive 運用
- Android policy routing
- legacy iptables NAT / published-port DNAT
- Portainer host network
- `docker exec` mount namespace 異常
- Termux:Boot の不確実性

そのため、他メーカー / 他 kernel / 新しい Android では一部 workaround が不要な場合もあります。

ただし Android 上で Docker が「起動はするが微妙に壊れる」場合の切り分けポイントとしては、そのまま利用できます。

---

# 40. 最後に: 最短の成功条件

Vyline が Android Docker で安定動作していると言える最低条件は次です。

```text
[Kernel]
Docker namespace/cgroup/network/overlay が使える

[Filesystem]
/var/lib/docker が ext4
overlay2 が正常

[Runtime]
docker run hello-world が成功
container Internet/DNS が成功

[Android Network]
LAN published port が成功
または cloudflared companion から service name で到達可能

[Vyline]
ghcr.io/tqmane/vyline:latest arm64 が起動
/app/data と /app/storage が永続化
reload / container recreate 後も履歴が残る

[Security]
生 Internet に直接公開していない
```

ここまで通っていれば、Android は Vyline の Docker host として実用レベルに入っています。
