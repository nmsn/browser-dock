import { useEffect, useState } from 'react'
import { RefreshCw, XCircle, Download, FileSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { useExecutionStore } from '@/store/useExecutionStore'
import { useTasksStore } from '@/store/useTasksStore'
import { useAccountsStore } from '@/store/useAccountsStore'
import type { ExecutionStatus, PageDiagnostic } from '../../../../shared/types'

/**
 * 执行监控页面
 * @see 文档 2.3.1 执行监控 / 11.3 UI 状态
 *
 * 显示：账号/任务/执行状态/耗时/错误/截图
 * 支持：按账号、任务、状态筛选
 */

const statusMap: Record<ExecutionStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
  queued: { label: '队列中', variant: 'secondary' },
  starting: { label: '启动中', variant: 'secondary' },
  'launching-browser': { label: '启动浏览器', variant: 'secondary' },
  'connecting-cdp': { label: '连接 CDP', variant: 'secondary' },
  'checking-login': { label: '检查登录', variant: 'secondary' },
  'waiting-page': { label: '等待页面', variant: 'secondary' },
  running: { label: '执行中', variant: 'default' },
  'waiting-user': { label: '等待用户', variant: 'warning' },
  retrying: { label: '重试中', variant: 'warning' },
  cancelling: { label: '取消中', variant: 'warning' },
  cancelled: { label: '已取消', variant: 'warning' },
  success: { label: '成功', variant: 'success' },
  failed: { label: '失败', variant: 'destructive' },
  timeout: { label: '超时', variant: 'destructive' }
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * 页面诊断查看器（文档 11.2）
 * 展示失败执行的 URL/Title/DOM 快照/截图/Console 错误
 */
function DiagnosticViewer({ executionId }: { executionId: string }) {
  const [open, setOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState<PageDiagnostic[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    window.dock
      .diagnosticsList(executionId)
      .then((list) => setDiagnostics(list))
      .finally(() => setLoading(false))
  }, [open, executionId])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" title="查看页面诊断" />}>
        <FileSearch className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>页面诊断</DialogTitle>
          <DialogDescription>失败时自动捕获的页面状态（文档 11.2）</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">加载中...</p>
        ) : !diagnostics || diagnostics.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">该执行无诊断记录</p>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {diagnostics.map((d, i) => (
              <Card key={i}>
                <CardContent className="pt-4 space-y-2 text-sm">
                  <div>
                    <span className="font-medium">URL：</span>
                    <span className="font-mono text-xs text-muted-foreground">{d.url || '—'}</span>
                  </div>
                  <div>
                    <span className="font-medium">Title：</span>
                    <span className="text-muted-foreground">{d.title || '—'}</span>
                  </div>
                  <div>
                    <span className="font-medium">时间：</span>
                    <span className="text-muted-foreground">
                      {new Date(d.timestamp).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  {d.domSnapshot && (
                    <div>
                      <span className="font-medium">DOM 快照：</span>
                      <span className="font-mono text-xs text-muted-foreground break-all">
                        {d.domSnapshot}
                      </span>
                    </div>
                  )}
                  {d.screenshotPath && (
                    <div>
                      <span className="font-medium">截图：</span>
                      <span className="font-mono text-xs text-muted-foreground break-all">
                        {d.screenshotPath}
                      </span>
                    </div>
                  )}
                  {d.consoleErrors && d.consoleErrors.length > 0 && (
                    <div>
                      <span className="font-medium">Console 错误（{d.consoleErrors.length}）：</span>
                      <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                        {d.consoleErrors.slice(0, 5).join('\n')}
                        {d.consoleErrors.length > 5 ? '\n...' : ''}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <div className="flex justify-end pt-4">
          <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function ExecutionPage() {
  const { logs, loading, error, filter, load, setFilter } = useExecutionStore()
  const tasks = useTasksStore((s) => s.tasks)
  const accounts = useAccountsStore((s) => s.accounts)

  useEffect(() => {
    useTasksStore.getState().load()
    useAccountsStore.getState().load()
    load()

    // 实时订阅执行状态（文档 11.3）
    const offStatus = window.dock.onExecutionStatus((status, log) => {
      useExecutionStore.getState().handleEvent(status, log)
    })
    const offLog = window.dock.onExecutionLog((log) => {
      useExecutionStore.getState().handleLog(log)
    })
    return () => {
      offStatus()
      offLog()
    }
  }, [load])

  const taskName = (id: string) => tasks.find((t) => t.id === id)?.name ?? id
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">执行监控</h1>
          <p className="text-muted-foreground">任务执行日志与状态</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              const { path } = await window.dock.executionExportCsv()
              if (path) alert(`已导出到：${path}`)
            }}
          >
            <Download className="h-4 w-4" />
            导出 CSV
          </Button>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 筛选器（文档 11.3 / 执行历史支持按账号、任务、状态、时间筛选） */}
      <Card>
        <CardHeader>
          <CardTitle>筛选</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">账号</label>
              <Select
                value={filter.accountId ?? ''}
                onChange={(e) => setFilter({ accountId: e.target.value || undefined })}
              >
                <option value="">全部账号</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">任务</label>
              <Select
                value={filter.taskId ?? ''}
                onChange={(e) => setFilter({ taskId: e.target.value || undefined })}
              >
                <option value="">全部任务</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">状态</label>
              <Select
                value={filter.status ?? ''}
                onChange={(e) => setFilter({ status: e.target.value as ExecutionStatus | undefined })}
              >
                <option value="">全部状态</option>
                {(Object.keys(statusMap) as ExecutionStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {statusMap[s].label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">加载失败：{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>执行记录</CardTitle>
          <CardDescription>{loading ? '加载中...' : `共 ${logs.length} 条执行记录`}</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无执行记录，从「任务管理」手动运行任务
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>任务</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>功能步骤</TableHead>
                  <TableHead>错误</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const status = statusMap[log.status] ?? statusMap.queued
                  const cancellable = ['queued', 'starting', 'launching-browser', 'connecting-cdp', 'checking-login', 'waiting-page', 'running', 'waiting-user', 'retrying'].includes(log.status)
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">{accountName(log.accountId)}</TableCell>
                      <TableCell>{taskName(log.taskId)}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>{formatDuration(log.duration)}</TableCell>
                      <TableCell>{new Date(log.startedAt).toLocaleString('zh-CN')}</TableCell>
                      <TableCell className="max-w-[220px]">
                        {log.result && typeof log.result === 'object' && 'steps' in log.result ? (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(
                              (log.result as { steps?: Record<string, boolean> }).steps ?? {}
                            ).map(([key, done]) => (
                              <Badge key={key} variant={done ? 'default' : 'outline'} className="text-[10px]">
                                {done ? '✓' : '○'} {key}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {log.error ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(log.status === 'failed' || log.status === 'timeout') && (
                            <DiagnosticViewer executionId={log.id} />
                          )}
                          {cancellable && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              title="取消任务"
                              onClick={async () => {
                                window.dock.executionCancel(log.id)
                              }}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}