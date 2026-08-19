import { useEffect, useState } from 'react'
import { Plus, Trash2, RefreshCw, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import { useSchedulesStore } from '@/store/useSchedulesStore'
import { useTasksStore } from '@/store/useTasksStore'
import { useAccountsStore } from '@/store/useAccountsStore'

/**
 * 调度管理页面
 * @see 文档 2.3.1 调度管理 / 5.2 调度流程
 * 配置 Cron、时区、目标账号、并发数、重试策略和错过执行策略
 */

function CreateScheduleDialog() {
  const createSchedule = useSchedulesStore((s) => s.createSchedule)
  const tasks = useTasksStore((s) => s.tasks)
  const accounts = useAccountsStore((s) => s.accounts)

  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [cronExpression, setCronExpression] = useState('0 */30 * * * *')
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [maxConcurrency, setMaxConcurrency] = useState('3')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!taskId || accountIds.length === 0 || !cronExpression.trim()) return
    setSubmitting(true)
    const created = await createSchedule({
      taskId,
      accountIds,
      cronExpression: cronExpression.trim(),
      timezone,
      maxConcurrency: Number(maxConcurrency) || 3
    })
    setSubmitting(false)
    if (created) {
      setTaskId('')
      setAccountIds([])
      setCronExpression('0 */30 * * * *')
      setOpen(false)
    }
  }

  const toggleAccount = (id: string) => {
    setAccountIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="h-4 w-4" />
        创建调度
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建调度规则</DialogTitle>
          <DialogDescription>配置定时任务执行计划（仅应用运行期间触发）</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>关联任务</Label>
            <Select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              disabled={tasks.length === 0}
            >
              <option value="">{tasks.length === 0 ? '请先创建任务' : '选择任务...'}</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>目标账号</Label>
            {accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">请先在「账号管理」创建账号</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => (
                  <Button
                    key={a.id}
                    type="button"
                    size="sm"
                    variant={accountIds.includes(a.id) ? 'default' : 'outline'}
                    onClick={() => toggleAccount(a.id)}
                  >
                    {a.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Cron 表达式</Label>
            <Input
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="0 */30 * * * *"
            />
            <p className="text-xs text-muted-foreground">
              6 段 cron。例：<code>0 */30 * * * *</code> 每 30 分钟
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>时区</Label>
              <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="UTC">UTC</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>最大并发数</Label>
              <Input
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(e.target.value)}
                type="number"
                min={1}
                max={10}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={
              submitting || !taskId || accountIds.length === 0 || !cronExpression.trim()
            }
          >
            {submitting ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteScheduleDialog({ scheduleId, taskName }: { scheduleId: string; taskName: string }) {
  const deleteSchedule = useSchedulesStore((s) => s.deleteSchedule)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    const ok = await deleteSchedule(scheduleId)
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
          <DialogTitle>删除调度</DialogTitle>
          <DialogDescription>确认删除针对「{taskName || '该任务'}」的调度规则？</DialogDescription>
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

export default function SchedulesPage() {
  const { schedules, loading, error, load, updateSchedule } = useSchedulesStore()
  const tasks = useTasksStore((s) => s.tasks)
  const accounts = useAccountsStore((s) => s.accounts)

  useEffect(() => {
    // 并行加载任务/账号用于显示名称
    useTasksStore.getState().load()
    useAccountsStore.getState().load()
    load()
  }, [load])

  const taskName = (taskId: string) => tasks.find((t) => t.id === taskId)?.name ?? taskId

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    await updateSchedule(id, { enabled })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">调度管理</h1>
          <p className="text-muted-foreground">定时任务执行计划（应用运行期间生效）</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <CreateScheduleDialog />
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
          <CardTitle>调度列表</CardTitle>
          <CardDescription>
            {loading ? '加载中...' : `共 ${schedules.length} 条调度规则`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无调度规则，点击右上角「创建调度」开始
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>账号数</TableHead>
                  <TableHead>并发</TableHead>
                  <TableHead>下次运行</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-muted-foreground" />
                        {taskName(schedule.taskId)}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{schedule.cronExpression}</TableCell>
                    <TableCell>{schedule.accountIds.length}</TableCell>
                    <TableCell>{schedule.maxConcurrency}</TableCell>
                    <TableCell>
                      {schedule.nextRunAt
                        ? new Date(schedule.nextRunAt).toLocaleString('zh-CN')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={schedule.enabled}
                          onCheckedChange={(checked) => handleToggleEnabled(schedule.id, checked)}
                        />
                        <Badge variant={schedule.enabled ? 'success' : 'secondary'}>
                          {schedule.enabled ? '已启用' : '已停用'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteScheduleDialog scheduleId={schedule.id} taskName={taskName(schedule.taskId)} />
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