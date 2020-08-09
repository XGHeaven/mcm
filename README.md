# **M**ine**c**raft **M**irror

Minecraft Mirror for vanilla/fabric/forge/optfine

采用 No Server 的架构方案，极大的降低资源费用的使用。
本代码的实现遵循 [MCM](./MCM.md) 协议，该协议下文中定义。

## Source

- [x] Vanilla Minecraft
- [x] Fabric
- [x] forge
- [ ] liteloader
- [ ] mods

## Quick start

官方镜像配置字符串：

```text
minecraft-meta=http://mcm.xgheaven.com/minecraft/launcher-meta
minecraft-launcher=http://mcm.xgheaven.com/minecraft/launcher
minecraft-libraries=http://mcm.xgheaven.com/minecraft/libraries
minecraft-resources=http://mcm.xgheaven.com/minecraft/assets
fabric-meta=http://mcm.xgheaven.com/fabric/meta
fabric-maven=http://mcm.xgheaven.com/fabric/maven
forge=http://mcm.xgheaven.com/forge
```

> 没有使用 https 协议是为了降低资源的占用（主要是云服务 https 请求数要收费）以及下载的速度。
> 如果担心有拦截风险，可以尝试自行本地部署一份。

为了方便使用，特地 fork 了 [HMCL](https://github.com/huanghongxun/HMCL) 代码，添加了本代理官方镜像地址。
下载地址见 Release 页面。

> 注意：fork 版本的代码所有权依旧归原作者所有，没有做任何额外的修改，只是添加镜像地址，如果有任何问题，请尝试去官方仓库解决。

[如何构建自己的镜像呢？](./SELFHOST.md)

## Why I create this project

在有 bangbang93 的 [BMCLAPI](https://bmclapidoc.bangbang93.com) 之后，为啥我还要创建这个项目？

1. BMCLAPI 是通过服务器实现的，需要服务端的接入，某种程度上增加了扩展和运维的难度
2. 接口设计比较依赖于服务端的参与，某种程度上不方便 CDN 的缓存、加速等
3. 因为需要服务器的缘故，带宽和流量往往是有限的，在人数量较多的情况下，不一定承载的起，会导致网速过慢
4. 因为 BMCLAPI 是闭源的，无法私有部署，否则就需要自己手动编写相关的兼容层逻辑。
5. 可以利用云服务商的对象存储，可以非常简单的做到扩容（可能略贵吧，不过个人用的话免费的容量还是足够的）

## Power by

- Deno

## Thanks
