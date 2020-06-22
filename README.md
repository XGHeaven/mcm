# **M**inecraft **M**irror

Minecraft Mirror for vanilla/fabric/forge/optfine

采用 No Server 的架构方案，极大的降低资源费用的使用。
遵循 OMCM(Open Minecraft Mirror) 协议，方便的在私有环境部署。

镜像地址：http://mcm.xgheaven.com

> 没有使用 https 协议是为了降低资源的占用（主要是云服务 https 请求数要收费）以及下载的速度，虽然有一定被拦截的风险，但依旧在可控范围内。
> 当然，不放心的话也可以使用 https 协议。

## Feature

- [x] Vanilla Minecraft
- [x] Fabric
- [ ] forge
- [ ] optfine
- [ ] liteloader

## Power by

- Deno

## Architecture

分为两大块架构，分别是`存储`和`同步`。存储和同步是完全分离的，同步程序可以脱离存储服务存在。

### 存储

存储推荐使用云端的对象存储服务，只需要将源站的内容同步到存储区，直接通过 http 访问就可以实现镜像服务。
当然，为了提供更加稳定的服务，可以根据需要添加前置的 CDN 服务。

> 另外很多云厂商提供了一定程度上的免费容量，羊毛党怎么可以错过这个呢？

对于不想要使用云服务上的（不想花钱的），也可以将资源保存在本地，通过前置 nginx 静态服务器同样可以提供服务。
灵活存储，灵活使用。

### 同步

通过简单的配置同步程序，比如 cron，可以定时将源站的资源同步到存储。

## Open Minecraft Mirror API

TODO

## Why I create this project

在有 bangbang93 的 [BMCLAPI](https://bmclapidoc.bangbang93.com) 之后，为啥我还要创建这个项目？

1. BMCLAPI 是通过服务器实现的，需要服务端的接入，某种程度上增加了扩展和运维的难度
2. 因为服务器的带宽和流量是有限的，在人数量较多的情况下，很难承载的起，我就经常遇到几 k 的下载速度，大部分时间都是依靠科学上网
3. 因为 BMCLAPI 是闭源的，想自己私有部署比较困难
4. 利用云服务商的对象存储，可以非常简单的做到扩容（可能略贵吧）

## Thanks
