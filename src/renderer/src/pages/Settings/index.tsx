import { useEffect, useState, useCallback } from 'react'
import { Save, RefreshCw, DatabaseBackup, ArchiveRestore } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { BackupInfo } from '../../../../shared/types'

/**
 * 设置页面
 * @see 文档 2.3.1 设置 / 10.3 应用退出和系统能力
 *
 * 核心能力：
 * - Chrome 路径（留空自动检测）
 * - 全局并发上限
 * - 日志 / 截图保留天数
 * - 执行结果通知
 * - 开机自启动
 */

function NumberField(props: {
  label: string
  description: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <Label>{props.label}</Label>
      <Input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) props.onChange(Math.min(props.max, Math.max(props.min, Math.floor(n))))
        }}
      />
      <p className="text-xs text-muted-foreground">{props.description}</p>
    </div>
  )
}

function SwitchField(props: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label>{props.label}</Label>
        <p className="text-xs text-muted-foreground">{props.description}</p>
      </div>
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </div>
  )
}

function BackupCard() {
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null)

  const refresh = useCallback(async () => {
    try {
      setBackups(await window.dock.backupsList())
    } catch (err) {
      setMessage(`加载备份失败：${(err as Error).message}`)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleCreate = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await window.dock.backupsCreate()
      setMessage('备份已创建')
      await refresh()
    } catch (err) {
      setMessage(`备份失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleRestore = async () => {
    if (!restoreTarget) return
    setBusy(true)
    setMessage(null)
    try {
      await window.dock.backupsRestore(restoreTarget.path)
      setMessage(`已恢复到 ${new Date(restoreTarget.modifiedAt).toLocaleString('zh-CN')} 的备份`)
      setRestoreTarget(null)
    } catch (err) {
      setMessage(`恢复失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>备份与恢复</CardTitle>
            <CardDescription>数据库快照（保留最近 7 份），恢复后调度自动重新注册</CardDescription>
          </div>
          <Button variant="outline" onClick={handleCreate} disabled={busy}>
            <DatabaseBackup className="h-4 w-4" />
            立即备份
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无备份，点击「立即备份」创建</p>
        ) : (
          <div className="space-y-2">
            {backups.map((b) => (
              <div
                key={b.path}
                className="flex items-center justify-between rounded-lg border px-4 py-2"
              >
                <div>
                  <p className="text-sm">{new Date(b.modifiedAt).toLocaleString('zh-CN')}</p>
                  <p className="text-xs text-muted-foreground">
                    {(b.size / 1024).toFixed(1)} KB · {b.path.split('/').pop()}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setRestoreTarget(b)} disabled={busy}>
                  <ArchiveRestore className="h-4 w-4" />
                  恢复
                </Button>
              </div>
            ))}
          </div>
        )}

        <Dialog open={restoreTarget !== null} onOpenChange={(o) => !o && setRestoreTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>恢复数据库</DialogTitle>
              <DialogDescription>
                确认恢复到 {restoreTarget && new Date(restoreTarget.modifiedAt).toLocaleString('zh-CN')}{' '}
                的备份？当前数据会先自动备份一份（pre-restore）。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
              <Button onClick={handleRestore} disabled={busy}>
                {busy ? '恢复中...' : '确认恢复'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

export default function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings)
  const loading = useSettingsStore((s) => s.loading)
  const saving = useSettingsStore((s) => s.saving)
  const error = useSettingsStore((s) => s.error)
  const load = useSettingsStore((s) => s.load)
  const update = useSettingsStore((s) => s.update)

  // 本地草稿，保存时提交到主进程
  const [draft, setDraft] = useState<Record<string, unknown>>({})

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (settings) setDraft({ ...settings })
  }, [settings])

  if (loading || !settings || Object.keys(draft).length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold tracking-tight">设置</h1>
        <p className="mt-2 text-sm text-muted-foreground">加载中...</p>
      </div>
    )
  }

  const patchDirty =
    JSON.stringify(draft) !== JSON.stringify(settings)

  const handleSave = async () => {
    await update({
      chromePath: String(draft.chromePath ?? ''),
      maxConcurrency: Number(draft.maxConcurrency),
      logRetentionDays: Number(draft.logRetentionDays),
      notifyOnExecution: Boolean(draft.notifyOnExecution),
      launchAtLogin: Boolean(draft.launchAtLogin),
      closeToTray: Boolean(draft.closeToTray),
      launchBrowserHidden: Boolean(draft.launchBrowserHidden),
      enableInspection: Boolean(draft.enableInspection)
    })
  }

  const handleReset = () => setDraft({ ...settings })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">设置</h1>
          <p className="text-muted-foreground">应用配置和偏好</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReset} disabled={!patchDirty || saving}>
            <RefreshCw className="h-4 w-4" />
            重置
          </Button>
          <Button onClick={handleSave} disabled={!patchDirty || saving}>
            <Save className="h-4 w-4" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>浏览器</CardTitle>
          <CardDescription>Chrome 可执行文件配置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Chrome 路径</Label>
          <Input
            placeholder="留空自动检测（/Applications/Google Chrome.app/...）"
            value={String(draft.chromePath ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, chromePath: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            指定 Chrome 可执行文件完整路径；修改后新启动的浏览器实例生效
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>执行与调度</CardTitle>
          <CardDescription>并发控制和数据保留策略</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <NumberField
            label="全局并发上限"
            description="同时执行的账号数量（1-10）"
            value={Number(draft.maxConcurrency)}
            min={1}
            max={10}
            onChange={(v) => setDraft((d) => ({ ...d, maxConcurrency: v }))}
          />
          <NumberField
            label="日志保留天数"
            description="执行日志保留期限（1-365 天）"
            value={Number(draft.logRetentionDays)}
            min={1}
            max={365}
            onChange={(v) => setDraft((d) => ({ ...d, logRetentionDays: v }))}
          />
          <p className="text-xs text-muted-foreground">
            截图 / DOM 快照 / 运行日志文件按日期目录存储，不自动清理，需手动删除
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>通知与系统</CardTitle>
          <CardDescription>系统通知和应用行为</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchField
            label="执行结果通知"
            description="任务成功、失败或取消时发送系统通知"
            checked={Boolean(draft.notifyOnExecution)}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, notifyOnExecution: v }))}
          />
          <SwitchField
            label="开机自启动"
            description="登录系统后自动在后台启动应用（隐藏窗口）"
            checked={Boolean(draft.launchAtLogin)}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, launchAtLogin: v }))}
          />
          <SwitchField
            label="关闭窗口最小化到托盘"
            description="点击关闭按钮时隐藏窗口到系统托盘，任务继续执行；从托盘菜单退出"
            checked={Boolean(draft.closeToTray)}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, closeToTray: v }))}
          />
          <SwitchField
            label="浏览器窗口后台启动"
            description="自动化使用的 Chrome 窗口在屏幕外启动，不抢占桌面焦点；执行不受影响"
            checked={Boolean(draft.launchBrowserHidden)}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, launchBrowserHidden: v }))}
          />
          <SwitchField
            label="低频巡检"
            description="每日 04:00 检查已登录账号的中控台页面可用性，异常时记录诊断并发送通知"
            checked={Boolean(draft.enableInspection)}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, enableInspection: v }))}
          />
        </CardContent>
      </Card>

      <BackupCard />
    </div>
  )
}
