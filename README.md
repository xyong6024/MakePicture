# AI 批量智能改尺寸

这是一个可直接启动的 MVP 项目，目标是把“传统强行拉伸改尺寸”升级为“按图片特点智能生成指定尺寸新图”的工作流。

当前版本包含：

- 批量上传任意尺寸图片
- 目标尺寸预设与自定义宽高
- 输出语种选择与图片内文字自动翻译
- 批量处理队列与状态反馈
- 结果预览与单张下载
- 可替换的 AI Provider 层
- 默认 `mock` 模式，先把流程跑通

## 目录结构

```text
.
├─ public/               # 前端页面
├─ src/
│  ├─ providers/         # AI 接口适配层
│  ├─ config.mjs         # 环境变量配置
│  ├─ server.mjs         # HTTP 服务
│  └─ utils.mjs          # 文件/数据工具
├─ outputs/generated/    # 生成结果
└─ work/uploads/         # 原始上传暂存
```

## 启动

1. 复制环境变量

```powershell
Copy-Item .env.example .env
```

2. 启动服务

```powershell
node src/server.mjs
```

3. 打开浏览器访问

```text
http://localhost:3000
```

## 服务器部署

推荐服务器使用 `pm2` 托管，这样后续更新不需要每次手工启动。

### 首次部署

```bash
git clone https://github.com/xyong6024/MakePicture.git
cd MakePicture
cp .env.example .env
# 编辑 .env，填入你的真实配置
bash scripts/deploy-first-run.sh
```

### 后续更新

以后每次你本地改完并推到 GitHub，服务器只需要执行：

```bash
cd /你的项目目录/MakePicture
bash scripts/deploy-update.sh
```

这个脚本会自动完成：

- 拉取远程最新代码
- 覆盖当前代码到 `origin/main`
- 保留本地 `.env`
- 自动重启 `pm2` 服务

### Windows Server 更新

如果你的服务器是 Windows：

```powershell
cd C:\你的项目目录\MakePicture
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-update.ps1
```

### 注意

- `deploy-update.sh` 和 `deploy-update.ps1` 会执行 `git reset --hard origin/main`
- 这意味着服务器代码会被远程仓库版本覆盖
- 不要在服务器项目目录里直接手改业务代码
- `.env` 不会被 git 跟踪，所以会保留下来

## 当前两种 Provider

### 1. `mock` 模式

默认模式，不依赖外部接口。它会生成一张目标尺寸的 SVG：

- 背景层：原图放大并模糊铺满
- 主图层：原图按比例完整展示
- 优点：不会挤压、不会变形、尺寸精确
- 作用：先验证批量流程、交互和输出链路

### 2. `http` 模式

把每张图发给你的 AI 接口。当前实现支持：

- `multipart/form-data` 上传
- 自动附带 `targetWidth`、`targetHeight`、`originalWidth`、`originalHeight`、`mode`、`prompt`
- 支持自定义请求头和附加字段
- 支持解析二进制图片响应、JSON base64 响应、JSON URL 响应

### 3. `openai-compatible` 模式

这个模式就是给“中转站调用 GPT 生图”准备的，适合你刚说的这类站点：

- 自定义 `base_url`
- 自定义模型名，例如 `gpt-image-2`
- 支持 `images/edits` 风格接口
- 支持 `responses` 风格接口
- 自动把原图、目标尺寸和优化提示词一起发给模型

推荐先用：

```env
AI_PROVIDER=openai-compatible
OPENAI_COMPAT_BASE_URL=https://cx.ll.sd
OPENAI_COMPAT_MODEL=gpt-image-2
OPENAI_COMPAT_MODE=images-edits
OPENAI_COMPAT_API_KEY=你的中转站密钥
```

如果你的中转站要求走 `responses`：

```env
OPENAI_COMPAT_MODE=responses
```

## 接入你的真实接口

把 `.env` 改成：

```env
AI_PROVIDER=http
AI_API_URL=你的接口地址
AI_API_KEY=你的密钥
AI_API_IMAGE_FIELD=image
```

如果接口字段或返回结构不一致，优先改这里：

- `src/providers/http-provider.mjs`
- `src/providers/openai-compatible-provider.mjs`

## 建议的 AI 工作流

真实 AI 接口接入后，推荐把每张图的上下文一并传入：

- 原图尺寸
- 目标尺寸
- 目标输出语言
- 使用场景
- 保留主体
- 避免文字裁切
- 避免人物变形
- 生成电商图 / 社媒封面 / 横版广告图等风格提示

这样生成结果会比传统几何缩放明显更好。

## 图片文字自动改语言

前端现在支持在提交时选择输出语种：

- 中文
- English
- Deutsch
- Francais
- Russkiy

当选择非“保持原语言”时，AI 会额外收到这些要求：

- 检测图片中的可见文字
- 自动翻译成目标语种
- 在成图里重新生成对应文字
- 尽量保留原有版式层级、位置和可读性
