# **M**ine**c**raft **M**irror

Minecraft Mirror for vanilla/fabric/forge/optfine

采用 No Server 的架构方案，极大的降低资源费用的使用。
本代码的实现遵循 OMCM(Open Minecraft Mirror) 协议，该协议下文中定义。

## Feature

- [x] Vanilla Minecraft
- [x] Fabric
- [x] forge
- [ ] liteloader
- [ ] mods

## Power by

- Deno

## Quick start

镜像配置字符串：

```text
minecraft-meta=http://mcm.xgheaven.com/minecraft/launcher-meta
minecraft-launcher=http://mcm.xgheaven.com/minecraft/launcher
minecraft-libraries=http://mcm.xgheaven.com/minecraft/libraries
minecraft-resources=http://mcm.xgheaven.com/minecraft/assets
fabric-meta=http://mcm.xgheaven.com/fabric/meta
fabric-maven=http://mcm.xgheaven.com/fabric/maven
forge=http://mcm.xgheaven.com/forge
```

> 没有使用 https 协议是为了降低资源的占用（主要是云服务 https 请求数要收费）以及下载的速度，虽然有一定被拦截的风险，但依旧在可控范围内。
> 当然，不放心的话也可以开放使用 https 协议。


## Architecture

分为两大块架构，分别是`存储`和`同步`。存储和同步是完全分离的，同步程序可以脱离存储服务存在。

### 存储

存储推荐使用云端的对象存储服务，只需要将源站的内容同步到存储区，直接通过 http 访问就可以实现镜像服务。
当然，为了提供更加稳定的服务，可以根据需要添加前置的 CDN 服务。

> 另外很多云厂商提供了一定程度上的免费容量，羊毛党怎么可以错过这个呢？

对于不想要使用云服务上的（不想花钱的），也可以将资源保存在本地，通过前置 nginx 静态服务器同样可以提供服务。
灵活存储，灵活使用，方便私有化部署。

### 同步

通过简单的配置同步程序，比如 cron，可以定时将源站的资源同步到存储。

## Open Minecraft Mirror Protocol

Version: v0.0.3
Last update: 2020-07-30
Created: 2020-06-21

本协议为开源协议，任何遵循了本协议的镜像服务都可以无缝切换。
本协议仅定义相关目录存储结构，不对具体同步逻辑的实现有任何约束，也不限制任何人在此协议上添加兼容性扩展。

### 基本原则

1. 使用对静态资源友好的方式，大部分资源一旦存储，不会再次更新
2. 尽可能保证对原先服务或者接口的兼容性
3. 镜像协议的使用方式以路径域名替换为主

### 路径概念

不论源服务器是如何区分资源的，此协议将所有资源都抽象为一个 `/` 下的文件系统，不同的镜像资源用不同的前缀区分。
并且不再存在域名的概念，后文再提到镜像地址时，不再携带域名。

E.g.

`http://launcher.mojang.com/foo/bar` 缓存到 `/prefix/foo/bar` 下，意思代表只需要拼接上镜像站的域名地址即可访问。
也就是 `http://mirror.example.com/prefix/foo/bar` 就可以访问到镜像文件

### 配置协议

本协议的配置采用 `key=value` 格式：

*Config*:
- *ConfigLine* *\[* **\\n** *ConfigLine* *\]*

*ConfigLine*:
- *ConfigKey* **=** *ConfigValue* *\[* **;** *ConfigLine* *\]*
- **#** *AnyLetter*
- **\\n**

*ConfigKey*:
- *PreserveSourceKey*
- *URL*

*ConfigValue*:
- *URL*

*PreserveSourceKey*:
- **mc**
- **minecraft**
- **mc-meta**/**minecraft-meta**
- **mc-launcher**/**minecraft-launcher**
- **mc-libraries**/**minecraft-libraries**
- **mc-resources**/**minecraft-resources**
- **fabric**
- **fabric-meta**
- **fabric-maven**
- **forge**

*URL*:
- [WHATWG URL](https://url.spec.whatwg.org/)

#### Example

```text
mc-meta=http://mc.example.com/meta
# 也可以替换成实际的域名
https://launchermeta.mojang.com=http://mc.example.com/meta

# 或者可以将多个配置写在一行方便复制粘贴
mc-resources=http://mc.example.com/resources;mc-libraries=http://mc.example.com/libraries
```

### 域名替换规则

有如下配置规则：

- *ConfigKey* 如果为 *URL*，不允许出现 http(s):// 协议头，如果出现自动忽略
- *ConfigValue* 如果为 *URL*，如果没有出现协议头，那么默认和源一致。

让 *source* 为源地址，需要转化为 *target* 目标镜像地址：

1. 让 *sourceProtocol* 为 *source* 的协议，让 *sourceRest* 为除了协议的剩余部分
1. 让 *config* 为 *source* 在 *Config* 中匹配的一条规则
    2. 如果没有配到，返回 *source*
1. 让 *configSource* 为 *config* 的 *ConfigKey*，让 *configTarget* 为 *config* 的 *ConfigValue*
    2. 如果 *configSource* 为关键字，自动替换为对应的域名
    2. 如果替换失败，返回 *source*
1. 如果 *configSource* 有协议，就删除掉
1. 如果 *configTarget* 有协议
    2. 让 *targetProtocol* 为 *configTarget* 的协议，并让 *configTarget* 删除掉自身协议
    2. 否则让 *targetProtocol* 为 *sourceProtocol*
1. 让 *targetRest* 为 *sourceRest* 中把 *configSource* 内容替换为 *configTarget* 的结果
1. 让 *target* 为 *targetProtocol* + *targetRest*
1. 返回 *target*

#### Example

Config

```
foo.example.com=mirror.example.com/foo
bar.example.com=http://mirror.example.com/bar
```

- `http://foo.example.com/some-path` => `http://mirror.example.com/foo/some-path`
- `https://foo.example.com/some-path` => `https://mirror.example.com/foo/some-path`
- `http://bar.example.com/some-path` => `http://mirror.example.com/bar/some-path`
- `https://bar.example.com/some-path` => `http://mirror.example.com/bar/some-path`

### Minecraft 原版服务镜像协议

原版服务镜像会牵扯到下面几个域名，并分别绑定(**=>**)不同的 *PreserveSourceKey*：

- `launchermeta.mojang.com` => *mc-meta*/*minecraft-meta* 存储和游戏相关的数据元信息
- `launcher.mojang.com` => *mc-launcher*/*minecraft-launcher* 存储了启动器相关的资源，比如游戏的 jar
- `libraries.minecraft.net` => *mc-libraries*/*minecraft-libraries* 存储游戏需要的一些运行库，本质上是 maven 仓库
- `resources.download.minecraft.net` => *mc-resources*/*minecraft-resources* 存储了游戏运行所需的资源，比如贴图、材质、音频等，简单理解就是资源包

另外还有一个特殊的接口，也是一切的入口，原版服务的所有资源信息都可以通过该接口取得 `https://launchermeta.mojang.com/mc/game/version_manifest.json`。

### Fabric 镜像服务

什么是 [Fabric](https://fabricmc.net/)?

Fabric 已经提供了比较好的 API 了，[API 仓库地址](https://github.com/FabricMC/fabric-meta)。
只需要按照 API 的规范，将内容拓印下来即可。

相关域名：

- `meta.fabricmc.net` => *fabric-meta* 提供 RESTful API 的域名
- `maven.fabricmc.net` => *fabric-maven* maven 镜像仓库

#### 文件系统

因为 RESTful 的特性，可能会同时存在 `/loader` 和 `/loader/:game_version` 两个 endpoint。
这对于对象存储服务来说，是合法的，但针对本地文件系统来说，这是不合法的，一个名字不能同时对应一个文件和文件夹。

所以在处理 Fabric API 时候，针对本地文件系统，meta 下的所有 REST 接口都需要添加 `.json` 后缀。

E.g.

`https://meta.fabricmc.net/v2/versions/game` => `/fabric/meta/v2/versions/game.json`

### Forge

什么是 [Forge](http://files.minecraftforge.net/)

Forge 整体比较简单，所有的资源都存放在一个域名下：

- `files.minecraftforge.net` => `forge` 存放了与 forge 相关的所有资源和数据

### LiteLoader(WIP)

TODO

### Mods(WIP)

镜像源可以缓存玩家常用的模组，根据模组类型的不同，分别存放在不同的文件夹下，并创建 `/mods` 文件夹。

- `fabric` 相关模组 => `/fabric/mods`
- `forge` 相关模组 => `/forge/mods`
- `liteloader` 相关模组 => `/liteloader/mods`

## Build yourself mirror

首先安装同步程序

```bash
deno install -A --unstable https://raw.githubusercontent.com/XGHeaven/mcm/master/mcm.ts
```

此时 `mcm` 会安装到你的终端下，运行如下命令即可将所有的内容同步到 `/data/mcm/storage` 下

```bash
mcm --storage-type fs --storage-options=/data/mcm/storage 'mc:all' 'fabric:all' 'forge:all'
```

更多帮助信息，请查看 `mcm --help`

## Why I create this project

在有 bangbang93 的 [BMCLAPI](https://bmclapidoc.bangbang93.com) 之后，为啥我还要创建这个项目？

1. BMCLAPI 是通过服务器实现的，需要服务端的接入，某种程度上增加了扩展和运维的难度
2. 因为服务器的带宽和流量是有限的，在人数量较多的情况下，很难承载的起，我就经常遇到几 k 的下载速度，大部分时间都是依靠科学上网
3. 因为 BMCLAPI 是闭源的，想自己私有部署比较困难
4. 利用云服务商的对象存储，可以非常简单的做到扩容（可能略贵吧）

## Thanks
