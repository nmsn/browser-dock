import { useEffect, useState } from 'react'
import { Plus, Trash2, RefreshCw, FileCode2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { useTasksStore } from '@/store/useTasksStore'
import { useAccountsStore } from '@/store/useAccountsStore'
import type { TaskType, ScriptApi } from '../../../../shared/types'

/**
 * 任务管理页面
 * @see 文档 2.3.1 任务管理
 * 创建任务 / 编辑参数 / 查看任务版本 / 启用停用任务
 */

const typeMap: Record<TaskType, { label: string }> = {
  feature: { label: '内置功能' },
  custom: { label: '自定义' }
}

/** 脚本 API 白名单分组（文档 9.2） */
const apiGroups: Array<{ label: string; apis: ScriptApi[] }> = [
  {
    label: '页面操作',
    apis: ['page.navigate', 'page.waitForSelector', 'page.click', 'page.input', 'page.evaluate', 'page.screenshot']
  },
  {
    label: '任务日志',
    apis: ['logger.info', 'logger.warn', 'logger.error']
  },
  {
    label: '任务存储',
    apis: ['storage.get', 'storage.set', 'storage.delete']
  }
]

const ALL_APIS: ScriptApi[] = apiGroups.flatMap((g) => g.apis)

function ApiPermissionSelector(props: {
  selected: ScriptApi[]
  onChange: (apis: ScriptApi[]) => void
}) {
  const toggle = (api: ScriptApi) => {
    props.onChange(
      props.selected.includes(api)
        ? props.selected.filter((a) => a !== api)
        : [...props.selected, api]
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>脚本权限（白名单 API）</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => props.onChange(ALL_APIS)}>
          全部允许
        </Button>
      </div>
      {apiGroups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.apis.map((api) => (
              <Button
                key={api}
                type="button"
                size="sm"
                variant={props.selected.includes(api) ? 'default' : 'outline'}
                className="font-mono text-xs"
                onClick={() => toggle(api)}
              >
                {api}
              </Button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        未勾选的 API 在脚本中调用会抛出 TK_API_NOT_ALLOWED 错误
      </p>
    </div>
  )
}

function CreateTaskDialog() {
  const createTask = useTasksStore((s) => s.createTask)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<TaskType>('custom')
  const [script, setScript] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('120000')
  const [allowedApis, setAllowedApis] = useState<ScriptApi[]>(ALL_APIS)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim() || !script.trim()) return
    setSubmitting(true)
    const created = await createTask({
      name,
      type,
      script,
      timeoutMs: Number(timeoutMs) || 120000,
      allowedApis
    })
    setSubmitting(false)
    if (created) {
      setName('')
      setType('custom')
      setScript('')
      setTimeoutMs('120000')
      setAllowedApis(ALL_APIS)
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="h-4 w-4" />
        创建任务
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建任务</DialogTitle>
          <DialogDescription>定义自动化任务脚本与参数</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>任务名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：开播商品检查" />
          </div>
          <div className="space-y-2">
            <Label>任务类型</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as TaskType)}>
              <option value="custom">自定义</option>
              <option value="live-control">直播控制</option>
              <option value="product">商品管理</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>脚本内容</Label>
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={'async function run(ctx) {\n  // ctx.page / ctx.logger / ctx.signal ...\n  await ctx.page.navigate("https://live.taobao.com/admin");\n}'}
              className="min-h-[180px] font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label>超时（毫秒）</Label>
            <Input value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} placeholder="120000" type="number" />
          </div>
          <ApiPermissionSelector selected={allowedApis} onChange={setAllowedApis} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim() || !script.trim()}>
            {submitting ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteTaskDialog({ taskId, taskName }: { taskId: string; taskName: string }) {
  const deleteTask = useTasksStore((s) => s.deleteTask)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    const ok = await deleteTask(taskId)
    setDeleting(false)
    if (ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" />}>
        <Trash2 className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除任务</DialogTitle>
          <DialogDescription>确认删除任务「{taskName}」？</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? '删除中...' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RunTaskDialog({ taskId, taskName }: { taskId: string; taskName: string }) {
  const accounts = useAccountsStore((s) => s.accounts)
  const [open, setOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (open && accounts.length === 0) {
      useAccountsStore.getState().load()
    }
  }, [open, accounts.length])

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  const handleRun = async () => {
    if (selectedIds.length === 0) return
    setRunning(true)
    setResult(null)
    try {
      const { queued } = await window.dock.executionRun(taskId, selectedIds)
      setResult(`已加入执行队列：${queued} 个账号，可在「执行监控」查看进度`)
    } catch (err) {
      setResult(`执行失败：${(err as Error).message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="icon" />}>
        <Play className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>运行任务</DialogTitle>
          <DialogDescription>选择目标账号，立即执行「{taskName}」</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>目标账号（多选，并行执行）</Label>
            {accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">请先在「账号管理」创建账号</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => (
                  <Button
                    key={a.id}
                    type="button"
                    size="sm"
                    variant={selectedIds.includes(a.id) ? 'default' : 'outline'}
                    onClick={() => toggleAccount(a.id)}
                  >
                    {a.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {result && (
            <p className="text-sm text-muted-foreground">{result}</p>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
          <Button
            onClick={handleRun}
            disabled={running || selectedIds.length === 0}
          >
            {running ? '执行中...' : '执行'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function TasksPage() {
  const { tasks, loading, error, load } = useTasksStore()

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">任务管理</h1>
          <p className="text-muted-foreground">管理自动化任务和脚本</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <CreateTaskDialog />
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">操作失败：{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>
            {loading ? '加载中...' : `共 ${tasks.length} 个任务`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无任务，点击右上角「创建任务」开始
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>超时</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <FileCode2 className="h-4 w-4 text-muted-foreground" />
                        {task.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{typeMap[task.type]?.label ?? task.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">v{task.version}</Badge>
                    </TableCell>
                    <TableCell>{Math.round(task.timeoutMs / 1000)}s</TableCell>
                    <TableCell>{new Date(task.updatedAt).toLocaleString('zh-CN')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <RunTaskDialog taskId={task.id} taskName={task.name} />
                        <DeleteTaskDialog taskId={task.id} taskName={task.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}