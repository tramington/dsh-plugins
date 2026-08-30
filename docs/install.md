# 安装指引（DSH 插件通用步骤）

所有插件遵循同一安装模式（用户级插件，不修改 DSH 源码）。

## 前置

- DSH（DeepSeek Harness）Web profile
- 插件目录：`~/.dsh/profiles/node_modules/@dsh-local/`
- Profile patch：`~/.dsh/profiles/web/cordis.patch.yml`

## 步骤

### 1. 复制插件包

```bash
mkdir -p ~/.dsh/profiles/node_modules/@dsh-local
cp -r plugins/cost-gauge ~/.dsh/profiles/node_modules/@dsh-local/cost-gauge
cp -r plugins/loop-rules ~/.dsh/profiles/node_modules/@dsh-local/loop-rules
```

### 2. 注册到 profile patch

编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: cost-gauge
      name: '@dsh-local/cost-gauge'
    - id: loop-rules
      name: '@dsh-local/loop-rules'
```

### 3. 重启服务

```bash
launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh
```

> macOS Web App（DSH.app）用户：重启后**完全退出并重新打开**（Cmd+R 可能不生效）。

### 4. 验证

- 服务日志无插件错误（`~/.dsh/dsh.log`）
- cost-gauge：右上角出现仪表
- loop-rules：无 UI（prompt 层），下次 goal/ralph 场景自动生效

## 卸载

```bash
# 从 cordis.patch.yml 删除对应行 → 重启
# 或删除 ~/.dsh/profiles/node_modules/@dsh-local/<插件名>/ 目录
```

## 注意

- **修改 browser 半（client.js）无需重启**（bundle 动态 rev）；**修改 node 半（index.js）必须重启**
- 换插件版本后必须重启（node 半进程启动时加载，旧实例会导致路由 405）
- 本仓库保存的是**验证过的工作版本**（含本地修复），从源码重装时参考各插件注释
