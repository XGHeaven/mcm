
## Minecraft Mirror Protocol

Version: v0.0.4
Last update: 2020-08-14
Created: 2020-06-21

### 基本原则

1. 本协议为开源开源协议，任何人都可以基于本协议添加兼容协议
2. 本协议仅仅定义配置字符串，不对具体的同步逻辑以及目录结构有强制性约束
3. 协议规范的定制是保证在兼容原有服务、接口的基础上制定的，不会额外创造添加源没有的任何数据
4. 使用对静态资源友好的方式，大部分资源一旦存储，不会再次更新

### 路径概念

不论源服务器是如何区分资源的，此协议将所有资源都抽象为一个 `/` 下的文件系统，不同的镜像资源用不同的前缀区分。
并且不再存在域名的概念，后文再提到镜像地址时，不再携带域名。

E.g.

`http://launcher.mojang.com/foo/bar` 缓存到 `/prefix/foo/bar` 下，意思代表只需要拼接上镜像站的域名地址即可访问。
也就是 `http://mirror.example.com/prefix/foo/bar` 就可以访问到镜像文件

### 配置字符串语法

本配置字符串主要采用 `key=value` 格式，具体语法如下：

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
- **curse**
- **curse-files**
- **curse-api**

*URL*:
- [WHATWG URL](https://url.spec.whatwg.org/)

#### Example

```text
mc-meta=http://mc.example.com/meta
# 也可以替换成实际的域名
https://launchermeta.mojang.com=http://mc.example.com/meta

# 或者可以将多个配置写在一行，中间用分号分割，方便复制粘贴
mc-resources=http://mc.example.com/resources;mc-libraries=http://mc.example.com/libraries
```

### 域名配置流程

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

### Mods

镜像源可以缓存玩家常用的模组，有许多的不同的模组下载源，定义了 CurseForge 源。

#### CurseForge

CurseForge 主要有两部分组成，分别为 API 以及 CDN 存储：

- `https://addons-ecs.forgesvc.net` => `curse-api`
- `https://edge.forgecdn.net` => `curse-files`
