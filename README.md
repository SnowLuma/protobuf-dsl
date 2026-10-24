# protobuf-fastdsl

将 TypeScript 接口在构建时编译为专用、无运行时依赖的 protobuf 编解码函数。

## 特性

- **静态生成** — 编解码逻辑和所需辅助函数均在构建时生成
- **按需生成与缓存** — 只生成调用所需的编码器、解码器和依赖；相同源码重复转换直接命中缓存
- **嵌套消息单缓冲区** — 统一测量大小并写入一个输出缓冲区，避免逐层分配和复制
- **TypeScript 原生** — 用 `pb<N, Type>` 标记接口字段即可定义 schema
- **跨文件类型** — 支持 `import type` / `import` 引用其他文件的接口定义
- **泛型单态化** — `Wrapper<Wrapper<string>>` → 自动生成具体编解码函数
- **重复字段** — `pb_repeated<N, Type>` 编译为 `Type[]`
- **编译期预计算 Tag** — 字段标签在编译时折叠为字面量字节

## 安装

```bash
npm install protobuf-fastdsl
```
## 快速开始

**1. 配置构建工具插件：**

```ts
// vite.config.ts
import protobufPlugin from 'protobuf-fastdsl/vite';

export default defineConfig({
  plugins: [protobufPlugin()],
});
```

**2. 定义 protobuf schema（TypeScript 接口）：**

```ts
// schema/user.ts
import type { pb, pb_repeated, uint_32, bool } from 'protobuf-fastdsl';

export interface UserProfile {
  id:       pb<1, uint_32>;
  username: pb<2, string>;
  active:   pb<3, bool>;
  tags:     pb_repeated<4, string>;
}
```

**3. 编解码：**

```ts
import { protobuf_encode, protobuf_decode } from 'protobuf-fastdsl';
import type { UserProfile } from './schema/user';

const bytes = protobuf_encode<UserProfile>({
  id: 42,
  username: 'alice',
  active: true,
  tags: ['admin', 'dev'],
});

const user = protobuf_decode<UserProfile>(bytes);
// user.id === 42, user.tags === ['admin', 'dev']
```

构建时，插件将上述代码转换为：

```js
// 预计算的 tag 字面量和专用 varint 代码
const bytes = protobuf_encode_UserProfile({ id: 42, ... });
const user = protobuf_decode_UserProfile(bytes);
```

如果忘记配置插件，`protobuf_encode` / `protobuf_decode` 会在运行时抛出错误提示。

## 跨文件类型引用

接口定义和编解码调用可以在不同文件中，插件会自动跟踪 import 链：

```ts
// inner.ts
import type { pb, uint_32 } from 'protobuf-fastdsl';

export interface Inner {
  value: pb<1, uint_32>;
}

// outer.ts
import { protobuf_encode } from 'protobuf-fastdsl';
import type { Inner } from './inner';
import type { pb } from 'protobuf-fastdsl';

interface Outer {
  inner: pb<1, Inner>;
}

const bytes = protobuf_encode<Outer>({ inner: { value: 42 } });
```

支持传递性导入（A → B → C），插件会递归解析所有依赖。

## 别名导入

```ts
import { protobuf_encode as encode, protobuf_decode as decode } from 'protobuf-fastdsl';

const bytes = encode<UserProfile>(data);  // → protobuf_encode_UserProfile(data)
const user = decode<UserProfile>(bytes);  // → protobuf_decode_UserProfile(bytes)
```

也支持 namespace 形式：

```ts
import * as pb from 'protobuf-fastdsl';

const bytes = pb.protobuf_encode<UserProfile>(data);
const user = pb.protobuf_decode<UserProfile>(bytes);
```

## 泛型单态化

定义泛型 protobuf 模板，使用具体类型实例化：

```ts
interface Wrapper<T> {
  value?: pb<1, T>;
}

// 插件自动生成以下具体类型的编解码函数：
//   Wrapper__string  和  Wrapper__Wrapper__string
const data = protobuf_encode<Wrapper<Wrapper<string>>>({
  value: { value: 'hello' },
});
```

## 泛型函数、类与类型变换

```ts
interface Box<T = string> {
  value: pb<1, T>;
}

function send<T>(value: Box<T>, enabled = true) {
  if (!enabled) return new Uint8Array();
  return protobuf_encode<Box<T>>(value);
}

class Codec<T> {
  encode(value: T) { return protobuf_encode<T>(value); }
  decode(bytes: Uint8Array) { return protobuf_decode<T>(bytes); }
}

const codec = new Codec<Box<string>>();
const decoded = codec.decode(send<string>({ value: 'hello' }));
```

```ts
interface Box<T> { value: pb<1, T>; }
class Codec<T> {
  encode(value: Box<T>) { return protobuf_encode<Box<T>>(value); }
}
const numbers = new Codec<uint_32>();
const strings = new Codec<string>();
numbers.encode({ value: 7 });
strings.encode({ value: 'x' });
```

```ts
function encode<T>(value: T) { return protobuf_encode<T>(value); }
type Encoder = <T>(value: T) => Uint8Array;
function apply<T>(value: T, callback: Encoder) { return callback<T>(value); }

const values: UserProfile[] = [user];
const buffers = values.map(encode);
const encodeUser = encode<UserProfile>;
const bytes = apply<UserProfile>(user, encode);
```

## 支持的类型

| Protobuf 类型 | TypeScript 类型 | Wire 类型 |
|---------------|-----------------|-----------|
| `uint_32`, `int_32` | `number` | Varint |
| `uint_64`, `int_64` | `bigint` | Varint |
| `sint_32` | `number` | Varint (ZigZag) |
| `sint_64` | `bigint` | Varint (ZigZag) |
| `bool` | `boolean` | Varint |
| `string` | `string` | LengthDelimited |
| `bytes` | `Uint8Array` | LengthDelimited |
| `float`, `fixed_32`, `sfixed_32` | `number` | 32-bit |
| `double` | `number` | 64-bit |
| `fixed_64`, `sfixed_64` | `bigint` | 64-bit |
| 嵌套消息 | interface | LengthDelimited |

字段标记：
- `pb<fieldNumber, Type>` — 单值字段
- `pb_repeated<fieldNumber, Type>` — 重复字段（→ `Type[]`）

## 包入口

| 路径 | 用途 |
|------|------|
| `protobuf-fastdsl` | 用户代码 — `protobuf_encode`、`protobuf_decode`、所有类型 |
| `protobuf-fastdsl/vite` | Vite 插件 |

## ⚡ 性能测试
参与对比的实现：

- `protobuf-ts(protoc)` — `@protobuf-ts/plugin + protoc` 生成代码，启用 `force_optimize_speed`
- `protobuf-ts` — 手写 `MessageType` 反射运行时
- `protobufjs(static)` — `pbjs static-module` 从同一份 `.proto` 生成代码
- `protobufjs` — 反射 API
- `protobuf` — `google-protobuf + protoc-gen-js` 生成代码

> 2026-10-24 | Node v26.10.0 | Windows x64 | 每轮 500,000 次迭代 | 预热 50,000 次 | 7 轮中位数

### 编码性能（ops/sec — 越高越好）

| 消息类型 | protobuf-fastdsl | protobuf-ts(protoc) | protobuf-ts | protobufjs(static) | protobufjs | protobuf |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| 简单消息（1 个字段） | **40,031,385 (1x)** | 8,006,546 (5.00x slower) | 6,184,062 (6.47x slower) | 11,461,292 (3.49x slower) | 12,065,957 (3.32x slower) | 12,546,170 (3.19x slower) |
| 多字段（空字符串） | **34,832,040 (1x)** | 7,329,573 (4.75x slower) | 4,613,363 (7.55x slower) | 10,004,222 (3.48x slower) | 9,932,696 (3.51x slower) | 9,503,048 (3.67x slower) |
| 多字段（16 B ASCII） | **14,089,508 (1x)** | 1,924,476 (7.32x slower) | 1,565,125 (9.00x slower) | 6,427,429 (2.19x slower) | 6,346,104 (2.22x slower) | 2,088,664 (6.75x slower) |
| 多字段（中文 + emoji，19 B） | **11,706,641 (1x)** | 1,788,577 (6.55x slower) | 1,509,294 (7.76x slower) | 7,133,156 (1.64x slower) | 7,246,965 (1.62x slower) | 1,945,034 (6.02x slower) |
| 多字段（ASCII + 中文 + emoji，16 B） | **8,106,408 (1x)** | 1,783,890 (4.54x slower) | 1,499,257 (5.41x slower) | 7,022,235 (1.15x slower) | 6,861,873 (1.18x slower) | 1,921,577 (4.22x slower) |
| 多字段（128 B ASCII） | **7,001,556 (1x)** | 1,339,053 (5.23x slower) | 1,127,487 (6.21x slower) | 3,390,916 (2.06x slower) | 4,049,488 (1.73x slower) | 1,440,848 (4.86x slower) |
| 多字段（长中文 + emoji，320 B） | **1,887,377 (1x)** | 998,917 (1.89x slower) | 895,517 (2.11x slower) | 1,292,303 (1.46x slower) | 1,315,628 (1.43x slower) | 1,019,657 (1.85x slower) |
| 嵌套消息 | **26,859,771 (1x)** | 3,123,019 (8.60x slower) | 2,657,187 (10.11x slower) | 8,866,050 (3.03x slower) | 9,008,619 (2.98x slower) | 7,331,346 (3.66x slower) |

### 解码性能（ops/sec — 越高越好）

| 消息类型 | protobuf-fastdsl | protobuf-ts(protoc) | protobuf-ts | protobufjs(static) | protobufjs | protobuf |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| 简单消息（1 个字段） | **98,214,461 (1x)** | 10,622,319 (9.25x slower) | 8,424,259 (11.66x slower) | 37,692,325 (2.61x slower) | 33,035,791 (2.97x slower) | 13,857,863 (7.09x slower) |
| 多字段（空字符串） | **87,279,837 (1x)** | 10,105,256 (8.64x slower) | 6,220,252 (14.03x slower) | 30,304,132 (2.88x slower) | 35,362,179 (2.47x slower) | 10,721,906 (8.14x slower) |
| 多字段（16 B ASCII） | **25,089,822 (1x)** | 4,541,528 (5.52x slower) | 3,402,066 (7.37x slower) | 15,795,792 (1.59x slower) | 16,673,781 (1.50x slower) | 3,833,242 (6.55x slower) |
| 多字段（中文 + emoji，19 B） | **13,852,833 (1x)** | 3,105,683 (4.46x slower) | 2,466,139 (5.62x slower) | 4,460,212 (3.11x slower) | 4,557,432 (3.04x slower) | 2,764,994 (5.01x slower) |
| 多字段（ASCII + 中文 + emoji，16 B） | **13,681,276 (1x)** | 3,388,907 (4.04x slower) | 2,682,536 (5.10x slower) | 4,898,100 (2.79x slower) | 4,918,878 (2.78x slower) | 2,962,485 (4.62x slower) |
| 多字段（128 B ASCII） | **9,428,661 (1x)** | 4,224,093 (2.23x slower) | 3,181,026 (2.96x slower) | 7,661,673 (1.23x slower) | 7,819,868 (1.21x slower) | 3,686,418 (2.56x slower) |
| 多字段（长中文 + emoji，320 B） | **3,445,391 (1x)** | 2,362,755 (1.46x slower) | 1,965,403 (1.75x slower) | 3,040,922 (1.13x slower) | 3,024,917 (1.14x slower) | 2,204,682 (1.56x slower) |
| 嵌套消息 | **61,611,258 (1x)** | 9,195,893 (6.70x slower) | 6,610,600 (9.32x slower) | 21,797,035 (2.83x slower) | 21,534,088 (2.86x slower) | 4,201,253 (14.66x slower) |

## 许可证

MIT
