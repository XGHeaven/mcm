# **M**ine**c**raft **M**irror

Minecraft Mirror for vanilla/fabric/forge/optfine

采用 No Server 的架构方案，极大的降低资源费用的使用。
遵循 OMCM(Open Minecraft Mirror) 协议，在下文中定义。

镜像地址：http://mcm.xgheaven.com

> 没有使用 https 协议是为了降低资源的占用（主要是云服务 https 请求数要收费）以及下载的速度，虽然有一定被拦截的风险，但依旧在可控范围内。
> 当然，不放心的话也可以开放使用 https 协议。

## Feature

- [x] Vanilla Minecraft
- [x] Fabric
- [ ] forge
- [ ] optfine
- [ ] liteloader

## Power by

- Deno

## Quick Start

<!-- TODO -->

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

Version: v0.0.1
Last update: 2020-06-26
Created: 2020-06-21

本协议为开源协议，任何遵循了本协议的镜像服务都可以无缝切换。
本协议仅定义相关目录存储结构，不对具体同步逻辑的实现有任何约束，也不限制任何人在此协议上添加兼容性扩展。

### 基本原则

1. 使用对静态资源友好的方式，大部分资源一旦存储，不会再次更新。
2. 尽可能保证对原先服务或者接口的兼容性

### 路径概念

不论源服务器是如何区分资源的，此协议将所有资源都抽象为一个 `/` 下的文件系统，不同的镜像资源用不同的前缀区分。
并且不再存在域名的概念，后文再提到镜像地址时，不再携带域名。

E.g.

`http://launcher.mojang.com/foo/bar` 缓存到 `/prefix/foo/bar` 下，意思代表只需要拼接上镜像站的域名地址即可访问。
也就是 `http://mirror.example.com/prefix/foo/bar` 就可以访问到镜像文件

### Minecraft 原版服务镜像协议

> 跟原版服务镜像相关的资源全部存放到 `/minecraft` 目录下

原版服务镜像会牵扯到下面几个域名：

- `launchermeta.mojang.com` 该域名上的资源存储了和游戏相关的数据元信息
- `launcher.mojang.com` 该域名上存储了启动器相关的额资源，比如游戏的 jar
- `libraries.minecraft.net` 该域名上存储了游戏需要的一些运行库，也就是一个 maven 仓库
- `resources.download.minecraft.net` 该域名上存储了游戏所需的资源，比如贴图、音频等，简单理解就是资源包。

另外还有一个特殊的接口，也是一切的入口，原版服务的所有资源信息都可以通过该接口取得 `https://launchermeta.mojang.com/mc/game/version_manifest.json`

以上所有域名通过映射成本地路径前缀，实现就可以实现镜像：

- `launchermeta.mojang.com` => `/minecraft/launcher-meta`
- `launcher.mojang.com` => `/minecraft/launcher`
- `libraries.minecraft.net` => `/minecraft/libraries`
- `resources.download.minecraft.net` => `/minecraft/assets`

> 为什么 resources 要映射成 asset，因为 json 文件中主要以 assets 存在，所以这里沿用了这个概念

### Fabric 镜像服务

> Fabric 的相关资源全部放到 `/fabric` 目录下

什么是 [Fabric](https://fabricmc.net/)?

Fabric 已经提供了比较好的 API 了，[仓库地址](https://github.com/FabricMC/fabric-meta)。
只需要按照 API 的规范，将内容拓扑下来即可。

相关域名：

- `meta.fabricmc.net` 提供 RESTful API 的域名
- `maven.fabricmc.net` maven 镜像仓库

域名映射：

- `meta.fabricmc.net` => `/fabric/meta`
- `maven.fabricmc.net` => `/fabric/maven`

#### 文件系统

因为 RESTful 的特性，可能会同时存在 `/loader` 和 `/loader/:game_version` 两个 endpoint。
这对于对象存储服务来说，是合法的，但针对本地文件系统来说，这是不合法的，一个名字不能同时对应一个文件和文件夹。

所以在处理 Fabric API 时候，针对本地文件系统，相关的接口都需要添加 `.json` 后缀。只需要接口添加即可，静态资源无需添加。

E.g.

`https://meta.fabricmc.net/v2/versions/game` => `/fabric/meta/v2/versions/game.json`

### Forge

> Forge 相关的数据都存放到 `/forge` 目录下

**注意**：因为 forge 关闭了 API，暂时无法做同步，请尝试直接使用 BMCLAPI

### LiteLoader(Optional)

> LiteLoader 相关的数据存放在 `/liteloader` 目录下

TODO

### Mods(Optional)

镜像源可以缓存玩家常用的模组，根据模组类型的不同，分别存放在不同的文件夹下，并创建 `/mods` 文件夹。

- `fabric` 相关模组 => `/fabric/mods`
- `forge` 相关模组 => `/forge/mods`
- `liteloader` 相关模组 => `/liteloader/mods`

## Why I create this project

在有 bangbang93 的 [BMCLAPI](https://bmclapidoc.bangbang93.com) 之后，为啥我还要创建这个项目？

1. BMCLAPI 是通过服务器实现的，需要服务端的接入，某种程度上增加了扩展和运维的难度
2. 因为服务器的带宽和流量是有限的，在人数量较多的情况下，很难承载的起，我就经常遇到几 k 的下载速度，大部分时间都是依靠科学上网
3. 因为 BMCLAPI 是闭源的，想自己私有部署比较困难
4. 利用云服务商的对象存储，可以非常简单的做到扩容（可能略贵吧）

## Thanks
